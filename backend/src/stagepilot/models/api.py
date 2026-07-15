"""Typed HTTP and WebSocket response models."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator

from stagepilot.core.events import ActionName
from stagepilot.core.midi import MidiCueName, MidiMessageDisposition
from stagepilot.core.settings import PersistentPlanningCenterSettings, PersistentSettings
from stagepilot.models.state import (
    ApplicationState,
    ApplicationStatus,
    ConnectionStatus,
    PluginHealth,
)


class HealthResponse(BaseModel):
    status: Literal["healthy", "degraded"]
    version: str
    application_status: ApplicationStatus
    plugins: list[PluginHealth]


class SettingsResponse(BaseModel):
    settings: PersistentSettings
    planning_center_secret_saved: bool
    warning: str | None = None
    restart_required: bool = False


class PlanningCenterSettingsUpdateRequest(PersistentPlanningCenterSettings):
    """Update non-secret settings and optionally replace or remove the saved PAT secret."""

    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    secret: SecretStr | None = None
    remove_secret: bool = False

    @model_validator(mode="after")
    def secret_action_is_unambiguous(self) -> PlanningCenterSettingsUpdateRequest:
        if self.secret is not None and self.remove_secret:
            raise ValueError("A credential cannot be replaced and removed in one request.")
        return self


class PlanningCenterStatusResponse(BaseModel):
    connection_status: ConnectionStatus
    configured: bool
    app_id: str | None = None
    service_type_id: str | None = None
    planning_center_secret_saved: bool
    detail: str | None = None


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


class ProPresenterTimerResponse(BaseModel):
    id: str = Field(min_length=1, max_length=256)
    name: str = Field(min_length=1, max_length=255)
    index: int = Field(ge=0)
    is_countdown: bool
    state: str | None = None


class ProPresenterStatusResponse(BaseModel):
    enabled: bool
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(ge=1, le=65535)
    timer_name: str = Field(min_length=1, max_length=255)
    request_timeout_seconds: float = Field(gt=0, le=60.0)
    connection_status: ConnectionStatus
    detail: str | None = None
    timers: list[ProPresenterTimerResponse] = Field(default_factory=list)
    selected_timer_id: str | None = None
    timer_found: bool
    last_checked_at: datetime | None = None


class ProPresenterSettingsRequest(BaseModel):
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(ge=1, le=65535)
    timer_name: str = Field(min_length=1, max_length=255)
    request_timeout_seconds: float = Field(gt=0, le=60.0)


class ProPresenterOperationResponse(BaseModel):
    accepted: bool
    message: str
    propresenter: ProPresenterStatusResponse


class StateEnvelope(BaseModel):
    type: Literal["state.snapshot"] = "state.snapshot"
    data: ApplicationState
