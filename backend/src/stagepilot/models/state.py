"""Observable application state models."""

from __future__ import annotations

from datetime import UTC, date, datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field, computed_field


class ApplicationStatus(StrEnum):
    STARTING = "starting"
    RUNNING = "running"
    STOPPING = "stopping"
    ERROR = "error"


class ConnectionStatus(StrEnum):
    CONNECTING = "connecting"
    CONNECTED = "connected"
    DISCONNECTED = "disconnected"
    ERROR = "error"


class TimerStatus(StrEnum):
    IDLE = "idle"
    RUNNING = "running"
    STOPPED = "stopped"
    ERROR = "error"


class PluginStatus(StrEnum):
    STOPPED = "stopped"
    STARTING = "starting"
    RUNNING = "running"
    STOPPING = "stopping"
    ERROR = "error"


class Song(BaseModel):
    id: str
    title: str = Field(min_length=1)
    duration_seconds: int | None = Field(default=None, ge=0)
    order: int = Field(ge=1)
    is_generic: bool = False
    source_song_id: str | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def formatted_duration(self) -> str | None:
        if self.duration_seconds is None:
            return None
        hours, remainder = divmod(self.duration_seconds, 3600)
        minutes, seconds = divmod(remainder, 60)
        if hours:
            return f"{hours}:{minutes:02d}:{seconds:02d}"
        return f"{minutes}:{seconds:02d}"


class ServicePlan(BaseModel):
    id: str
    title: str
    date: date
    service_type: str
    service_times: list[str] = Field(default_factory=list)
    duration_source: str = "Scheduled item length"
    songs: list[Song] = Field(default_factory=list)


class TimerState(BaseModel):
    status: TimerStatus = TimerStatus.IDLE
    duration_seconds: int | None = Field(default=None, ge=0)
    started_at: datetime | None = None
    last_error: str | None = None


class PluginHealth(BaseModel):
    name: str
    version: str
    status: PluginStatus
    last_error: str | None = None
    last_activity_at: datetime | None = None


class EventSummary(BaseModel):
    id: UUID
    type: str
    timestamp: datetime
    source: str


class ErrorSummary(BaseModel):
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    component: str
    message: str
    event_id: UUID | None = None


class ApplicationState(BaseModel):
    revision: int = Field(default=0, ge=0)
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    application_status: ApplicationStatus = ApplicationStatus.STARTING
    plan: ServicePlan | None = None
    current_song: Song | None = None
    next_song: Song | None = None
    current_song_index: int | None = Field(default=None, ge=0)
    planning_center_status: ConnectionStatus = ConnectionStatus.DISCONNECTED
    midi_status: ConnectionStatus = ConnectionStatus.DISCONNECTED
    propresenter_status: ConnectionStatus = ConnectionStatus.DISCONNECTED
    timer: TimerState = Field(default_factory=TimerState)
    plugins: dict[str, PluginHealth] = Field(default_factory=dict)
    recent_events: list[EventSummary] = Field(default_factory=list)
    recent_errors: list[ErrorSummary] = Field(default_factory=list)
    last_successful_plan_reload_at: datetime | None = None
    last_action: str | None = None
