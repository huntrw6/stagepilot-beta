"""Typed HTTP and WebSocket response models."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from stagepilot.core.events import ActionName
from stagepilot.core.midi import MidiCueName, MidiMessageDisposition
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


class PlanSelectionRequest(BaseModel):
    plan_id: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9_-]+$",
    )


class PlanSelectionResponse(BaseModel):
    accepted: bool
    message: str
    state: ApplicationState


class MidiInputResponse(BaseModel):
    id: str = Field(min_length=64, max_length=64, pattern=r"^[a-f0-9]+$")
    name: str = Field(min_length=1, max_length=512)
    ambiguous: bool
    selected: bool
    connected: bool


class MidiInputsResponse(BaseModel):
    enabled: bool
    channel: int = Field(ge=1, le=16)
    note: int = Field(ge=0, le=127)
    configured_input_name: str | None = None
    selected_input_name: str | None = None
    inputs: list[MidiInputResponse]
    mappings: dict[MidiCueName, int]


class MidiMonitorMessageResponse(BaseModel):
    timestamp: datetime
    input_name: str | None = None
    message_type: Literal["note_on", "note_off"]
    channel: int = Field(ge=1, le=16)
    note: int = Field(ge=0, le=127)
    note_name: str = Field(min_length=2, max_length=4)
    velocity: int = Field(ge=0, le=127)
    disposition: MidiMessageDisposition
    detail: str
    action: ActionName | None = None
    simulated: bool = False


class MidiMonitorResponse(BaseModel):
    messages: list[MidiMonitorMessageResponse]


class MidiInputSelectionRequest(BaseModel):
    input_id: str | None = Field(
        min_length=64,
        max_length=64,
        pattern=r"^[a-f0-9]+$",
    )


class MidiInputSelectionResponse(BaseModel):
    accepted: bool
    message: str
    midi: MidiInputsResponse


class MidiCueSimulationRequest(BaseModel):
    cue: MidiCueName


class MidiCueSimulationResponse(BaseModel):
    cue: MidiCueName
    action: ActionName
    accepted: bool
    message: str
    state: ApplicationState


class StateEnvelope(BaseModel):
    type: Literal["state.snapshot"] = "state.snapshot"
    data: ApplicationState
