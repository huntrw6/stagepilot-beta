"""Event-driven ProPresenter countdown output plugin."""

from __future__ import annotations

import asyncio
from contextlib import suppress
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
from stagepilot.core.propresenter import ProPresenterSnapshot, ProPresenterTimerSummary
from stagepilot.core.state import StateStore
from stagepilot.models.state import ConnectionStatus, PluginHealth, PluginStatus
from stagepilot.plugins.propresenter.client import (
    ProPresenterClient,
    ProPresenterClientContract,
    ProPresenterClientFactory,
)
from stagepilot.plugins.propresenter.errors import (
    ProPresenterError,
    ProPresenterTimerNotFoundError,
    ProPresenterTimerTypeError,
)
from stagepilot.plugins.propresenter.models import ProPresenterTimer


class ProPresenterPlugin(Plugin):
    """Translate song lifecycle events into one reusable ProPresenter countdown."""

    name = "propresenter"
    version = "0.2.0"

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
        self._timers: list[ProPresenterTimer] = []
        self._subscriptions: list[Subscription] = []
        self._operation_lock = asyncio.Lock()
        self._status = PluginStatus.STOPPED
        self._connection_status = ConnectionStatus.DISCONNECTED
        self._connection_detail: str | None = None
        self._last_error: str | None = None
        self._last_activity_at: datetime | None = None
        self._last_checked_at: datetime | None = None
        self._supervisor_task: asyncio.Task[None] | None = None
        self._stop_event = asyncio.Event()
        self._probe_event = asyncio.Event()
        self._logger = get_logger(self.name)

    async def start(self) -> None:
        self._status = PluginStatus.STARTING
        self._stop_event.clear()
        await self._set_connection(
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
        await self._probe(raise_errors=False)
        self._supervisor_task = asyncio.create_task(
            self._connection_supervisor(),
            name="stagepilot-propresenter-supervisor",
        )

    async def stop(self) -> None:
        self._status = PluginStatus.STOPPING
        self._stop_event.set()
        self._probe_event.set()
        task = self._supervisor_task
        self._supervisor_task = None
        if task is not None:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        await self._unsubscribe_all()
        async with self._operation_lock:
            await self._close_client_locked()
            self._timer = None
            self._timers = []
        self._status = PluginStatus.STOPPED
        self._last_activity_at = datetime.now(UTC)
        await self._set_connection(
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

    async def snapshot(self, *, refresh: bool = False) -> ProPresenterSnapshot:
        if refresh:
            await self._probe(raise_errors=False)
        return self._snapshot()

    async def test_connection(self) -> ProPresenterSnapshot:
        await self._probe(raise_errors=False)
        return self._snapshot()

    async def refresh_timers(self) -> ProPresenterSnapshot:
        await self._probe(raise_errors=False)
        return self._snapshot()

    async def reconfigure(self, settings: ProPresenterSettings) -> ProPresenterSnapshot:
        """Apply validated settings for this backend session and reconnect immediately."""

        async with self._operation_lock:
            await self._close_client_locked()
            self._settings = settings
            self._client = self._client_factory(settings)
            self._timer = None
            self._timers = []
            self._last_error = None
            await self._set_connection(
                ConnectionStatus.CONNECTING,
                f"Connecting to ProPresenter at {settings.base_url}.",
            )
            await self._probe_locked(raise_errors=False)
        self._probe_event.set()
        return self._snapshot()

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
                await self._configure_and_start_locked(duration)
            except Exception as exc:
                detail = self._public_error(exc, "ProPresenter timer start failed.")
                await self._record_operation_error(detail)
                await self._publish_failure(detail, duration)
                return

        await self._record_success(f'Countdown timer "{self._settings.timer_name}" is running.')
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
                await self._stop_timer_locked()
            except Exception as exc:
                detail = self._public_error(exc, "ProPresenter timer stop failed.")
                await self._record_operation_error(detail)
                await self._publish_failure(detail)
                return

        await self._record_success(f'Countdown timer "{self._settings.timer_name}" is stopped.')
        await self.event_bus.publish(
            new_event(
                EventType.TIMER_STOPPED,
                source=self.name,
                payload=TimerPayload(duration_seconds=0),
            )
        )

    async def _stop_timer_locked(self) -> None:
        try:
            timer = await self._require_timer_locked()
            await self._require_client().stop_timer(timer.id.uuid)
        except ProPresenterError:
            # Recover from a stale timer UUID after ProPresenter or the timer restarts.
            self._timer = None
            await self._probe_locked(raise_errors=True)
            timer = await self._require_timer_locked()
            await self._require_client().stop_timer(timer.id.uuid)

    async def _configure_and_start_locked(self, duration_seconds: int) -> None:
        try:
            await self._timer_sequence_locked(duration_seconds)
        except ProPresenterError:
            # ProPresenter restarts and timer recreation can invalidate cached UUIDs.
            self._timer = None
            await self._probe_locked(raise_errors=True)
            await self._timer_sequence_locked(duration_seconds)

    async def _timer_sequence_locked(self, duration_seconds: int) -> None:
        client = self._require_client()
        timer = await self._require_timer_locked()
        await client.stop_timer(timer.id.uuid)
        timer = await client.set_timer_duration(timer, duration_seconds)
        await client.reset_timer(timer.id.uuid)
        await client.start_timer(timer.id.uuid)
        self._timer = timer

    async def _require_timer_locked(self) -> ProPresenterTimer:
        if self._timer is None:
            await self._probe_locked(raise_errors=True)
        if self._timer is None:
            raise ProPresenterTimerNotFoundError(
                f'ProPresenter timer "{self._settings.timer_name}" was not found.'
            )
        return self._timer

    async def _probe(self, *, raise_errors: bool) -> bool:
        async with self._operation_lock:
            return await self._probe_locked(raise_errors=raise_errors)

    async def _probe_locked(self, *, raise_errors: bool) -> bool:
        self._last_checked_at = datetime.now(UTC)
        try:
            timers = await self._require_client().list_timers()
        except Exception as exc:
            detail = self._public_error(exc, "Could not reach the ProPresenter API.")
            self._timer = None
            self._timers = []
            self._status = PluginStatus.STARTING
            self._last_error = detail
            await self._set_connection(ConnectionStatus.ERROR, detail)
            if raise_errors:
                raise
            return False

        self._timers = timers
        matches = [
            timer
            for timer in timers
            if timer.id.name.strip().casefold() == self._settings.timer_name.casefold()
        ]
        timer_error: ProPresenterError | None = None
        if not matches:
            timer_error = ProPresenterTimerNotFoundError(
                f'API connected, but timer "{self._settings.timer_name}" was not found.'
            )
        elif len(matches) > 1:
            timer_error = ProPresenterTimerNotFoundError(
                f'API connected, but multiple timers are named "{self._settings.timer_name}".'
            )
        elif matches[0].countdown is None:
            timer_error = ProPresenterTimerTypeError(
                f'API connected, but timer "{self._settings.timer_name}" is not a countdown timer.'
            )

        if timer_error is not None:
            self._timer = None
            self._status = PluginStatus.ERROR
            self._last_error = str(timer_error)
            await self._set_connection(ConnectionStatus.CONNECTED, str(timer_error))
            if raise_errors:
                raise timer_error
            return False

        self._timer = matches[0]
        self._status = PluginStatus.RUNNING
        self._last_error = None
        self._last_activity_at = datetime.now(UTC)
        await self._set_connection(
            ConnectionStatus.CONNECTED,
            f'Connected; countdown timer "{self._timer.id.name}" is ready.',
        )
        return True

    async def _connection_supervisor(self) -> None:
        delay = self._settings.reconnect_initial_seconds
        while not self._stop_event.is_set():
            wait_seconds = (
                self._settings.health_check_interval_seconds if self._timer is not None else delay
            )
            try:
                await asyncio.wait_for(self._probe_event.wait(), timeout=wait_seconds)
                self._probe_event.clear()
            except TimeoutError:
                pass
            if self._stop_event.is_set():
                return
            connected = await self._probe(raise_errors=False)
            if connected:
                delay = self._settings.reconnect_initial_seconds
            else:
                delay = min(delay * 2, self._settings.reconnect_max_seconds)

    def _snapshot(self) -> ProPresenterSnapshot:
        selected = self._timer.id.uuid if self._timer is not None else None
        return ProPresenterSnapshot(
            enabled=self._settings.enabled,
            host=self._settings.host,
            port=self._settings.port,
            timer_name=self._settings.timer_name,
            request_timeout_seconds=self._settings.request_timeout_seconds,
            connection_status=self._connection_status,
            detail=self._connection_detail,
            timers=[
                ProPresenterTimerSummary(
                    id=timer.id.uuid,
                    name=timer.id.name,
                    index=timer.id.index,
                    is_countdown=timer.countdown is not None,
                    state=timer.state,
                )
                for timer in self._timers
            ],
            selected_timer_id=selected,
            timer_found=self._timer is not None,
            last_checked_at=self._last_checked_at,
        )

    def _require_client(self) -> ProPresenterClientContract:
        if self._client is None:
            raise RuntimeError("The ProPresenter client is not running.")
        return self._client

    async def _close_client_locked(self) -> None:
        client = self._client
        self._client = None
        if client is not None:
            await client.close()

    async def _unsubscribe_all(self) -> None:
        for subscription in self._subscriptions:
            await self.event_bus.unsubscribe(subscription)
        self._subscriptions.clear()

    async def _set_connection(self, status: ConnectionStatus, detail: str) -> None:
        self._connection_status = status
        self._connection_detail = detail
        self._last_checked_at = datetime.now(UTC)
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

    async def _record_success(self, detail: str) -> None:
        self._last_error = None
        self._last_activity_at = datetime.now(UTC)
        self._status = PluginStatus.RUNNING
        await self._set_connection(ConnectionStatus.CONNECTED, detail)

    async def _record_operation_error(self, detail: str) -> None:
        self._status = PluginStatus.ERROR
        self._last_error = detail
        self._last_activity_at = datetime.now(UTC)
        self._timer = None
        self._logger.error("propresenter_operation_failed", detail=detail)
        await self._set_connection(ConnectionStatus.ERROR, detail)
        self._probe_event.set()

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

    @staticmethod
    def _public_error(exc: Exception, fallback: str) -> str:
        if isinstance(exc, (ProPresenterError, ValueError, RuntimeError)):
            return str(exc)
        return fallback
