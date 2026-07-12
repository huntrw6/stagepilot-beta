"""StagePilot REST endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Request

from stagepilot.core.events import ActionName
from stagepilot.core.runtime import Runtime
from stagepilot.models.api import ActionResponse, HealthResponse
from stagepilot.models.state import ApplicationState, ApplicationStatus, PluginStatus

router = APIRouter(prefix="/api/v1")


def _runtime(request: Request) -> Runtime:
    return request.app.state.runtime  # type: ignore[no-any-return]


@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    runtime = _runtime(request)
    state = await runtime.state_store.snapshot()
    plugins = await runtime.plugin_manager.health()
    healthy = state.application_status is ApplicationStatus.RUNNING and all(
        plugin.status is not PluginStatus.ERROR for plugin in plugins
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
