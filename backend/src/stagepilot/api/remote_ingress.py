"""Trusted server-mounted remote ingress, sharing the existing application runtime.

Never select this boundary (or bypass it) using Host, Origin, IP or proxy headers.
Only the launcher mounts RemoteIngress on the dedicated remote listener. Origin
is used exclusively as an additional browser CSRF check, never as authentication.
"""

from __future__ import annotations

import hmac
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from functools import partial
from typing import TypeVar
from urllib.parse import urlsplit

import anyio
from fastapi import FastAPI
from starlette.requests import HTTPConnection
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from stagepilot.services.remote_auth import (
    RemoteAuthError,
    RemoteRole,
    RemoteSession,
    RemoteStore,
    csrf_token,
)

COOKIE_NAME = "__Host-stagepilot_remote"
CONTEXT_KEY = "stagepilot.remote_context"
AUTH_PREFIX = "/api/v1/remote-auth"
ACCESS_PATH = "/api/v1/access"
VIEWER_READ_PATHS = frozenset(
    {
        "/api/v1/state",
        "/api/v1/health",
        "/api/v1/health/live",
        "/api/v1/health/ready",
        AUTH_PREFIX + "/session",
    }
)
OWN_MUTATIONS = frozenset({AUTH_PREFIX + "/logout", AUTH_PREFIX + "/revoke-sessions"})
T = TypeVar("T")


class RemoteAccess:
    def __init__(self, store: RemoteStore) -> None:
        self.store = store
        # Separate from Starlette's shared worker pool: remote password/DB work
        # cannot consume all workers used by local production integrations.
        self.limiter = anyio.CapacityLimiter(2)

    async def call(self, function: Callable[..., T], *args: object, **kwargs: object) -> T:
        try:
            return await anyio.to_thread.run_sync(
                partial(function, *args, **kwargs), limiter=self.limiter
            )
        except (OSError, sqlite3.Error) as exc:
            raise RemoteAuthError(503, "Remote access storage is unavailable.") from exc


@dataclass(frozen=True)
class RemoteContext:
    access: RemoteAccess
    token: str | None
    session: RemoteSession | None


def remote_context(scope: Scope) -> RemoteContext | None:
    context = scope.get(CONTEXT_KEY)
    return context if isinstance(context, RemoteContext) else None


