from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from stagepilot.core.config import DemoSettings, ProPresenterSettings, Settings
from stagepilot.core.events import ActionName
from stagepilot.main import create_app
from stagepilot.models.state import ConnectionStatus, TimerStatus
from stagepilot.plugins.propresenter import (
    ProPresenterCountdown,
    ProPresenterIdentifier,
    ProPresenterTimer,
)


@dataclass
class FakeProPresenterClient:
    timer: ProPresenterTimer = field(
        default_factory=lambda: ProPresenterTimer(
            id=ProPresenterIdentifier(
                uuid="timer-uuid",
                name="Song Countdown",
                index=0,
            ),
            allows_overrun=False,
            countdown=ProPresenterCountdown(duration=60),
        )
    )
    calls: list[tuple[str, object | None]] = field(default_factory=list)
    closed: bool = False

    async def close(self) -> None:
        self.closed = True

    async def list_timers(self) -> list[ProPresenterTimer]:
        return [self.timer]

    async def find_timer(self, name: str) -> ProPresenterTimer:
        self.calls.append(("find", name))
        return self.timer

    async def stop_timer(self, timer_id: str) -> None:
        self.calls.append(("stop", timer_id))

    async def set_timer_duration(
        self,
        timer: ProPresenterTimer,
        duration_seconds: int,
    ) -> ProPresenterTimer:
        self.calls.append(("set", duration_seconds))
        self.timer = timer.model_copy(
            update={"countdown": ProPresenterCountdown(duration=duration_seconds)}
        )
        return self.timer

    async def reset_timer(self, timer_id: str) -> None:
        self.calls.append(("reset", timer_id))

    async def start_timer(self, timer_id: str) -> None:
        self.calls.append(("start", timer_id))


@pytest.mark.asyncio
async def test_demo_plan_can_drive_real_propresenter_plugin() -> None:
    fake = FakeProPresenterClient()
    settings = Settings(
        demo_mode=True,
        demo=DemoSettings(simulate_propresenter=False),
        propresenter=ProPresenterSettings(enabled=True),
    )
    app = create_app(
        settings,
        propresenter_client_factory=lambda _settings: fake,
    )

    async with app.router.lifespan_context(app):
        runtime = app.state.runtime
        initial = await runtime.state_store.snapshot()
        assert initial.plan is not None
        assert initial.plan.songs[0].title == "Battle Belongs"
        assert initial.propresenter_status is ConnectionStatus.CONNECTED

        outcome = await runtime.state_service.dispatch(ActionName.START_NEXT, source="test")
        assert outcome.accepted
        running = await runtime.state_store.snapshot()
        assert running.current_song is not None
        assert running.current_song.title == "Battle Belongs"
        assert running.timer.status is TimerStatus.RUNNING
        assert running.timer.duration_seconds == 281

        assert fake.calls == [
            ("find", "Song Countdown"),
            ("stop", "timer-uuid"),
            ("set", 281),
            ("reset", "timer-uuid"),
            ("start", "timer-uuid"),
        ]

        restart = await runtime.state_service.dispatch(ActionName.RESTART_CURRENT, source="test")
        assert restart.accepted
        assert fake.calls[-4:] == [
            ("stop", "timer-uuid"),
            ("set", 281),
            ("reset", "timer-uuid"),
            ("start", "timer-uuid"),
        ]

        stopped = await runtime.state_service.dispatch(ActionName.STOP_TIMER, source="test")
        assert stopped.accepted
        state = await runtime.state_store.snapshot()
        assert state.timer.status is TimerStatus.STOPPED
        assert fake.calls[-1] == ("stop", "timer-uuid")

    assert fake.closed
