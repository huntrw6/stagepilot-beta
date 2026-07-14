"""Event-driven ProPresenter countdown output plugin."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from stagepilot.core.config import ProPresenterSettings
from stagepilot.core.event_bus import EventBus, Subscription
from stagepilot.core.events import (
    ConnectionPayload,
    EventType,
    SongPayload,
    StagePilotEvent,
    TimerPayload,
    new_event,
)
from stagepilot.core.logging import get_logger
from stagepilot.core.plugin import Plugin
from stagepilot.core.state import StateStore
from stagepilot.models.state import ConnectionStatus, PluginHealth, PluginStatus
from stagepilot.plugins.propresenter.client import (
    ProPresenterClient,
    ProPresenterClientContract,
    ProPresenterClientFactory,
)
from stagepilot.plugins.propresenter.errors import ProPresenterError
from stagepilot.plugins.propresenter.models import ProPresenterTimer


class ProPresenterPlugin(Plugin):
    """Translate song lifecycle events into one reusable ProPresenter countdown."""

    name = "propresenter"
    version = "0.1.0"

    def __init__(
        self,
        event_bus: EventBus,
        state_store: StateStore,
        settings: ProPresenterSettings,
        *,
        client_factory: ProPresenterClientFactory | None = None,
    ) -> None:
        super().__init__(event_bus, state_store)
        self._settings = settings
        self._client_factory = client_factory or ProPresenterClient
        self._client: ProPresenterClientContract | None = None
        self._timer: ProPresenterTimer | None = None
        self._subscriptions: list[Subscription] = []
        self._operation_lock = asyncio.Lock()
        self._status = PluginStatus.STOPPED
        self._last_error: str | None = None
        self._last_activity_at: datetime | None = None
        self._logger = get_logger(self.name)

    async def start(self) -> None:
        self._status = PluginStatus.STARTING
        await self._publish_connection(
            ConnectionStatus.CONNECTING,
            f"Connecting to ProPresenter at {self._settings.base_url}.",
        )
        self._client = self._client_factory(self._settings)
        self._subscriptions.extend(
            [
                await self.event_bus.subscribe(EventType.SONG_STARTED, self._on_song_event),
                await self.event_bus.subscribe(EventType.SONG_RESTARTED, self._on_song_event),
                await self.event_bus.subscribe(
                    EventType.TIMER_STOP_REQUESTED,
                    self._on_timer_stop_requested,
                ),
            ]
        )
        try:
            timer = await self._discover_timer()
        except Exception as exc:
            detail = self._public_error(exc, "Could not initialize ProPresenter.")
            self._record_error(detail)
            await self._publish_connection(ConnectionStatus.ERROR, detail)
            # Keep the plugin subscribed. The next timer command will rediscover the
            # timer, allowing recovery when ProPresenter is opened after StagePilot.
            return

        self._status = PluginStatus.RUNNING
        self._last_error = None
        self._last_activity_at = datetime.now(UTC)
        await self._publish_connection(
            ConnectionStatus.CONNECTED,
            f'Connected; countdown timer "{timer.id.name}" is ready.',
        )

    async def stop(self) -> None:
        self._status = PluginStatus.STOPPING
        await self._unsubscribe_all()
        await self._close_client()
        self._timer = None
        self._status = PluginStatus.STOPPED
        self._last_activity_at = datetime.now(UTC)
        await self._publish_connection(
            ConnectionStatus.DISCONNECTED,
            "ProPresenter integration stopped.",
        )

    async def health(self) -> PluginHealth:
        return PluginHealth(
            name=self.name,
            version=self.version,
            status=self._status,
            last_error=self._last_error,
            last_activity_at=self._last_activity_at,
        )

    async def _on_song_event(self, event: StagePilotEvent) -> None:
        if not isinstance(event.payload, SongPayload):
            return
        duration = event.payload.song.duration_seconds
        if duration is None or duration <= 0:
            await self._publish_failure(
                f'Cannot start countdown for "{event.payload.song.title}": '
                "the song has no positive duration."
            )
            return

        async with self._operation_lock:
            try:
                await self._configure_and_start(duration)
            except Exception as exc:
                detail = self._public_error(exc, "ProPresenter timer start failed.")
                self._record_error(detail)
                await self._publish_connection(ConnectionStatus.ERROR, detail)
                await self._publish_failure(detail, duration)
                return

        self._last_error = None
        self._last_activity_at = datetime.now(UTC)
        self._status = PluginStatus.RUNNING
        await self._publish_connection(
            ConnectionStatus.CONNECTED,
            f'Countdown timer "{self._settings.timer_name}" is running.',
        )
        await self.event_bus.publish(
            new_event(
                EventType.TIMER_STARTED,
                source=self.name,
                payload=TimerPayload(duration_seconds=duration),
            )
        )

    async def _on_timer_stop_requested(self, _event: StagePilotEvent) -> None:
        async with self._operation_lock:
            try:
                timer = await self._require_timer()
                await self._require_client().stop_timer(timer.id.uuid)
            except Exception as exc:
                detail = self._public_error(exc, "ProPresenter timer stop failed.")
                self._record_error(detail)
                await self._publish_connection(ConnectionStatus.ERROR, detail)
                await self._publish_failure(detail)
                return

        self._last_error = None
        self._last_activity_at = datetime.now(UTC)
        self._status = PluginStatus.RUNNING
        await self._publish_connection(
            ConnectionStatus.CONNECTED,
            f'Countdown timer "{self._settings.timer_name}" is stopped.',
        )
        await self.event_bus.publish(
            new_event(
                EventType.TIMER_STOPPED,
                source=self.name,
                payload=TimerPayload(duration_seconds=0),
            )
        )

    async def _configure_and_start(self, duration_seconds: int) -> None:
        client = self._require_client()
        timer = await self._require_timer()
        try:
            await client.stop_timer(timer.id.uuid)
            timer = await client.set_timer_duration(timer, duration_seconds)
            await client.reset_timer(timer.id.uuid)
            await client.start_timer(timer.id.uuid)
        except ProPresenterError:
            # A ProPresenter restart can invalidate the cached timer UUID. Rediscover once.
            self._timer = None
            timer = await self._discover_timer()
            await client.stop_timer(timer.id.uuid)
            timer = await client.set_timer_duration(timer, duration_seconds)
            await client.reset_timer(timer.id.uuid)
            await client.start_timer(timer.id.uuid)
        self._timer = timer

    async def _require_timer(self) -> ProPresenterTimer:
        if self._timer is None:
            return await self._discover_timer()
        return self._timer

    async def _discover_timer(self) -> ProPresenterTimer:
        timer = await self._require_client().find_timer(self._settings.timer_name)
        self._timer = timer
        self._last_activity_at = datetime.now(UTC)
        return timer

    def _require_client(self) -> ProPresenterClientContract:
        if self._client is None:
            raise RuntimeError("The ProPresenter client is not running.")
        return self._client

    async def _close_client(self) -> None:
        client = self._client
        self._client = None
        if client is not None:
            await client.close()

    async def _unsubscribe_all(self) -> None:
        for subscription in self._subscriptions:
            await self.event_bus.unsubscribe(subscription)
        self._subscriptions.clear()

    async def _publish_connection(
        self,
        status: ConnectionStatus,
        detail: str,
    ) -> None:
        await self.event_bus.publish(
            new_event(
                EventType.CONNECTION_CHANGED,
                source=self.name,
                payload=ConnectionPayload(
                    integration="propresenter",
                    status=status,
                    detail=detail,
                ),
            )
        )

    async def _publish_failure(
        self,
        message: str,
        duration_seconds: int = 0,
    ) -> None:
        await self.event_bus.publish(
            new_event(
                EventType.TIMER_FAILED,
                source=self.name,
                payload=TimerPayload(
                    duration_seconds=duration_seconds,
                    message=message,
                ),
            )
        )

    def _record_error(self, detail: str) -> None:
        self._status = PluginStatus.ERROR
        self._last_error = detail
        self._last_activity_at = datetime.now(UTC)
        self._logger.error("propresenter_operation_failed", detail=detail)

    @staticmethod
    def _public_error(exc: Exception, fallback: str) -> str:
        if isinstance(exc, (ProPresenterError, ValueError, RuntimeError)):
            return str(exc)
        return fallback