class RemoteIngress:
    """A second ingress, NOT a second StagePilot app or lifespan.

    The owning LAN app alone starts/stops the runtime. A future trusted launcher
    must expose this object on its dedicated remote listener, never tunnel the
    original LAN callable. No listener or tunnel is started by this foundation.
    """

    def __init__(self, application: FastAPI, *, public_origin: str) -> None:
        parsed = urlsplit(public_origin)
        if (
            parsed.scheme != "https"
            or not parsed.netloc
            or parsed.path
            or parsed.query
            or parsed.fragment
            or parsed.username
            or parsed.password
        ):
            raise ValueError("Remote public_origin must be an exact HTTPS origin without a path.")
        access = getattr(application.state, "remote_access", None)
        if not isinstance(access, RemoteAccess):
            raise ValueError("Configure a RemoteStore on the existing app before mounting ingress.")
        self.app: ASGIApp = application
        self.access = access
        self.public_origin = public_origin
        self.connections = anyio.CapacityLimiter(32)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan":
            # Do not forward lifespan and accidentally start the same plugins twice.
            while True:
                event = await receive()
                if event["type"] == "lifespan.startup":
                    await send({"type": "lifespan.startup.complete"})
                elif event["type"] == "lifespan.shutdown":
                    await send({"type": "lifespan.shutdown.complete"})
                    return
        if scope["type"] not in {"http", "websocket"}:
            return
        try:
            self.connections.acquire_nowait()
        except anyio.WouldBlock:
            await self._deny(scope, receive, send, 503, "Remote access is busy.")
            return
        try:
            await self._request(dict(scope), receive, send)
        except RemoteAuthError as exc:
            await self._deny(scope, receive, send, exc.status, exc.detail)
        finally:
            self.connections.release()

    async def _request(self, scope: Scope, receive: Receive, send: Send) -> None:
        connection = HTTPConnection(scope)
        path = scope["path"]
        websocket = scope["type"] == "websocket"
        method = scope.get("method", "GET")
        mutation = method not in {"GET", "HEAD", "OPTIONS"}
        # Reject duplicate Origin headers as well as absent/mismatched ones.
        origins = connection.headers.getlist("origin")
        if (mutation or websocket) and origins != [self.public_origin]:
            raise RemoteAuthError(403, "Remote same-origin request required.")
        if websocket and path != "/ws":
            raise RemoteAuthError(403, "Remote WebSocket path is not permitted.")
        if path.startswith("/api/v1/dashboard-auth") and path != "/api/v1/dashboard-auth/settings":
            raise RemoteAuthError(403, "LAN PIN authentication is not available remotely.")
        public_asset = (
            not websocket
            and method in {"GET", "HEAD"}
            and (
                path in {"/", "/index.html", "/stagepilot-icon.png"} or path.startswith("/assets/")
            )
        )
        if public_asset:
            # Only the compiled login shell/assets, never API state or configuration.
            scope[CONTEXT_KEY] = RemoteContext(self.access, None, None)
            await self.app(scope, receive, send)
            return
        token = connection.cookies.get(COOKIE_NAME)
        if not websocket and method == "GET" and path == ACCESS_PATH:
            session = await self.access.call(self.access.store.session, token)
            scope[CONTEXT_KEY] = RemoteContext(self.access, token, session)
            await self.app(scope, receive, send)
            return
        login = not websocket and method == "POST" and path == AUTH_PREFIX + "/login"
        if login:
            if connection.headers.get("x-stagepilot-remote") != "1":
                raise RemoteAuthError(403, "Remote login header required.")
            session = None
        else:
            session = await self.access.call(self.access.store.session, token)
            if session is None:
                raise RemoteAuthError(401, "Remote email/password session required.")
            if mutation and (
                not token
                or not hmac.compare_digest(
                    connection.headers.get("x-csrf-token", "").encode(), csrf_token(token).encode()
                )
            ):
                raise RemoteAuthError(403, "Remote CSRF token required.")
            if session.role == RemoteRole.VIEWER and not (
                (websocket and path == "/ws")
                or (method in {"GET", "HEAD"} and path in VIEWER_READ_PATHS)
                or (method == "POST" and path in OWN_MUTATIONS)
            ):
                raise RemoteAuthError(403, "Viewer access is read-only.")
        scope[CONTEXT_KEY] = RemoteContext(self.access, token, session)
        if path.startswith(AUTH_PREFIX) and mutation:
            # Bound auth payloads before FastAPI JSON parsing / Argon2 allocation.
            body = bytearray()
            while True:
                event = await receive()
                if event["type"] == "http.disconnect":
                    return
                body.extend(event.get("body", b""))
                if len(body) > 16_384:
                    raise RemoteAuthError(413, "Remote authentication payload is too large.")
                if not event.get("more_body", False):
                    break
            consumed = False

            async def buffered_receive() -> Message:
                nonlocal consumed
                if not consumed:
                    consumed = True
                    return {"type": "http.request", "body": bytes(body), "more_body": False}
                return await receive()

            await self.app(scope, buffered_receive, send)
        else:
            await self.app(scope, receive, send)

    @staticmethod
    async def _deny(scope: Scope, receive: Receive, send: Send, status: int, detail: str) -> None:
        if scope["type"] == "websocket":
            await send(
                {
                    "type": "websocket.close",
                    "code": 4401 if status == 401 else 4403,
                    "reason": detail,
                }
            )
        else:
            headers = {"Cache-Control": "no-store"}
            if status == 429:
                headers["Retry-After"] = "300"
            await JSONResponse({"detail": detail}, status_code=status, headers=headers)(
                scope, receive, send
            )
