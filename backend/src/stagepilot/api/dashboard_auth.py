"""Browser-dashboard PIN endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response

from stagepilot.core.settings import SettingsFileError
from stagepilot.models.api import (
    DashboardAccessSettingsRequest,
    DashboardAuthLoginRequest,
    DashboardAuthStatusResponse,
    SettingsResponse,
)
from stagepilot.services.dashboard_auth import hash_dashboard_pin, verify_dashboard_pin

router = APIRouter(prefix="/api/v1/dashboard-auth")
COOKIE_NAME = "stagepilot_dashboard_session"


def _desktop_origin(request: Request) -> bool:
    origin = request.headers.get("origin", "")
    client_host = request.client.host if request.client else ""
    return origin in {
        "http://tauri.localhost",
        "https://tauri.localhost",
        "tauri://localhost",
    } and client_host in {"127.0.0.1", "::1", "testclient"}


@router.get("/status", response_model=DashboardAuthStatusResponse)
async def status(request: Request) -> DashboardAuthStatusResponse:
    settings = request.app.state.runtime.settings_service.snapshot()
    sessions = request.app.state.dashboard_sessions
    authenticated = (
        not settings.web_dashboard_pin_enabled
        or _desktop_origin(request)
        or sessions.valid(request.cookies.get(COOKIE_NAME))
    )
    return DashboardAuthStatusResponse(
        required=settings.web_dashboard_pin_enabled,
        authenticated=authenticated,
    )


@router.post("/login", response_model=DashboardAuthStatusResponse)
async def login(
    credentials: DashboardAuthLoginRequest,
    request: Request,
    response: Response,
) -> DashboardAuthStatusResponse:
    settings = request.app.state.runtime.settings_service.snapshot()
    if settings.web_dashboard_pin_enabled and not verify_dashboard_pin(
        credentials.pin,
        settings.web_dashboard_pin_hash,
    ):
        raise HTTPException(status_code=401, detail="Incorrect dashboard PIN.")
    token = request.app.state.dashboard_sessions.create()
    response.set_cookie(
        COOKIE_NAME,
        token,
        httponly=True,
        max_age=12 * 60 * 60,
        samesite="strict",
        secure=request.url.scheme == "https",
    )
    return DashboardAuthStatusResponse(
        required=settings.web_dashboard_pin_enabled,
        authenticated=True,
    )


@router.post("/settings", response_model=SettingsResponse)
async def update_dashboard_access(
    update: DashboardAccessSettingsRequest,
    request: Request,
) -> SettingsResponse:
    runtime = request.app.state.runtime
    pin_hash = hash_dashboard_pin(update.pin.get_secret_value()) if update.pin else None
    try:
        runtime.settings_service.update_dashboard_access(
            enabled=update.enabled,
            pin_hash=pin_hash,
        )
    except SettingsFileError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    request.app.state.dashboard_sessions.clear()
    return SettingsResponse(
        settings=runtime.settings_service.effective_snapshot(),
        planning_center_secret_saved=runtime.settings_service.credential_saved,
        warning=runtime.settings_service.warning,
        restart_required=False,
    )
