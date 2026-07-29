"""Typed event factories emitted by the demo integration."""

from __future__ import annotations

from stagepilot.core.events import (
    EventType,
    ServiceLoadPayload,
    ServicePayload,
    StagePilotEvent,
    TimerPayload,
    new_event,
)
from stagepilot.models.state import ServiceLoadStatus, ServicePlan, Song


def service_loaded(plan: ServicePlan) -> StagePilotEvent:
    return new_event(
        EventType.SERVICE_LOADED,
        source="demo",
        payload=ServicePayload(plan=plan),
    )


def service_load_ready(plan: ServicePlan) -> StagePilotEvent:
    return new_event(
        EventType.SERVICE_LOAD_CHANGED,
        source="demo",
        payload=ServiceLoadPayload(
            status=ServiceLoadStatus.LOADED,
            target_date=plan.date,
            message="Demo service loaded.",
        ),
    )


def timer_started(duration_seconds: int, song: Song) -> StagePilotEvent:
    return new_event(
        EventType.TIMER_STARTED,
        source="demo",
        payload=TimerPayload(duration_seconds=duration_seconds, song=song),
    )


def timer_stopped() -> StagePilotEvent:
    return new_event(
        EventType.TIMER_STOPPED,
        source="demo",
        payload=TimerPayload(duration_seconds=0),
    )
