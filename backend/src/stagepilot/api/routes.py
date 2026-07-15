"""StagePilot REST endpoints."""

from __future__ import annotations

from datetime import date, datetime
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
    PlanSelectionRequest,
    PlanSelectionResponse,
    ProPresenterOperationResponse,
    ProPresenterSettingsRequest,
    ProPresenterStatusResponse,
    ProPresenterTimerResponse,
)
from stagepilot.models.state import (
    ApplicationState,
    ApplicationStatus,
    ConnectionStatus,
    PluginStatus,
    ServiceLoadStatus,
)

router = APIRouter(prefix="/api/v1")


def _runtime(request: Request) -> Runtime:
    return request.app.state.runtime  # type: ignore[no-any-return]


def _current_local_date(timezone_name: str) -> date:
    return datetime.now(ZoneInfo(timezone_name)).date()


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
        settings = runtime.settings.propresenter
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
        if runtime.settings.demo_mode
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
                message_type=message.message_type,
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
    controller = _runtime(request).midi_controller
    if controller is None:
        raise HTTPException(status_code=409, detail="The MIDI Playback plugin is disabled.")
    outcome = await controller.select_input(selection.input_id)
    if not outcome.accepted:
        raise HTTPException(status_code=409, detail=outcome.message)
    return MidiInputSelectionResponse(
        accepted=True,
        message=outcome.message,
        midi=_midi_inputs_response(await controller.input_snapshot()),
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
    if controller is None:
        status = await _propresenter_status(runtime)
        return ProPresenterOperationResponse(
            accepted=False,
            message=(
                "The ProPresenter plugin is disabled. Enable it at startup before "
                "changing session settings."
            ),
            propresenter=status,
        )
    current = runtime.settings.propresenter
    updated = ProPresenterSettings(
        enabled=True,
        host=settings.host,
        port=settings.port,
        timer_name=settings.timer_name,
        request_timeout_seconds=settings.request_timeout_seconds,
        reconnect_initial_seconds=current.reconnect_initial_seconds,
        reconnect_max_seconds=current.reconnect_max_seconds,
        health_check_interval_seconds=current.health_check_interval_seconds,
    )
    snapshot = await controller.reconfigure(updated)
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


@router.post(
    "/planning-center/plan-selection",
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
