from __future__ import annotations

import json

import httpx
import pytest

from stagepilot.core.config import ProPresenterSettings
from stagepilot.plugins.propresenter import (
    ProPresenterClient,
    ProPresenterLook,
    ProPresenterTimer,
    ProPresenterTimerNotFoundError,
    ProPresenterTimerTypeError,
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

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else None
        requests.append((request.method, request.url.path, body))
        if request.method == "GET" and request.url.path == "/v1/timers":
            return httpx.Response(200, json=[timer_payload()])
        if request.method == "PUT" and request.url.path == "/v1/timer/timer-uuid":
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
    assert requests[-1] == (
        "PUT",
        "/v1/timer/timer-uuid",
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


@pytest.mark.asyncio
async def test_client_can_set_countdown_duration_to_zero_for_position_reset() -> None:
    requests: list[tuple[str, str, object | None]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else None
        requests.append((request.method, request.url.path, body))
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
            "/v1/timer/timer-uuid",
            {
                "id": {
                    "uuid": "timer-uuid",
                    "name": "Song Countdown",
                    "index": 0,
                },
                "allows_overrun": False,
                "countdown": {"duration": 0},
            },
        )
    ]


@pytest.mark.asyncio
async def test_client_rejects_missing_or_non_countdown_timer() -> None:
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
        with pytest.raises(ProPresenterTimerTypeError):
            await client.find_timer("Song Countdown")
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
