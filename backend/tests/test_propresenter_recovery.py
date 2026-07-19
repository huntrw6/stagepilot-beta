from __future__ import annotations

import asyncio
from collections import deque
from dataclasses import dataclass, field

import pytest

from stagepilot.core.config import DemoSettings, ProPresenterSettings, Settings
from stagepilot.core.events import ActionName
from stagepilot.main import create_app
from stagepilot.models.state import ConnectionStatus
from stagepilot.plugins.propresenter import (
    ProPresenterConnectionError,
    ProPresenterCountdown,
    ProPresenterIdentifier,
    ProPresenterLook,
    ProPresenterResponseError,
    ProPresenterTimer,
)


def timer() -> ProPresenterTimer:
    return ProPresenterTimer(
        id=ProPresenterIdentifier(uuid="timer-uuid", name="Song Countdown", index=0),
        countdown=ProPresenterCountdown(duration=60),
    )


def look() -> ProPresenterLook:
    return ProPresenterLook(id=ProPresenterIdentifier(uuid="look-default", name="Default", index=0))


@dataclass
class RecoveringClient:
    results: deque[Exception | list[ProPresenterTimer]] = field(
        default_factory=lambda: deque([ProPresenterConnectionError("offline"), [timer()]])
    )
    closed: bool = False
    list_calls: int = 0

    async def close(self) -> None:
        self.closed = True

    async def list_timers(self) -> list[ProPresenterTimer]:
        self.list_calls += 1
        result = self.results.popleft() if self.results else [timer()]
        if isinstance(result, Exception):
            raise result
        return result

    async def find_timer(self, _name: str) -> ProPresenterTimer:
        return timer()

    async def list_looks(self) -> list[ProPresenterLook]:
        return [look()]

    async def current_look(self) -> ProPresenterLook:
        return look()

    async def trigger_look(self, _look_id: str) -> None:
        return None

    async def stop_timer(self, _timer_id: str) -> None:
        return None

    async def set_timer_duration(
        self,
        value: ProPresenterTimer,
        duration_seconds: int,
    ) -> ProPresenterTimer:
        return value.model_copy(
            update={"countdown": ProPresenterCountdown(duration=duration_seconds)}
        )

    async def reset_timer(self, _timer_id: str) -> None:
        return None

    async def start_timer(self, _timer_id: str) -> None:
        return None


@pytest.mark.asyncio
async def test_plugin_reconnects_when_propresenter_appears_after_startup() -> None:
    client = RecoveringClient()
    settings = Settings(
        demo_mode=True,
        demo=DemoSettings(simulate_propresenter=False),
        propresenter=ProPresenterSettings(
            enabled=True,
            reconnect_initial_seconds=0.01,
            reconnect_max_seconds=0.02,
            health_check_interval_seconds=300,
        ),
    )
    app = create_app(settings, propresenter_client_factory=lambda _settings: client)

    async with app.router.lifespan_context(app):
        runtime = app.state.runtime

        deadline = asyncio.get_running_loop().time() + 1
        while asyncio.get_running_loop().time() < deadline:
            current = await runtime.state_store.snapshot()
            if current.propresenter_status is ConnectionStatus.CONNECTED:
                break
            await asyncio.sleep(0.01)
        else:
            raise AssertionError("ProPresenter did not reconnect.")

        controller = runtime.propresenter_controller
        assert controller is not None

        snapshot = await controller.snapshot()
        assert snapshot.timer_found is True
        assert snapshot.connection_status is ConnectionStatus.CONNECTED
        assert client.list_calls >= 2

    assert client.closed is True


@dataclass
class RecreatedTimerClient:
    list_calls: int = 0
    stopped_ids: list[str] = field(default_factory=list)

    async def close(self) -> None:
        return None

    async def list_timers(self) -> list[ProPresenterTimer]:
        self.list_calls += 1
        uuid = "old-timer" if self.list_calls == 1 else "new-timer"
        return [
            ProPresenterTimer(
                id=ProPresenterIdentifier(
                    uuid=uuid,
                    name="Song Countdown",
                    index=0,
                ),
                countdown=ProPresenterCountdown(duration=60),
            )
        ]

    async def find_timer(self, _name: str) -> ProPresenterTimer:
        return timer()

    async def list_looks(self) -> list[ProPresenterLook]:
        return [look()]

    async def current_look(self) -> ProPresenterLook:
        return look()

    async def trigger_look(self, _look_id: str) -> None:
        return None

    async def stop_timer(self, timer_id: str) -> None:
        self.stopped_ids.append(timer_id)
        if timer_id == "old-timer":
            raise ProPresenterResponseError("ProPresenter returned HTTP 404.")

    async def set_timer_duration(
        self,
        value: ProPresenterTimer,
        duration_seconds: int,
    ) -> ProPresenterTimer:
        return value.model_copy(
            update={"countdown": ProPresenterCountdown(duration=duration_seconds)}
        )

    async def reset_timer(self, _timer_id: str) -> None:
        return None

    async def start_timer(self, _timer_id: str) -> None:
        return None


@pytest.mark.asyncio
async def test_stop_request_rediscovers_a_recreated_timer() -> None:
    client = RecreatedTimerClient()
    settings = Settings(
        demo_mode=True,
        demo=DemoSettings(simulate_propresenter=False),
        propresenter=ProPresenterSettings(
            enabled=True,
            health_check_interval_seconds=300,
        ),
    )
    app = create_app(settings, propresenter_client_factory=lambda _settings: client)

    async with app.router.lifespan_context(app):
        outcome = await app.state.runtime.state_service.dispatch(
            ActionName.STOP_TIMER,
            source="test",
        )
        assert outcome.accepted is True

    assert client.stopped_ids == ["old-timer", "new-timer"]
    assert client.list_calls == 2
