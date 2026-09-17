"""Public, server-assigned dashboard access/capability discovery (no settings)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request, Response

from stagepilot.api.dashboard_auth import _desktop_origin, status
from stagepilot.api.remote_ingress import remote_context
from stagepilot.services.remote_auth import RemoteRole, csrf_token

router = APIRouter()


@router.get("/api/v1/access")
async def access(request: Request, response: Response) -> dict[str, Any]:
    response.headers["Cache-Control"] = "no-store"
    context = remote_context(request.scope)
    if context is not None:
        session = context.session
        authenticated = session is not None
        operator = session is not None and session.role == RemoteRole.OPERATOR
        return {
            "mode": "remote",
            "authentication": "password",
            "authenticated": authenticated,
            "capabilities": {
                "canRead": authenticated,
                "canOperate": operator,
                "canConfigure": operator,
                "canActivateServices": False,
                "canManageRemote": operator,
                "canBootstrapRemote": False,
            },
            "user": {"email": session.email, "role": session.role.value} if session else None,
            "expires_at": session.expires_at if session else None,
            "csrf_token": csrf_token(context.token) if session and context.token else None,
        }
    local = await status(request)
    desktop = _desktop_origin(request)
    authenticated = local.authenticated or not request.app.state.dashboard_auth_enforced
    return {
        "mode": "desktop" if desktop else "lan",
        "authentication": "pin" if local.required and not desktop else "none",
        "authenticated": authenticated,
        "capabilities": {
            "canRead": authenticated,
            "canOperate": authenticated,
            "canConfigure": authenticated,
            "canActivateServices": authenticated,
            "canManageRemote": authenticated,
            "canBootstrapRemote": authenticated,
        },
        "user": None,
        "expires_at": None,
        "csrf_token": None,
    }
