from __future__ import annotations

import json

import httpx
import pytest

from stagepilot.core.config import ProPresenterSettings
from stagepilot.plugins.propresenter import (
    ProPresenterClient,
    ProPresenterLook,
    ProPresenterResponseError,
    ProPresenterTimer,
    ProPresenterTimerNotFoundError,
)


def timer_payload(
    *,
    name: str = "Song Countdown",
    uuid: str = "timer-uuid",
    index: int = 0,
    duration: int = 60,
) -> dict[str, object]:
    return {
        "id": {"uuid": uuid, "name": name, "index": index},
        "allows_overrun": False,
        "countdown": {"duration": duration},
        "state": "stopped",
        "time": "00:01:00",
    }


@pytest.mark.asyncio
async def test_client_preserves_timer_identity_when_updating_duration() -> None:
    requests: list[tuple[str, str, object | None]] = []
    saved_duration = 60

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal saved_duration
        body = json.loads(request.content) if request.content else None
        requests.append((request.method, request.url.path, body))
        if request.method == "GET" and request.url.path in (
            "/v1/timers",
            "/v1/timer/timer-uuid",
        ):
            payload = timer_payload(duration=saved_duration)
            return httpx.Response(
                200,
                json=[payload] if request.url.path == "/v1/timers" else payload,
            )
        if request.method == "PUT" and request.url.path == "/v1/timer/timer-uuid/reset":
            assert isinstance(body, dict)
            saved_duration = body["countdown"]["duration"]
            return httpx.Response(204)
        return httpx.Response(200, json={})

    settings = ProPresenterSettings(enabled=True)
    client = ProPresenterClient(settings, transport=httpx.MockTransport(handler))
    try:
        timer = await client.find_timer("song countdown")
        updated = await client.set_timer_duration(timer, 336)
    finally:
        await client.close()

    assert updated.countdown is not None
    assert updated.countdown.duration == 336
    assert requests[-2] == (
        "PUT",
        "/v1/timer/timer-uuid/reset",
        {
            "id": {
                "uuid": "timer-uuid",
                "name": "Song Countdown",
                "index": 0,
            },
            "allows_overrun": False,
            "countdown": {"duration": 336},
        },
    )
    assert requests[-1][:2] == ("GET", "/v1/timer/timer-uuid")


@pytest.mark.asyncio
async def test_client_can_set_countdown_duration_to_zero_for_position_reset() -> None:
    requests: list[tuple[str, str, object | None]] = []
    saved_duration = 60

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal saved_duration
        body = json.loads(request.content) if request.content else None
        requests.append((request.method, request.url.path, body))
        if request.method == "PUT":
            assert isinstance(body, dict)
            saved_duration = body["countdown"]["duration"]
            return httpx.Response(204)
        if request.method == "GET" and request.url.path == "/v1/timer/timer-uuid":
            return httpx.Response(200, json=timer_payload(duration=saved_duration))
        return httpx.Response(204)

    client = ProPresenterClient(
        ProPresenterSettings(enabled=True),
        transport=httpx.MockTransport(handler),
    )
    timer = ProPresenterTimer.model_validate(timer_payload())
    try:
        updated = await client.set_timer_duration(timer, 0)
    finally:
        await client.close()

    assert updated.countdown is not None
    assert updated.countdown.duration == 0
    assert requests == [
        (
            "PUT",
            "/v1/timer/timer-uuid/reset",
            {
                "id": {
                    "uuid": "timer-uuid",
                    "name": "Song Countdown",
                    "index": 0,
                },
                "allows_overrun": False,
                "countdown": {"duration": 0},
            },
        ),
        ("GET", "/v1/timer/timer-uuid", None),
    ]


@pytest.mark.asyncio
async def test_client_waits_for_timer_duration_to_be_visible_before_returning() -> None:
    reads_after_update = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal reads_after_update
        if request.method == "PUT":
            return httpx.Response(204)
        reads_after_update += 1
        duration = 60 if reads_after_update < 3 else 281
        return httpx.Response(200, json=timer_payload(duration=duration))

    client = ProPresenterClient(
        ProPresenterSettings(enabled=True),
        transport=httpx.MockTransport(handler),
    )
    timer = ProPresenterTimer.model_validate(timer_payload())
    try:
        updated = await client.set_timer_duration(timer, 281)
    finally:
        await client.close()

    assert updated.countdown is not None
    assert updated.countdown.duration == 281
    assert reads_after_update == 3


