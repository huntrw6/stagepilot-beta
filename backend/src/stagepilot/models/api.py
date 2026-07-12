"""Typed HTTP and WebSocket response models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from stagepilot.core.events import ActionName
from stagepilot.models.state import ApplicationState, ApplicationStatus, PluginHealth


class HealthResponse(BaseModel):
    status: Literal["healthy", "degraded"]
    version: str
    application_status: ApplicationStatus
    plugins: list[PluginHealth]


class ActionResponse(BaseModel):
    action: ActionName
    accepted: bool
    message: str
    state: ApplicationState


class StateEnvelope(BaseModel):
    type: Literal["state.snapshot"] = "state.snapshot"
    data: ApplicationState
