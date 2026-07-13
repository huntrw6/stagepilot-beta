"""Production Planning Center plugin lifecycle and plan refresh orchestration."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from contextlib import suppress
from datetime import UTC, date, datetime, timedelta
from typing import Protocol
from zoneinfo import ZoneInfo

from stagepilot.core.config import PlanningCenterSettings
from stagepilot.core.event_bus import EventBus, Subscription
from stagepilot.core.events import (
    ConnectionPayload,
    EventType,
    ServiceLoadPayload,
    ServicePayload,
    ServicePlanSelectionPayload,
    StagePilotEvent,
    new_event,
)
from stagepilot.core.logging import get_logger
from stagepilot.core.plugin import Plugin
from stagepilot.core.state import StateStore
from stagepilot.models.state import (
    ApplicationState,
    ConnectionStatus,
    PluginHealth,
    PluginStatus,
    ServiceLoadStatus,
    ServicePlanCandidate,
    SkippedServiceItem,
)
from stagepilot.plugins.planning_center.client import PlanningCenterClient
from stagepilot.plugins.planning_center.errors import (
    PlanningCenterConfigurationError,
    PlanningCenterError,
    PlanningCenterPlanSelectionError,
)
from stagepilot.plugins.planning_center.models import (
    PlanAmbiguousResult,
    PlanDiscoveryResult,
    PlanLoadedResult,
    PlanningCenterPlanCandidate,
    PlanningCenterServiceType,
    PlanNotFoundResult,
)


class PlanningCenterClientContract(Protocol):
    async def list_service_types(self) -> list[PlanningCenterServiceType]: ...

    async def load_plan_for_date(
        self,
        service_type: PlanningCenterServiceType,
        target_date: date,
        timezone_name: str,
        *,
        selected_plan_id: str | None = None,
        lookahead_days: int = 0,
    ) -> PlanDiscoveryResult: ...

    async def close(self) -> None: ...


type PlanningCenterClientFactory = Callable[[PlanningCenterSettings], PlanningCenterClientContract]
type TodayProvider = Callable[[ZoneInfo], date]


def _local_today(timezone: ZoneInfo) -> date:
    return datetime.now(timezone).date()


class PlanningCenterPlugin(Plugin):
    """Load and safely refresh the configured Planning Center service plan."""

    name = "planning_center"
    version = "0.1.0"

    def __init__(
        self,
        event_bus: EventBus,
        state_store: StateStore,
        settings: PlanningCenterSettings,
        *,
        timezone_name: str,
        client_factory: PlanningCenterClientFactory | None = None,
        today_provider: TodayProvider | None = None,
    ) -> None:
        super().__init__(event_bus, state_store)
        self._settings = settings
        self._timezone_name = timezone_name
        self._timezone = ZoneInfo(timezone_name)
        self._client_factory = client_factory or PlanningCenterClient
        self._today_provider = today_provider or _local_today
        self._client: PlanningCenterClientContract | None = None
        self._subscriptions: list[Subscription] = []
        self._active_refresh_task: asyncio.Task[None] | None = None
        self._pending_selection_id: str | None = None
        self._pending_reload = False
        self._status = PluginStatus.STOPPED
        self._last_error: str | None = None
        self._last_activity_at: datetime | None = None
        self._stopping = False
        self._logger = get_logger(self.name)

    async def start(self) -> None:
        self._status = PluginStatus.STARTING
        self._stopping = False
        try:
            self._validate_configuration()
            self._client = self._client_factory(self._settings)
            self._subscriptions.extend(
                [
                    await self.event_bus.subscribe(
                        EventType.SERVICE_RELOAD_REQUESTED,
                        self._on_reload_requested,
                    ),
                    await self.event_bus.subscribe(
                        EventType.SERVICE_PLAN_SELECTION_REQUESTED,
                        self._on_plan_selection_requested,
                    ),
                ]
            )
        except PlanningCenterError as exc:
            await self._handle_start_failure(str(exc))
            raise
        except Exception:
            detail = "Planning Center plugin initialization failed unexpectedly."
            self._logger.error("planning_center_unexpected_initialization_failure")
            await self._handle_start_failure(detail)
            raise PlanningCenterError(detail) from None

        self._status = PluginStatus.RUNNING
        task = asyncio.create_task(self._run_scheduled_refresh())
        self._active_refresh_task = task
        await task

    async def stop(self) -> None:
        if self._status is PluginStatus.STOPPED and self._client is None:
            return
        self._status = PluginStatus.STOPPING
        self._stopping = True
        for subscription in self._subscriptions:
            await self.event_bus.unsubscribe(subscription)
        self._subscriptions.clear()

        task = self._active_refresh_task
        if task is not None and not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        self._active_refresh_task = None
        self._pending_selection_id = None
        self._pending_reload = False

        close_error: Exception | None = None
        try:
            await self._close_client()
        except Exception as exc:  # shutdown must complete even if a transport close fails
            close_error = exc
        finally:
            await self._publish_connection(
                ConnectionStatus.DISCONNECTED,
                "Planning Center plugin stopped.",
            )
            self._status = PluginStatus.STOPPED
            self._last_activity_at = datetime.now(UTC)
        if close_error is not None:
            self._last_error = "Planning Center client shutdown failed."
            raise PlanningCenterError(self._last_error) from None

    async def health(self) -> PluginHealth:
        return PluginHealth(
            name=self.name,
            version=self.version,
            status=self._status,
            last_error=self._last_error,
            last_activity_at=self._last_activity_at,
        )

    async def _on_reload_requested(self, _event: StagePilotEvent) -> None:
        if self._stopping:
            return
        task = self._active_refresh_task
        if task is not None and not task.done():
            self._pending_reload = True
            return
        self._active_refresh_task = asyncio.create_task(self._run_scheduled_refresh())

    async def _on_plan_selection_requested(self, event: StagePilotEvent) -> None:
        if self._stopping or not isinstance(event.payload, ServicePlanSelectionPayload):
            return
        snapshot = await self.state_store.snapshot()
        today = self._safe_today()
        target_date = snapshot.service_load.target_date
        candidate_ids = {
            candidate.id
            for candidate in snapshot.service_load.candidates
            if candidate.target_date == target_date
        }
        if (
            snapshot.service_load.status is not ServiceLoadStatus.AMBIGUOUS
            or target_date is None
            or target_date < today
        ):
            if event.payload.plan_id in {
                candidate.id for candidate in snapshot.service_load.candidates
            }:
                await self._request_regular_refresh(wait=True)
            return
        if event.payload.plan_id not in candidate_ids:
            return

        task = self._active_refresh_task
        if task is None or task.done():
            task = asyncio.create_task(
                self._run_scheduled_refresh(
                    initial_selection_id=event.payload.plan_id,
                )
            )
            self._active_refresh_task = task
        else:
            self._pending_selection_id = event.payload.plan_id
        await asyncio.shield(task)

    async def _request_regular_refresh(self, *, wait: bool) -> None:
        if self._stopping:
            return
        task = self._active_refresh_task
        if task is None or task.done():
            task = asyncio.create_task(self._run_scheduled_refresh())
            self._active_refresh_task = task
        else:
            self._pending_reload = True
        if wait:
            await asyncio.shield(task)

    async def _run_scheduled_refresh(
        self,
        *,
        initial_selection_id: str | None = None,
    ) -> None:
        selected_plan_id = initial_selection_id
        try:
            while not self._stopping:
                await self._refresh_once(selected_plan_id=selected_plan_id)
                if self._pending_selection_id is not None:
                    selected_plan_id = self._pending_selection_id
                    self._pending_selection_id = None
                    self._pending_reload = False
                    continue
                if self._pending_reload:
                    self._pending_reload = False
                    selected_plan_id = None
                    continue
                return
        finally:
            self._active_refresh_task = None

    async def _refresh_once(self, *, selected_plan_id: str | None = None) -> None:
        search_date = self._safe_today()
        previous_state = await self.state_store.snapshot()
        previous_plan_date = self._actionable_plan_date(previous_state, search_date)
        has_actionable_plan = previous_plan_date is not None
        previous_candidate_date = previous_state.service_load.target_date
        previous_candidates = (
            [
                candidate
                for candidate in previous_state.service_load.candidates
                if candidate.target_date == previous_candidate_date
            ]
            if previous_candidate_date is not None and previous_candidate_date >= search_date
            else []
        )
        previous_skipped_items = (
            previous_state.service_load.skipped_items if has_actionable_plan else []
        )
        retained_target_date = (
            previous_plan_date
            or (previous_candidate_date if len(previous_candidates) >= 2 else None)
            or search_date
        )
        await self._publish_load_state(
            ServiceLoadStatus.LOADING,
            retained_target_date,
            skipped_items=previous_skipped_items,
            message="Looking for the current or next upcoming Planning Center plan.",
            is_stale=has_actionable_plan,
        )
        await self._publish_connection(
            ConnectionStatus.CONNECTING,
            "Loading Planning Center Services.",
        )

        api_connected = False
        try:
            client = self._require_client()
            service_types = await client.list_service_types()
            api_connected = True
            service_type = self._configured_service_type(service_types)
            result = await client.load_plan_for_date(
                service_type,
                search_date,
                self._timezone_name,
                selected_plan_id=selected_plan_id,
                lookahead_days=self._settings.upcoming_lookahead_days,
            )
        except PlanningCenterPlanSelectionError as exc:
            self._record_error(str(exc))
            await self._publish_connection(ConnectionStatus.CONNECTED, str(exc))
            await self._publish_load_state(
                ServiceLoadStatus.AMBIGUOUS
                if len(previous_candidates) >= 2
                else ServiceLoadStatus.ERROR,
                retained_target_date,
                candidates=previous_candidates,
                skipped_items=previous_skipped_items,
                message=str(exc),
                is_stale=has_actionable_plan,
            )
            return
        except PlanningCenterError as exc:
            detail = str(exc)
            self._record_error(detail)
            connection_status = (
                ConnectionStatus.CONNECTED
                if api_connected and isinstance(exc, PlanningCenterConfigurationError)
                else ConnectionStatus.ERROR
            )
            await self._publish_connection(connection_status, detail)
            await self._publish_load_state(
                ServiceLoadStatus.AMBIGUOUS
                if selected_plan_id is not None and len(previous_candidates) >= 2
                else ServiceLoadStatus.ERROR,
                retained_target_date,
                candidates=(
                    previous_candidates
                    if selected_plan_id is not None and len(previous_candidates) >= 2
                    else []
                ),
                skipped_items=previous_skipped_items,
                message=detail,
                is_stale=has_actionable_plan,
            )
            return
        except Exception:
            detail = "Planning Center plan loading failed unexpectedly."
            self._logger.error("planning_center_unexpected_load_failure")
            self._record_error(detail)
            await self._publish_connection(ConnectionStatus.ERROR, detail)
            await self._publish_load_state(
                ServiceLoadStatus.AMBIGUOUS
                if selected_plan_id is not None and len(previous_candidates) >= 2
                else ServiceLoadStatus.ERROR,
                retained_target_date,
                candidates=(
                    previous_candidates
                    if selected_plan_id is not None and len(previous_candidates) >= 2
                    else []
                ),
                skipped_items=previous_skipped_items,
                message=detail,
                is_stale=has_actionable_plan,
            )
            return

        self._status = PluginStatus.RUNNING
        self._last_error = None
        self._last_activity_at = datetime.now(UTC)
        await self._publish_connection(
            ConnectionStatus.CONNECTED,
            "Planning Center Services is connected.",
        )
        try:
            await self._apply_result(
                result,
                search_date,
                previous_plan_date,
                previous_skipped_items,
            )
        except Exception:
            detail = "Planning Center plan projection failed unexpectedly."
            self._logger.error("planning_center_unexpected_projection_failure")
            self._record_error(detail)
            current_state = await self.state_store.snapshot()
            current_plan_date = self._actionable_plan_date(current_state, search_date)
            await self._publish_connection(ConnectionStatus.ERROR, detail)
            await self._publish_load_state(
                ServiceLoadStatus.AMBIGUOUS
                if selected_plan_id is not None and len(previous_candidates) >= 2
                else ServiceLoadStatus.ERROR,
                current_plan_date or retained_target_date,
                candidates=(
                    previous_candidates
                    if selected_plan_id is not None and len(previous_candidates) >= 2
                    else []
                ),
                skipped_items=previous_skipped_items,
                message=detail,
                is_stale=current_plan_date is not None,
            )
            return

    async def _apply_result(
        self,
        result: PlanDiscoveryResult,
        search_date: date,
        previous_plan_date: date | None,
        previous_skipped_items: list[SkippedServiceItem],
    ) -> None:
        search_end_date = search_date + timedelta(days=self._settings.upcoming_lookahead_days)
        if isinstance(result, PlanNotFoundResult):
            if result.target_date != search_date:
                raise RuntimeError("Planning Center returned an invalid search anchor.")
            retained_plan = previous_plan_date is not None
            target_date = previous_plan_date or result.target_date
            message = (
                "No current or upcoming Planning Center plan was found through "
                f"{search_end_date.isoformat()}; keeping the previously loaded plan stale."
                if retained_plan
                else "No Planning Center service plan was found from "
                f"{result.target_date.isoformat()} through {search_end_date.isoformat()}."
            )
            await self._publish_load_state(
                ServiceLoadStatus.NOT_FOUND,
                target_date,
                skipped_items=previous_skipped_items if retained_plan else [],
                message=message,
                is_stale=retained_plan,
            )
            return
        if isinstance(result, PlanAmbiguousResult):
            if not search_date <= result.target_date <= search_end_date:
                raise RuntimeError("Planning Center returned candidates outside the search window.")
            retained_plan = previous_plan_date == result.target_date
            await self._publish_load_state(
                ServiceLoadStatus.AMBIGUOUS,
                result.target_date,
                candidates=[self._candidate(value) for value in result.candidates],
                skipped_items=previous_skipped_items if retained_plan else [],
                message=(
                    "Multiple Planning Center plans match "
                    f"{result.target_date.isoformat()}. Select one to continue."
                ),
                is_stale=retained_plan,
            )
            return
        if not isinstance(result, PlanLoadedResult):
            raise AssertionError("Unsupported Planning Center discovery result.")

        loaded_date = result.plan.date
        if (
            not search_date <= loaded_date <= search_end_date
            or result.candidate.target_date != loaded_date
            or result.candidate.id != result.plan.id
        ):
            raise RuntimeError("Planning Center returned an invalid loaded plan.")
        if previous_plan_date is not None and previous_plan_date != loaded_date:
            await self._publish_load_state(
                ServiceLoadStatus.LOADING,
                loaded_date,
                message=f"Loading the Planning Center plan for {loaded_date.isoformat()}.",
            )

        before_projection = await self.state_store.snapshot()
        report = await self.event_bus.publish(
            new_event(
                EventType.SERVICE_LOADED,
                source=self.name,
                payload=ServicePayload(plan=result.plan),
            )
        )
        projected = await self.state_store.snapshot()
        if (
            report.failures
            or projected.revision <= before_projection.revision
            or projected.plan != result.plan
        ):
            raise RuntimeError("Planning Center plan was not projected into application state.")
        await self._publish_load_state(
            ServiceLoadStatus.LOADED,
            loaded_date,
            skipped_items=[
                SkippedServiceItem(
                    item_id=item.item_id,
                    title=item.title,
                    item_type=item.item_type,
                    sequence=item.sequence,
                    reason=item.reason,
                )
                for item in result.skipped_items
            ],
            message=(
                f'Loaded "{result.plan.title}" for {loaded_date.isoformat()} from Planning Center.'
            ),
        )

    async def _publish_failure(
        self,
        target_date: date,
        detail: str,
    ) -> None:
        state = await self.state_store.snapshot()
        plan_date = self._actionable_plan_date(state, target_date)
        await self._publish_connection(ConnectionStatus.ERROR, detail)
        await self._publish_load_state(
            ServiceLoadStatus.ERROR,
            plan_date or target_date,
            skipped_items=state.service_load.skipped_items if plan_date is not None else [],
            message=detail,
            is_stale=plan_date is not None,
        )

    async def _publish_load_state(
        self,
        status: ServiceLoadStatus,
        target_date: date,
        *,
        candidates: list[ServicePlanCandidate] | None = None,
        skipped_items: list[SkippedServiceItem] | None = None,
        message: str | None = None,
        is_stale: bool = False,
    ) -> None:
        await self.event_bus.publish(
            new_event(
                EventType.SERVICE_LOAD_CHANGED,
                source=self.name,
                payload=ServiceLoadPayload(
                    status=status,
                    target_date=target_date,
                    candidates=candidates or [],
                    skipped_items=skipped_items or [],
                    message=message,
                    is_stale=is_stale,
                ),
            )
        )

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
                    integration="planning_center",
                    status=status,
                    detail=detail,
                ),
            )
        )

    def _validate_configuration(self) -> None:
        if not self._settings.is_configured:
            raise PlanningCenterConfigurationError(
                "Planning Center credentials are not configured."
            )
        if self._settings.service_type_id is None:
            raise PlanningCenterConfigurationError(
                "A Planning Center service type must be configured."
            )

    def _require_client(self) -> PlanningCenterClientContract:
        if self._client is None:
            raise PlanningCenterConfigurationError("Planning Center is not initialized.")
        return self._client

    def _configured_service_type(
        self,
        service_types: list[PlanningCenterServiceType],
    ) -> PlanningCenterServiceType:
        configured_id = self._settings.service_type_id
        service_type = next(
            (value for value in service_types if value.id == configured_id),
            None,
        )
        if service_type is None:
            raise PlanningCenterConfigurationError(
                "The configured Planning Center service type is unavailable."
            )
        if service_type.archived:
            raise PlanningCenterConfigurationError(
                "The configured Planning Center service type is archived."
            )
        return service_type

    @staticmethod
    def _candidate(candidate: PlanningCenterPlanCandidate) -> ServicePlanCandidate:
        return ServicePlanCandidate(
            id=candidate.id,
            title=candidate.title,
            service_type_id=candidate.service_type_id,
            service_type_name=candidate.service_type_name,
            target_date=candidate.target_date,
            service_times=[
                service_time.strftime("%H:%M") for service_time in candidate.service_times
            ],
        )

    @staticmethod
    def _actionable_plan_date(state: ApplicationState, search_date: date) -> date | None:
        if state.plan is None or state.plan.date < search_date:
            return None
        return state.plan.date

    def _record_error(self, detail: str) -> None:
        self._status = PluginStatus.ERROR
        self._last_error = detail
        self._last_activity_at = datetime.now(UTC)
        self._logger.warning(
            "planning_center_load_failed",
            error_type="safe_planning_center_error",
        )

    async def _cleanup_resources(self) -> None:
        for subscription in self._subscriptions:
            await self.event_bus.unsubscribe(subscription)
        self._subscriptions.clear()
        await self._close_client()

    async def _handle_start_failure(self, detail: str) -> None:
        self._status = PluginStatus.ERROR
        self._last_error = detail
        self._last_activity_at = datetime.now(UTC)
        try:
            await self._publish_failure(self._safe_today(), detail)
        except Exception:
            self._logger.error("planning_center_start_failure_publish_failed")
        try:
            await self._cleanup_resources()
        except Exception:
            self._logger.error("planning_center_start_failure_cleanup_failed")

    def _safe_today(self) -> date:
        try:
            return self._today_provider(self._timezone)
        except Exception:
            self._logger.error("planning_center_today_provider_failed")
            return datetime.now(self._timezone).date()

    async def _close_client(self) -> None:
        client = self._client
        self._client = None
        if client is not None:
            await client.close()