@pytest.mark.asyncio
async def test_client_converts_an_elapsed_timer_to_countdown_when_setting_duration() -> None:
    request_bodies: list[dict[str, object]] = []
    request_paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "PUT":
            request_bodies.append(json.loads(request.content))
            request_paths.append(request.url.path)
            return httpx.Response(204)
        return httpx.Response(200, json=timer_payload(duration=253))

    elapsed = ProPresenterTimer.model_validate(
        {
            "id": {"uuid": "timer-uuid", "name": "Song Countdown", "index": 0},
            "allows_overrun": False,
            "elapsed": {"start_time": 0},
        }
    )
    client = ProPresenterClient(
        ProPresenterSettings(enabled=True),
        transport=httpx.MockTransport(handler),
    )
    try:
        converted = await client.set_timer_duration(elapsed, 253)
    finally:
        await client.close()

    assert converted.countdown is not None
    assert converted.countdown.duration == 253
    assert request_paths == ["/v1/timer/timer-uuid/reset"]
    assert request_bodies == [
        {
            "id": {"uuid": "timer-uuid", "name": "Song Countdown", "index": 0},
            "allows_overrun": False,
            "countdown": {"duration": 253},
        }
    ]


@pytest.mark.asyncio
async def test_client_rejects_unconfirmed_timer_duration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "stagepilot.plugins.propresenter.client.TIMER_UPDATE_VERIFICATION_ATTEMPTS",
        1,
    )

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "PUT":
            return httpx.Response(204)
        return httpx.Response(
            200,
            json={
                "id": {"uuid": "timer-uuid", "name": "Song Countdown", "index": 0},
                "allows_overrun": False,
                "count_down_to_time": {"time_of_day": 3600, "period": "pm"},
            },
        )

    client = ProPresenterClient(
        ProPresenterSettings(enabled=True),
        transport=httpx.MockTransport(handler),
    )
    timer = ProPresenterTimer.model_validate(timer_payload(duration=0))
    try:
        with pytest.raises(ProPresenterResponseError, match="still reported Countdown to Time"):
            await client.set_timer_duration(timer, 281)
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_client_rejects_missing_timer_and_accepts_other_timer_types() -> None:
    responses = iter(
        [
            [timer_payload(name="Other Timer")],
            [
                {
                    "id": {
                        "uuid": "elapsed-uuid",
                        "name": "Song Countdown",
                        "index": 0,
                    },
                    "allows_overrun": False,
                    "elapsed": {"start_time": 0},
                }
            ],
        ]
    )

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=next(responses))

    client = ProPresenterClient(
        ProPresenterSettings(enabled=True),
        transport=httpx.MockTransport(handler),
    )
    try:
        with pytest.raises(ProPresenterTimerNotFoundError):
            await client.find_timer("Song Countdown")
        convertible = await client.find_timer("Song Countdown")
        assert convertible.countdown is None
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_client_lists_and_triggers_audience_looks() -> None:
    requests: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append((request.method, request.url.path))
        if request.url.path == "/v1/looks":
            return httpx.Response(
                200,
                json=[{"id": {"uuid": "look-saved", "name": "Worship", "index": 0}}],
            )
        if request.url.path == "/v1/look/current":
            return httpx.Response(
                200,
                json={"id": {"uuid": "unique-live-look", "name": "Worship", "index": 0}},
            )
        return httpx.Response(204)

    client = ProPresenterClient(
        ProPresenterSettings(enabled=True),
        transport=httpx.MockTransport(handler),
    )
    try:
        looks = await client.list_looks()
        await client.trigger_look("look-saved")
        current = await client.current_look()
    finally:
        await client.close()

    assert looks == [
        ProPresenterLook.model_validate(
            {"id": {"uuid": "look-saved", "name": "Worship", "index": 0}}
        )
    ]
    assert current.id.uuid == "unique-live-look"
    assert requests == [
        ("GET", "/v1/looks"),
        ("GET", "/v1/look/look-saved/trigger"),
        ("GET", "/v1/look/current"),
    ]
