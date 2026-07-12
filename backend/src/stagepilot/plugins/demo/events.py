"""Typed event factories emitted by the demo integration."""

from __future__ import annotations

from typing import Literal

from stagepilot.core.events import (
    ConnectionPayload,
    EventType,
    ServicePayload,
    StagePilotEvent,
    TimerPayload,
    new_event,
)
from stagepilot.models.state import ConnectionStatus, ServicePlan


def service_loaded(plan: ServicePlan) -> StagePilotEvent:
    return new_event(
        EventType.SERVICE_LOADED,
        source="demo",
        payload=ServicePayload(plan=plan),
    )


def connection_ready(
    integration: Literal["planning_center", "midi", "propresenter"],
) -> StagePilotEvent:
    return new_event(
        EventType.CONNECTION_CHANGED,
        source="demo",
        payload=ConnectionPayload(
            integration=integration,
            status=ConnectionStatus.CONNECTED,
            detail="Simulated by demo mode",
        ),
    )


def timer_started(duration_seconds: int) -> StagePilotEvent:
    return new_event(
        EventType.TIMER_STARTED,
        source="demo",
        payload=TimerPayload(duration_seconds=duration_seconds),
    )


def timer_stopped() -> StagePilotEvent:
    return new_event(
        EventType.TIMER_STOPPED,
        source="demo",
        payload=TimerPayload(duration_seconds=0),
    )
