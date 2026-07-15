"""StagePilot REST endpoints."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal, NoReturn, cast
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Request

from stagepilot.core.config import ProPresenterSettings
from stagepilot.core.events import (
    ActionName,
    EventType,
    ServicePlanSelectionPayload,
    new_event,
)
from stagepilot.core.midi import MidiInputSnapshot
from stagepilot.core.propresenter import ProPresenterSnapshot
from stagepilot.core.runtime import Runtime
from stagepilot.core.settings import (
    CredentialStoreError,
    PersistentPlanningCenterSettings,
    PersistentSettings,
    SettingsFileError,
)
from stagepilot.models.api import (
    ActionResponse,
    HealthResponse,
    MidiCueSimulationRequest,
    MidiCueSimulationResponse,
    MidiInputResponse,
    MidiInputSelectionRequest,
    MidiInputSelectionResponse,
    MidiInputsResponse,
    MidiMonitorMessageResponse,
    MidiMonitorResponse,
    PendingPlanSelectionResponse,
    PlanningCenterServiceTypeResponse,
    PlanningCenterSettingsUpdateRequest,
    PlanningCenterStatusResponse,
    PlanningCenterTestRequest,
    PlanningCenterTestResponse,
    PlanSelectionRequest,
    PlanSelectionResponse,
    ProPresenterOperationResponse,
    ProPresenterSettingsRequest,
    ProPresenterStatusResponse,
    ProPresenterTimerResponse,
    SettingsResponse,
)
from stagepilot.models.state import (
    ApplicationState,
    ApplicationStatus,
    ConnectionStatus,
    PluginStatus,
    ServiceLoadStatus,
)
from stagepilot.plugins.planning_center.errors import (
    PlanningCenterAuthenticationError,
    PlanningCenterConfigurationError,
    PlanningCenterError,
    PlanningCenterPermissionError,
    PlanningCenterRateLimitError,
)

router = APIRouter(prefix="/api/v1")


def _runtime(request: Request) -> Runtime:
    return request.app.state.runtime  # type: ignore[no-any-return]


def _current_local_date(timezone_name: str) -> date:
    return datetime.now(ZoneInfo(timezone_name)).date()


def _settings_response(
    runtime: Runtime,
    *,
    persisted: bool = False,
    restart_required: bool = False,
) -> SettingsResponse:
    settings = (
        runtime.settings_service.snapshot()
        if persisted
        else runtime.settings_service.effective_snapshot()
    )
    return SettingsResponse(
        settings=settings,
        planning_center_secret_saved=runtime.settings_service.credential_saved,
        warning=runtime.settings_service.warning,
        restart_required=restart_required,
    )


def _raise_planning_center_http_error(exc: PlanningCenterError) -> NoReturn:
    status_code = 502
    headers: dict[str, str] | None = None
    if isinstance(exc, PlanningCenterConfigurationError):
        status_code = 409
    elif isinstance(exc, PlanningCenterAuthenticationError):
        status_code = 401
    elif isinstance(exc, PlanningCenterPermissionError):
        status_code = 403
    elif isinstance(exc, PlanningCenterRateLimitError):
        status_code = 429
        if exc.retry_after_seconds is not None:
            headers = {"Retry-After": str(exc.retry_after_seconds)}
    raise HTTPException(status_code=status_code, detail=str(exc), headers=headers) from exc


def _production_service_ready(state: ApplicationState, current_date: date) -> bool:
    plan = state.plan
    return (
        state.planning_center_status is ConnectionStatus.CONNECTED
        and state.service_load.status is ServiceLoadStatus.LOADED
        and not state.service_load.is_stale
        and plan is not None
        and state.service_load.target_date == plan.date
        and plan.date >= current_date
        and bool(plan.songs)
    )


def _midi_inputs_response(snapshot: MidiInputSnapshot) -> MidiInputsResponse:
    return MidiInputsResponse(
        enabled=snapshot.enabled,
        channel=snapshot.channel,
        note=snapshot.note,
        configured_input_name=snapshot.configured_input_name,
        selected_input_name=snapshot.selected_input_name,
        inputs=[
            MidiInputResponse(
                id=value.id,
                name=value.name,
                ambiguous=value.ambiguous,
                selected=value.selected,
                connected=value.connected,
            )
            for value in snapshot.inputs
        ],
        mappings=dict(snapshot.mappings),
    )


def _propresenter_response(snapshot: ProPresenterSnapshot) -> ProPresenterStatusResponse:
    return ProPresenterStatusResponse(
        enabled=snapshot.enabled,
        host=snapshot.host,
        port=snapshot.port,
        timer_name=snapshot.timer_name,
        request_timeout_seconds=snapshot.request_timeout_seconds,
        connection_status=snapshot.connection_status,
        detail=snapshot.detail,
        timers=[
            ProPresenterTimerResponse(
                id=timer.id,
                name=timer.name,
                index=timer.index,
                is_countdown=timer.is_countdown,
                state=timer.state,
            )
            for timer in snapshot.timers
        ],
        selected_timer_id=snapshot.selected_timer_id,
        timer_found=snapshot.timer_found,
        last_checked_at=snapshot.last_checked_at,
    )


async def _propresenter_status(
    runtime: Runtime,
    *,
    refresh: bool = False,
) -> ProPresenterStatusResponse:
    controller = runtime.propresenter_controller
    if controller is None:
        settings = runtime.settings_service.effective_runtime_settings().propresenter
        return ProPresenterStatusResponse(
            enabled=False,
            host=settings.host,
            port=settings.port,
            timer_name=settings.timer_name,
            request_timeout_seconds=settings.request_timeout_seconds,
            connection_status=ConnectionStatus.DISCONNECTED,
            detail="The ProPresenter plugin is disabled.",
            timers=[],
            selected_timer_id=None,
            timer_found=False,
            last_checked_at=None,
        )
    return _propresenter_response(await controller.snapshot(refresh=refresh))


@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    runtime = _runtime(request)
    state = await runtime.state_store.snapshot()
    plugins = await runtime.plugin_manager.health()
    service_ready = (
        state.service_load.status is not ServiceLoadStatus.ERROR
        if runtime.settings.uses_demo_service
        else _production_service_ready(
            state,
            _current_local_date(runtime.settings.timezone),
        )
    )
    healthy = (
        state.application_status is ApplicationStatus.RUNNING
        and all(plugin.status is PluginStatus.RUNNING for plugin in plugins)
        and service_ready
    )
    return HealthResponse(
        status="healthy" if healthy else "degraded",
        version=runtime.settings.version,
        application_status=state.application_status,
        plugins=plugins,
    )


@router.get("/state", response_model=ApplicationState)
async def state(request: Request) -> ApplicationState:
    return await _runtime(request).state_store.snapshot()


@router.get("/settings", response_model=SettingsResponse)
async def settings(request: Request) -> SettingsResponse:
    return _settings_response(_runtime(request))


@router.put("/settings", response_model=SettingsResponse)
async def update_settings(
    settings: PersistentSettings,
    request: Request,
) -> SettingsResponse:
    runtime = _runtime(request)
    try:
        runtime.settings_service.save(settings)
    except SettingsFileError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return _settings_response(runtime, persisted=True, restart_required=True)


@router.get("/planning-center/status", response_model=PlanningCenterStatusResponse)
async def planning_center_status(request: Request) -> PlanningCenterStatusResponse:
    runtime = _runtime(request)
    state = await runtime.state_store.snapshot()
    settings = runtime.settings_service.effective_snapshot().planning_center
    runtime_settings = runtime.settings_service.effective_runtime_settings().planning_center
    return PlanningCenterStatusResponse(
        connection_status=state.planning_center_status,
        configured=(
            runtime_settings.is_configured and runtime_settings.service_type_id is not None
        ),
        app_id=settings.app_id,
        service_type_id=settings.service_type_id,
        planning_center_secret_saved=runtime.settings_service.credential_saved,
        detail=state.service_load.message,
    )


@router.post("/planning-center/settings", response_model=SettingsResponse)
async def update_planning_center_settings(
    settings: PlanningCenterSettingsUpdateRequest,
    request: Request,
) -> SettingsResponse:
    runtime = _runtime(request)
    public_settings = PersistentPlanningCenterSettings(
        app_id=settings.app_id,
        service_type_id=settings.service_type_id,
        plan_title_preference=settings.plan_title_preference,
        preferred_service_time=settings.preferred_service_time,
        upcoming_lookahead_days=settings.upcoming_lookahead_days,
        request_timeout_seconds=settings.request_timeout_seconds,
    )
    try:
        runtime.settings_service.update_planning_center(
            public_settings,
            secret=settings.secret,
            remove_secret=settings.remove_secret,
        )
    except (CredentialStoreError, SettingsFileError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return _settings_response(runtime, persisted=True, restart_required=True)


@router.post("/planning-center/test", response_model=PlanningCenterTestResponse)
async def test_planning_center(
    settings: PlanningCenterTestRequest,
    request: Request,
) -> PlanningCenterTestResponse:
    runtime = _runtime(request)
    try:
        service_types = await runtime.planning_center_setup.test_connection(
            app_id=settings.app_id,
            secret=settings.secret,
        )
    except PlanningCenterError as exc:
        _raise_planning_center_http_error(exc)
    return PlanningCenterTestResponse(
        message="Planning Center authentication succeeded.",
        service_types=[
            PlanningCenterServiceTypeResponse(id=value.id, name=value.name)
            for value in service_types
        ],
    )


@router.get(
    "/planning-center/service-types",
    response_model=list[PlanningCenterServiceTypeResponse],
)
async def planning_center_service_types(
    request: Request,
) -> list[PlanningCenterServiceTypeResponse]:
    runtime = _runtime(request)
    try:
        service_types = await runtime.planning_center_setup.list_service_types()
    except PlanningCenterError as exc:
        _raise_planning_center_http_error(exc)
    return [
        PlanningCenterServiceTypeResponse(id=value.id, name=value.name) for value in service_types
    ]


@router.get("/midi/inputs", response_model=MidiInputsResponse)
async def midi_inputs(request: Request) -> MidiInputsResponse:
    runtime = _runtime(request)
    controller = runtime.midi_controller
    if controller is None:
        return MidiInputsResponse(
            enabled=False,
            channel=runtime.settings.midi.channel,
            note=runtime.settings.midi.note,
            configured_input_name=runtime.settings.midi.input_name,
            selected_input_name=None,
            inputs=[],
            mappings=dict(runtime.settings.midi.mappings.configured()),
        )
    snapshot = await controller.input_snapshot(refresh=True)
    return _midi_inputs_response(snapshot)


@router.post("/midi/inputs/refresh", response_model=MidiInputsResponse)
async def refresh_midi_inputs(request: Request) -> MidiInputsResponse:
    return await midi_inputs(request)


@router.get("/midi/messages", response_model=MidiMonitorResponse)
async def midi_messages(request: Request) -> MidiMonitorResponse:
    controller = _runtime(request).midi_controller
    if controller is None:
        return MidiMonitorResponse(messages=[])
    messages = await controller.recent_messages()
    return MidiMonitorResponse(
        messages=[
            MidiMonitorMessageResponse(
                timestamp=message.timestamp,
                input_name=message.input_name,
                message_type=cast(Literal["note_on", "note_off"], message.message_type),
                channel=message.channel,
                note=message.note,
                note_name=message.note_name,
                velocity=message.velocity,
                disposition=message.disposition,
                detail=message.detail,
                action=message.action,
                simulated=message.simulated,
            )
            for message in messages
        ]
    )


@router.post(
    "/midi/input-selection",
    response_model=MidiInputSelectionResponse,
)
async def select_midi_input(
    selection: MidiInputSelectionRequest,
    request: Request,
) -> MidiInputSelectionResponse:
    runtime = _runtime(request)
    controller = runtime.midi_controller
    if controller is None:
        raise HTTPException(status_code=409, detail="The MIDI Playback plugin is disabled.")
    outcome = await controller.select_input(selection.input_id)
    if not outcome.accepted:
        raise HTTPException(status_code=409, detail=outcome.message)
    snapshot = await controller.input_snapshot()
    try:
        runtime.settings_service.persist_midi_input(snapshot.selected_input_name)
    except SettingsFileError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return MidiInputSelectionResponse(
        accepted=True,
        message=outcome.message,
        midi=_midi_inputs_response(snapshot),
    )


@router.post(
    "/midi/cue-simulation",
    response_model=MidiCueSimulationResponse,
)
async def simulate_midi_cue(
    simulation: MidiCueSimulationRequest,
    request: Request,
) -> MidiCueSimulationResponse:
    runtime = _runtime(request)
    controller = runtime.midi_controller
    if controller is None:
        raise HTTPException(status_code=409, detail="The MIDI Playback plugin is disabled.")
    outcome = await controller.simulate_cue(simulation.cue)
    return MidiCueSimulationResponse(
        cue=simulation.cue,
        action=simulation.cue.action,
        accepted=outcome.accepted,
        message=outcome.message,
        state=await runtime.state_store.snapshot(),
    )


@router.get("/propresenter", response_model=ProPresenterStatusResponse)
async def propresenter_status(request: Request) -> ProPresenterStatusResponse:
    return await _propresenter_status(_runtime(request))


@router.post("/propresenter/test", response_model=ProPresenterOperationResponse)
async def test_propresenter(request: Request) -> ProPresenterOperationResponse:
    runtime = _runtime(request)
    controller = runtime.propresenter_controller
    if controller is None:
        status = await _propresenter_status(runtime)
        return ProPresenterOperationResponse(
            accepted=False,
            message="The ProPresenter plugin is disabled.",
            propresenter=status,
        )
    snapshot = await controller.test_connection()
    accepted = snapshot.connection_status is ConnectionStatus.CONNECTED and snapshot.timer_found
    return ProPresenterOperationResponse(
        accepted=accepted,
        message=snapshot.detail
        or (
            "ProPresenter connection test succeeded."
            if accepted
            else "ProPresenter connection test failed."
        ),
        propresenter=_propresenter_response(snapshot),
    )


@router.post(
    "/propresenter/timers/refresh",
    response_model=ProPresenterOperationResponse,
)
async def refresh_propresenter_timers(request: Request) -> ProPresenterOperationResponse:
    runtime = _runtime(request)
    controller = runtime.propresenter_controller
    if controller is None:
        status = await _propresenter_status(runtime)
        return ProPresenterOperationResponse(
            accepted=False,
            message="The ProPresenter plugin is disabled.",
            propresenter=status,
        )
    snapshot = await controller.refresh_timers()
    accepted = snapshot.connection_status is ConnectionStatus.CONNECTED and snapshot.timer_found
    return ProPresenterOperationResponse(
        accepted=accepted,
        message=snapshot.detail or "ProPresenter timers refreshed.",
        propresenter=_propresenter_response(snapshot),
    )


@router.post(
    "/propresenter/settings",
    response_model=ProPresenterOperationResponse,
)
async def update_propresenter_settings(
    settings: ProPresenterSettingsRequest,
    request: Request,
) -> ProPresenterOperationResponse:
    runtime = _runtime(request)
    controller = runtime.propresenter_controller
    current = runtime.settings_service.effective_runtime_settings().propresenter
    updated = ProPresenterSettings(
        enabled=current.enabled,
        host=settings.host,
        port=settings.port,
        timer_name=settings.timer_name,
        request_timeout_seconds=settings.request_timeout_seconds,
        reconnect_initial_seconds=current.reconnect_initial_seconds,
        reconnect_max_seconds=current.reconnect_max_seconds,
        health_check_interval_seconds=current.health_check_interval_seconds,
    )
    if controller is None:
        try:
            runtime.settings_service.persist_propresenter(updated)
        except SettingsFileError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        status = await _propresenter_status(runtime)
        return ProPresenterOperationResponse(
            accepted=True,
            message="ProPresenter settings saved. Restart StagePilot to apply the output mode.",
            propresenter=status,
        )
    snapshot = await controller.reconfigure(updated)
    runtime.settings.propresenter = updated
    try:
        runtime.settings_service.persist_propresenter(updated)
    except SettingsFileError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    accepted = snapshot.connection_status is ConnectionStatus.CONNECTED and snapshot.timer_found
    message = snapshot.detail or (
        "ProPresenter session settings applied."
        if accepted
        else "ProPresenter session settings were saved, but readiness checks failed."
    )
    return ProPresenterOperationResponse(
        accepted=accepted,
        message=message,
        propresenter=_propresenter_response(snapshot),
    )


@router.post("/actions/{action}", response_model=ActionResponse)
async def perform_action(action: ActionName, request: Request) -> ActionResponse:
    runtime = _runtime(request)
    outcome = await runtime.state_service.dispatch(action, source="api")
    return ActionResponse(
        action=action,
        accepted=outcome.accepted,
        message=outcome.message,
        state=await runtime.state_store.snapshot(),
    )


@router.post("/planning-center/plan/reload", response_model=ActionResponse)
async def reload_planning_center_plan(request: Request) -> ActionResponse:
    return await perform_action(ActionName.RELOAD_PLAN, request)


@router.get(
    "/planning-center/plans/pending-selection",
    response_model=PendingPlanSelectionResponse,
)
async def pending_planning_center_plan_selection(
    request: Request,
) -> PendingPlanSelectionResponse:
    state = await _runtime(request).state_store.snapshot()
    pending = state.service_load.status is ServiceLoadStatus.AMBIGUOUS
    target_date = state.service_load.target_date if pending else None
    return PendingPlanSelectionResponse(
        pending=pending,
        target_date=target_date.isoformat() if target_date is not None else None,
        candidates=state.service_load.candidates if pending else [],
        message=state.service_load.message if pending else None,
    )


@router.post(
    "/planning-center/plan-selection",
    response_model=PlanSelectionResponse,
)
@router.post(
    "/planning-center/plans/select",
    response_model=PlanSelectionResponse,
)
async def select_planning_center_plan(
    selection: PlanSelectionRequest,
    request: Request,
) -> PlanSelectionResponse:
    runtime = _runtime(request)
    current = await runtime.state_store.snapshot()
    candidate_ids = {candidate.id for candidate in current.service_load.candidates}
    if (
        current.service_load.status is not ServiceLoadStatus.AMBIGUOUS
        or selection.plan_id not in candidate_ids
    ):
        raise HTTPException(
            status_code=409,
            detail="The selected plan is not a current Planning Center candidate.",
        )

    report = await runtime.event_bus.publish(
        new_event(
            EventType.SERVICE_PLAN_SELECTION_REQUESTED,
            source="api",
            payload=ServicePlanSelectionPayload(plan_id=selection.plan_id),
        )
    )
    if report.failures:
        raise HTTPException(
            status_code=503,
            detail="Planning Center could not process the plan selection.",
        )

    updated = await runtime.state_store.snapshot()
    loaded_plan = updated.plan
    if (
        updated.service_load.status is not ServiceLoadStatus.LOADED
        or loaded_plan is None
        or loaded_plan.id != selection.plan_id
    ):
        raise HTTPException(
            status_code=503,
            detail=updated.service_load.message
            or "Planning Center could not load the selected plan.",
        )
    return PlanSelectionResponse(
        accepted=True,
        message=f'Loaded "{loaded_plan.title}".',
        state=updated,
    )
