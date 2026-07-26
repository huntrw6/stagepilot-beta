from __future__ import annotations

from typing import cast

from stagepilot.core.actions import ActionOutcome
from stagepilot.core.config import LightsSettings, ProPresenterSettings
from stagepilot.core.lights import LightsController, LightsSnapshot
from stagepilot.core.midi import MidiController, MidiInputSnapshot
from stagepilot.core.propresenter import ProPresenterController, ProPresenterSnapshot
from stagepilot.core.state import StateStore
from stagepilot.models.state import ApplicationState, ConnectionStatus
from stagepilot.services.startup_activation import (
    PlanningCenterStartupController,
    StartupActivationService,
    StartupPluginManager,
)


class FakePluginManager:
    def __init__(self) -> None:
        self.restart_calls = 0

    async def restart_failed(self) -> None:
        self.restart_calls += 1


class FakeMidi:
    def __init__(self) -> None:
        self.refreshes: list[bool] = []

    async def input_snapshot(self, *, refresh: bool = False) -> MidiInputSnapshot:
        self.refreshes.append(refresh)
        return MidiInputSnapshot(
            enabled=True,
            channel=1,
            note=112,
            configured_input_name="Playback",
            selected_input_name="Playback",
            inputs=(),
            mappings=(),
        )


class FakeProPresenter:
    def __init__(self, status: ConnectionStatus, *, timer_found: bool) -> None:
        self.status = status
        self.timer_found = timer_found
        self.reconfigure_calls: list[ProPresenterSettings] = []

    def _snapshot(self) -> ProPresenterSnapshot:
        return ProPresenterSnapshot(
            enabled=True,
            host="127.0.0.1",
            port=1025,
            timer_name="Song Countdown",
            request_timeout_seconds=3,
            connection_status=self.status,
            timer_found=self.timer_found,
            look_found=True,
        )

    async def snapshot(self, *, refresh: bool = False) -> ProPresenterSnapshot:
        return self._snapshot()

    async def reconfigure(self, settings: ProPresenterSettings) -> ProPresenterSnapshot:
        self.reconfigure_calls.append(settings)
        self.status = ConnectionStatus.CONNECTED
        self.timer_found = True
        return self._snapshot()


class FakeLights:
    def __init__(self, status: ConnectionStatus) -> None:
        self.status = status
        self.reconfigure_calls: list[LightsSettings] = []

    async def snapshot(self, *, refresh: bool = False) -> LightsSnapshot:
        return LightsSnapshot(
            enabled=True,
            output_name="StagePilot Lights",
            channel=1,
            pulse_ms=100,
            connection_status=self.status,
        )

    async def reconfigure(self, settings: LightsSettings) -> ActionOutcome:
        self.reconfigure_calls.append(settings)
        self.status = ConnectionStatus.CONNECTED
        return ActionOutcome(True, "connected")


class FakePlanningCenter:
    def __init__(self) -> None:
        self.refresh_calls = 0

    async def refresh_now(self) -> None:
        self.refresh_calls += 1


def activation_service(
    *,
    state: ApplicationState,
    propresenter: FakeProPresenter,
    lights: FakeLights,
) -> tuple[
    StartupActivationService,
    FakePluginManager,
    FakeMidi,
    FakePlanningCenter,
]:
    manager = FakePluginManager()
    midi = FakeMidi()
    planning_center = FakePlanningCenter()
    propresenter_settings = ProPresenterSettings(enabled=True)
    lights_settings = LightsSettings(
        enabled=True,
        output_name="StagePilot Lights",
    )
    service = StartupActivationService(
        plugin_manager=cast(StartupPluginManager, manager),
        state_store=StateStore(state),
        midi=cast(MidiController, midi),
        propresenter=cast(ProPresenterController, propresenter),
        propresenter_settings=propresenter_settings,
        lights=cast(LightsController, lights),
        lights_settings=lights_settings,
        planning_center=cast(PlanningCenterStartupController, planning_center),
    )
    return service, manager, midi, planning_center


async def test_startup_activation_retries_and_connects_saved_integrations() -> None:
    propresenter = FakeProPresenter(ConnectionStatus.DISCONNECTED, timer_found=False)
    lights = FakeLights(ConnectionStatus.DISCONNECTED)
    service, manager, midi, planning_center = activation_service(
        state=ApplicationState(planning_center_status=ConnectionStatus.DISCONNECTED),
        propresenter=propresenter,
        lights=lights,
    )

    await service.run()

    assert manager.restart_calls == 1
    assert midi.refreshes == [True]
    assert len(propresenter.reconfigure_calls) == 1
    assert len(lights.reconfigure_calls) == 1
    assert planning_center.refresh_calls == 1


async def test_startup_activation_does_not_disrupt_ready_integrations() -> None:
    propresenter = FakeProPresenter(ConnectionStatus.CONNECTED, timer_found=True)
    lights = FakeLights(ConnectionStatus.CONNECTED)
    service, manager, midi, planning_center = activation_service(
        state=ApplicationState(planning_center_status=ConnectionStatus.CONNECTED),
        propresenter=propresenter,
        lights=lights,
    )

    await service.run()

    assert manager.restart_calls == 1
    assert midi.refreshes == [True]
    assert propresenter.reconfigure_calls == []
    assert lights.reconfigure_calls == []
    assert planning_center.refresh_calls == 0
