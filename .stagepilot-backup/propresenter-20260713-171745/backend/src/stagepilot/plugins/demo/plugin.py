"""In-memory plugin that simulates the Milestone 1 production workflow."""

from __future__ import annotations

from datetime import UTC, datetime

from stagepilot.core.event_bus import EventBus, Subscription
from stagepilot.core.events import EventType, SongPayload, StagePilotEvent
from stagepilot.core.plugin import Plugin
from stagepilot.core.state import StateStore
from stagepilot.models.state import PluginHealth, PluginStatus
from stagepilot.plugins.demo.data import demo_service_plan
from stagepilot.plugins.demo.events import (
    connection_ready,
    service_load_ready,
    service_loaded,
    timer_started,
    timer_stopped,
)


class DemoPlugin(Plugin):
    """Provide sample service, connection, and timer events for local development."""

    name = "demo"
    version = "0.1.0"

    def __init__(self, event_bus: EventBus, state_store: StateStore) -> None:
        super().__init__(event_bus, state_store)
        self._status = PluginStatus.STOPPED
        self._last_error: str | None = None
        self._last_activity_at: datetime | None = None
        self._subscriptions: list[Subscription] = []

    async def start(self) -> None:
        self._status = PluginStatus.STARTING
        self._subscriptions.extend(
            [
                await self.event_bus.subscribe(
                    EventType.SONG_STARTED, self._on_song_started
                ),
                await self.event_bus.subscribe(
                    EventType.SONG_RESTARTED, self._on_song_started
                ),
                await self.event_bus.subscribe(
                    EventType.TIMER_STOP_REQUESTED, self._on_timer_stop_requested
                ),
                await self.event_bus.subscribe(
                    EventType.SERVICE_RELOAD_REQUESTED, self._on_reload_requested
                ),
            ]
        )
        plan = demo_service_plan()
        await self.event_bus.publish(service_loaded(plan))
        await self.event_bus.publish(service_load_ready(plan))
        for integration in ("planning_center", "midi", "propresenter"):
            await self.event_bus.publish(connection_ready(integration))
        await self.event_bus.publish(timer_stopped())
        self._status = PluginStatus.RUNNING
        self._last_activity_at = datetime.now(UTC)

    async def stop(self) -> None:
        self._status = PluginStatus.STOPPING
        for subscription in self._subscriptions:
            await self.event_bus.unsubscribe(subscription)
        self._subscriptions.clear()
        self._status = PluginStatus.STOPPED
        self._last_activity_at = datetime.now(UTC)

    async def health(self) -> PluginHealth:
        return PluginHealth(
            name=self.name,
            version=self.version,
            status=self._status,
            last_error=self._last_error,
            last_activity_at=self._last_activity_at,
        )

    async def _on_song_started(self, event: StagePilotEvent) -> None:
        if (
            not isinstance(event.payload, SongPayload)
            or not event.payload.song.duration_seconds
        ):
            return
        self._last_activity_at = datetime.now(UTC)
        await self.event_bus.publish(timer_started(event.payload.song.duration_seconds))

    async def _on_timer_stop_requested(self, _event: StagePilotEvent) -> None:
        self._last_activity_at = datetime.now(UTC)
        await self.event_bus.publish(timer_stopped())

    async def _on_reload_requested(self, _event: StagePilotEvent) -> None:
        self._last_activity_at = datetime.now(UTC)
        plan = demo_service_plan()
        await self.event_bus.publish(service_loaded(plan))
        await self.event_bus.publish(service_load_ready(plan))
