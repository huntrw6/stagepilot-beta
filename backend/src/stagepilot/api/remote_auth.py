"""StagePilot-owned remote sessions and Operator user administration."""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from stagepilot.api.remote_ingress import (
    AUTH_PREFIX,
    COOKIE_NAME,
    RemoteAccess,
    RemoteContext,
    remote_context,
)
from stagepilot.services.remote_auth import SESSION_SECONDS, RemoteAuthError, RemoteRole, csrf_token


class RemoteRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def handle(request: Request) -> Response:
            try:
                response = await handler(request)
                response.headers["Cache-Control"] = "no-store"
                return response
            except RemoteAuthError as exc:
                headers = {"Cache-Control": "no-store"}
                if exc.status == 429:
                    headers["Retry-After"] = "300"
                raise HTTPException(exc.status, exc.detail, headers=headers) from exc
            except RequestValidationError as exc:
                # Never echo password inputs in validation responses.
                raise HTTPException(422, "Invalid remote authentication request.") from exc

        return handle


router = APIRouter(prefix=AUTH_PREFIX, route_class=RemoteRoute)


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=254)
    password: SecretStr = Field(min_length=1, max_length=1024)


class CreateUserRequest(LoginRequest):
    password: SecretStr = Field(min_length=12, max_length=1024)
    role: RemoteRole


class UpdateUserRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: RemoteRole | None = None
    enabled: bool | None = None
    password: SecretStr | None = Field(default=None, min_length=12, max_length=1024)


def _access(request: Request) -> RemoteAccess:
    access = getattr(request.app.state, "remote_access", None)
    if not isinstance(access, RemoteAccess):
        raise HTTPException(503, "Remote access is not configured.")
    return access


def _remote(request: Request) -> RemoteContext:
    context = remote_context(request.scope)
    if context is None:
        raise HTTPException(403, "Use the dedicated remote ingress for remote sessions.")
    return context


def _admin(request: Request) -> RemoteAccess:
    context = remote_context(request.scope)
    if context is not None and (
        context.session is None or context.session.role != RemoteRole.OPERATOR
    ):
        raise HTTPException(403, "Operator access required.")
    # Local access has already passed the unchanged LAN PIN/Tauri middleware.
    return _access(request)


@router.post("/login")
async def login(body: LoginRequest, request: Request, response: Response) -> dict[str, Any]:
    context = _remote(request)
    token = await context.access.call(
        context.access.store.login, body.email, body.password.get_secret_value(), context.token
    )
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=True,
        samesite="strict",
        path="/",
    )
    return {"authenticated": True, "csrf_token": csrf_token(token)}


@router.get("/session")
async def session(request: Request) -> dict[str, Any]:
    context = _remote(request)
    if context.session is None or context.token is None:
        raise HTTPException(401, "Remote session required.")
    return {
        "user": {
            "id": context.session.user_id,
            "email": context.session.email,
            "role": context.session.role.value,
        },
        "expires_at": context.session.expires_at,
        "csrf_token": csrf_token(context.token),
    }


@router.post("/logout", status_code=204)
@router.post("/revoke-sessions", status_code=204)
async def logout(request: Request, response: Response) -> None:
    context = _remote(request)
    if context.token:
        await context.access.call(
            context.access.store.revoke,
            context.token,
            all_sessions=request.url.path.endswith("/revoke-sessions"),
        )
    response.delete_cookie(COOKIE_NAME, path="/", secure=True, httponly=True, samesite="strict")


@router.get("/users")
async def users(request: Request) -> list[dict[str, Any]]:
    access = _admin(request)
    return await access.call(access.store.users)


@router.post("/users", status_code=201)
async def create_user(body: CreateUserRequest, request: Request) -> dict[str, Any]:
    access = _admin(request)
    return await access.call(
        access.store.create_user, body.email, body.password.get_secret_value(), body.role
    )


@router.patch("/users/{user_id}", status_code=204)
async def update_user(user_id: str, body: UpdateUserRequest, request: Request) -> None:
    access = _admin(request)
    await access.call(
        access.store.update_user,
        user_id,
        role=body.role,
        enabled=body.enabled,
        password=body.password.get_secret_value() if body.password else None,
    )


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(user_id: str, request: Request) -> None:
    access = _admin(request)
    await access.call(access.store.update_user, user_id, delete=True)
