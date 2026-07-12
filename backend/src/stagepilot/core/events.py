"""Typed events exchanged by StagePilot services and plugins."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from stagepilot.models.state import ConnectionStatus, PluginStatus, ServicePlan, Song


class EventType(StrEnum):
    APPLICATION_STARTED = "application.started"
    APPLICATION_STOPPING = "application.stopping"
    ACTION_REQUESTED = "action.requested"
    SERVICE_RELOAD_REQUESTED = "service.reload_requested"
    SERVICE_LOADED = "service.loaded"
    SONG_SELECTED = "song.selected"
    SONG_STARTED = "song.started"
    SONG_RESTARTED = "song.restarted"
    TIMER_STOP_REQUESTED = "timer.stop_requested"
    TIMER_STARTED = "timer.started"
    TIMER_STOPPED = "timer.stopped"
    TIMER_FAILED = "timer.failed"
    CONNECTION_CHANGED = "connection.changed"
    PLUGIN_STATUS_CHANGED = "plugin.status_changed"
    PLUGIN_FAILED = "plugin.failed"


class ActionName(StrEnum):
    START_NEXT = "start_next"
    RESTART_CURRENT = "restart_current"
    PREVIOUS = "previous"
    NEXT = "next"
    STOP_TIMER = "stop_timer"
    RELOAD_PLAN = "reload_plan"
    RESET_POSITION = "reset_position"


class EmptyPayload(BaseModel):
    kind: Literal["empty"] = "empty"


class ActionPayload(BaseModel):
    kind: Literal["action"] = "action"
    action: ActionName
    request_id: UUID


class ServicePayload(BaseModel):
    kind: Literal["service"] = "service"
    plan: ServicePlan


class SongPayload(BaseModel):
    kind: Literal["song"] = "song"
    song: Song
    index: int = Field(ge=0)


class TimerPayload(BaseModel):
    kind: Literal["timer"] = "timer"
    duration_seconds: int = Field(ge=0)
    message: str | None = None


class ConnectionPayload(BaseModel):
    kind: Literal["connection"] = "connection"
    integration: Literal["planning_center", "midi", "propresenter"]
    status: ConnectionStatus
    detail: str | None = None


class PluginPayload(BaseModel):
    kind: Literal["plugin"] = "plugin"
    name: str
    version: str
    status: PluginStatus
    error: str | None = None


EventPayload = Annotated[
    EmptyPayload
    | ActionPayload
    | ServicePayload
    | SongPayload
    | TimerPayload
    | ConnectionPayload
    | PluginPayload,
    Field(discriminator="kind"),
]


class StagePilotEvent(BaseModel):
    """Immutable event envelope with a typed, discriminated payload."""

    model_config = {"frozen": True}

    id: UUID = Field(default_factory=uuid4)
    type: EventType
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    source: str
    payload: EventPayload = Field(default_factory=EmptyPayload)


def new_event(
    event_type: EventType,
    *,
    source: str,
    payload: EventPayload | None = None,
) -> StagePilotEvent:
    """Build an event while keeping event creation consistent at call sites."""

    return StagePilotEvent(type=event_type, source=source, payload=payload or EmptyPayload())
