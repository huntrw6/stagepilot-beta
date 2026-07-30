"""Protect browser API and WebSocket access with a local PIN session."""

from __future__ import annotations

from http.cookies import SimpleCookie
from typing import Any

from starlette.types import ASGIApp, Receive, Scope, Send

from stagepilot.api.dashboard_auth import COOKIE_NAME

DESKTOP_ORIGINS = {
    b"http://tauri.localhost",
    b"https://tauri.localhost",
    b"tauri://localhost",
}
PUBLIC_PATHS = {
    "/api/v1/dashboard-auth/status",
    "/api/v1/dashboard-auth/login",
    "/api/v1/health",
}


class DashboardAuthMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in {"http", "websocket"} or not self._protected(scope):
            await self.app(scope, receive, send)
            return
        settings = scope["app"].state.runtime.settings_service.snapshot()
        if (
            not scope["app"].state.dashboard_auth_enforced
            or not settings.web_dashboard_pin_enabled
            or self._authorized(scope)
        ):
            await self.app(scope, receive, send)
            return
        if scope["type"] == "websocket":
            await send(
                {"type": "websocket.close", "code": 4401, "reason": "Dashboard PIN required"}
            )
            return
        body = b'{"detail":"Dashboard PIN required."}'
        await send(
            {
                "type": "http.response.start",
                "status": 401,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})

    @staticmethod
    def _headers(scope: Scope) -> dict[bytes, bytes]:
        return dict(scope.get("headers", []))

    def _protected(self, scope: Scope) -> bool:
        path = str(scope.get("path", ""))
        if path in PUBLIC_PATHS or not (path.startswith("/api/v1") or path == "/ws"):
            return False
        headers = self._headers(scope)
        client = scope.get("client")
        client_host = client[0] if client else ""
        desktop_request = headers.get(b"origin") in DESKTOP_ORIGINS and client_host in {
            "127.0.0.1",
            "::1",
            "testclient",
        }
        return not desktop_request

    def _authorized(self, scope: Scope) -> bool:
        cookie_header = self._headers(scope).get(b"cookie", b"").decode(errors="ignore")
        cookie = SimpleCookie()
        cookie.load(cookie_header)
        morsel: Any = cookie.get(COOKIE_NAME)
        token = morsel.value if morsel is not None else None
        return bool(scope["app"].state.dashboard_sessions.valid(token))
