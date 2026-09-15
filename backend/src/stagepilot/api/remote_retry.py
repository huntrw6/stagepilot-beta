"""Session-scoped durable at-most-once dispatch for keyed Remote one-shot requests."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import HTTPException, Request, Response
from fastapi.routing import APIRoute

from stagepilot.api.remote_ingress import remote_context
from stagepilot.services.remote_auth import RemoteAuthError, digest

ONE_SHOTS = frozenset(
    {
        "/api/v1/midi/cue-simulation",
        "/api/v1/lights/test",
        "/api/v1/planning-center/plan/reload",
        "/api/v1/planning-center/plan-selection",
        "/api/v1/planning-center/plans/select",
        "/api/v1/propresenter/test",
    }
)


class RemoteRetryRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def handle(request: Request) -> Response:
            context = remote_context(request.scope)
            key = request.headers.get("idempotency-key")
            selected = (
                request.url.path.startswith("/api/v1/actions/") or request.url.path in ONE_SHOTS
            )
            if context is None or request.method != "POST" or not selected or key is None:
                return await handler(request)
            if (
                not re.fullmatch(r"[A-Za-z0-9_-]{16,128}", key)
                or len(request.headers.getlist("idempotency-key")) != 1
            ):
                raise HTTPException(422, "Invalid action request identifier.")
            assert context.token and context.session  # Trusted ingress already authorized + CSRF.
            body = await request.body()
            if len(body) > 16384:
                raise HTTPException(413, "Action request too large.")
            fingerprint = hashlib.sha256(request.url.path.encode() + b"\0" + body).hexdigest()
            journal_key = digest(context.token + ":" + key)
            try:
                previous = await context.access.call(
                    context.access.store.claim_action,
                    journal_key,
                    fingerprint,
                    context.session.expires_at,
                )
                if previous is not None:
                    code, payload = previous
                    return Response(
                        payload,
                        status_code=code,
                        media_type="application/json",
                        headers={"Cache-Control": "no-store"},
                    )
                response = await handler(request)
                # Persist before replying; uncertain operations are never re-dispatched.
                payload = bytes(response.body)
                await context.access.call(
                    context.access.store.finish_action, journal_key, response.status_code, payload
                )
                response.headers["Cache-Control"] = "no-store"
                return response
            except RemoteAuthError as exc:
                raise HTTPException(exc.status, exc.detail) from exc

        return handle
