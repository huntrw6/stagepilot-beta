from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import date

import pytest
import pytest_asyncio

from stagepilot.core.event_bus import EventBus
from stagepilot.core.events import (
    ActionName,
    EventType,
    ServiceLoadPayload,
    ServicePayload,
    StagePilotEvent,
    TimerPayload,
    new_event,
)
from stagepilot.core.state import StateStore
from stagepilot.models.state import ServiceLoadStatus, ServicePlan, Song, TimerStatus
from stagepilot.services.state_service import StateService


def make_plan(
    *songs: Song,
    plan_id: str = "plan-1",
) -> ServicePlan:
    return ServicePlan(
        id=plan_id,
        title="Test Service",
        date=date(2026, 7, 12),
        service_type="Weekend",
        service_times=["09:00"],
        songs=list(songs),
    )


def song(
    identifier: str,
    title: str,
    order: int,
    duration_seconds: int | None = 240,
) -> Song:
    return Song(
        id=identifier,
        title=title,
        order=order,
        duration_seconds=duration_seconds,
    )


@pytest_asyncio.fixture
async def service() -> AsyncIterator[tuple[EventBus, StateStore, StateService]]:
    bus = EventBus()
    store = StateStore()
    state_service = StateService(bus, store)
    await state_service.start()
    try:
        yield bus, store, state_service
    finally:
        await state_service.stop()


async def load(bus: EventBus, plan: ServicePlan) -> None:
    await bus.publish(
        new_event(
            EventType.SERVICE_LOADED,
            source="test",
            payload=ServicePayload(plan=plan),
        )
    )


@pytest.mark.asyncio
async def test_start_next_song_selects_first_then_advances(
    service: tuple[EventBus, StateStore, StateService],
) -> None:
    bus, store, state_service = service
    await load(bus, make_plan(song("a", "Alpha", 1), song("b", "Beta", 2)))
    started: list[StagePilotEvent] = []
    await bus.subscribe(EventType.SONG_STARTED, started.append)

    first = await state_service.dispatch(ActionName.START_NEXT)
    first_state = await store.snapshot()
    second = await state_service.dispatch(ActionName.START_NEXT)
    second_state = await store.snapshot()

    assert first.accepted is True
    assert first_state.current_song and first_state.current_song.title == "Alpha"
    assert first_state.next_song and first_state.next_song.title == "Beta"
    assert second.accepted is True
    assert second_state.current_song and second_state.current_song.title == "Beta"
    assert second_state.next_song is None
    assert len(started) == 2


@pytest.mark.asyncio
async def test_restart_current_song_does_not_advance(
    service: tuple[EventBus, StateStore, StateService],
) -> None:
    bus, store, state_service = service
    await load(bus, make_plan(song("a", "Alpha", 1), song("b", "Beta", 2)))
    await state_service.dispatch(ActionName.START_NEXT)
    restarted: list[StagePilotEvent] = []
    await bus.subscribe(EventType.SONG_RESTARTED, restarted.append)

    outcome = await state_service.dispatch(ActionName.RESTART_CURRENT)
    state = await store.snapshot()

    assert outcome.accepted is True
    assert state.current_song_index == 0
    assert state.current_song and state.current_song.title == "Alpha"
    assert len(restarted) == 1


@pytest.mark.asyncio
async def test_previous_selects_song_without_starting_it(
    service: tuple[EventBus, StateStore, StateService],
) -> None:
    bus, store, state_service = service
    await load(bus, make_plan(song("a", "Alpha", 1), song("b", "Beta", 2)))
    await state_service.dispatch(ActionName.START_NEXT)
    await state_service.dispatch(ActionName.START_NEXT)
    started: list[StagePilotEvent] = []
    await bus.subscribe(EventType.SONG_STARTED, started.append)

    outcome = await state_service.dispatch(ActionName.PREVIOUS)
    state = await store.snapshot()

    assert outcome.accepted is True
    assert state.current_song_index == 0
    assert state.current_song and state.current_song.title == "Alpha"
    assert started == []


@pytest.mark.asyncio
async def test_next_selects_then_start_next_starts_that_selection(
    service: tuple[EventBus, StateStore, StateService],
) -> None:
    bus, store, state_service = service
    await load(bus, make_plan(song("a", "Alpha", 1), song("b", "Beta", 2)))

    selected = await state_service.dispatch(ActionName.NEXT)
    selected_state = await store.snapshot()
    started = await state_service.dispatch(ActionName.START_NEXT)

    assert selected.accepted is True
    assert selected_state.current_song_index == 0
    assert started.accepted is True
    assert (await store.snapshot()).current_song_index == 0


@pytest.mark.asyncio
async def test_first_and_last_song_bounds_are_safe(
    service: tuple[EventBus, StateStore, StateService],
) -> None:
    bus, store, state_service = service
    await load(bus, make_plan(song("a", "Only", 1)))

    before_first = await state_service.dispatch(ActionName.PREVIOUS)
    await state_service.dispatch(ActionName.START_NEXT)
    after_last_next = await state_service.dispatch(ActionName.NEXT)
    after_last_start = await state_service.dispatch(ActionName.START_NEXT)

    assert before_first.accepted is False
    assert after_last_next.accepted is False
    assert after_last_start.accepted is False
    assert (await store.snapshot()).current_song_index == 0


@pytest.mark.asyncio
async def test_empty_plan_actions_are_rejected_without_mutating_position(
    service: tuple[EventBus, StateStore, StateService],
) -> None:
    bus, store, state_service = service
    await load(bus, make_plan())

    for action in (
        ActionName.START_NEXT,
        ActionName.RESTART_CURRENT,
        ActionName.PREVIOUS,
        ActionName.NEXT,
    ):
        assert (await state_service.dispatch(action)).accepted is False

    state = await store.snapshot()
    assert state.current_song is None
    assert state.next_song is None


@pytest.mark.asyncio
async def test_plan_reload_preserves_current_song_by_stable_id(
    service: tuple[EventBus, StateStore, StateService],
) -> None:
    bus, store, state_service = service
    await load(bus, make_plan(song("a", "Alpha", 1), song("b", "Beta", 2)))
    await state_service.dispatch(ActionName.START_NEXT)

    await load(
        bus,
        make_plan(
            song("b", "Beta", 1),
            song("a", "Alpha", 2),
            plan_id="plan-reloaded",
        ),
    )
    state = await store.snapshot()

    assert state.current_song and state.current_song.id == "a"
    assert state.current_song_index == 1
    assert state.last_successful_plan_reload_at is not None


@pytest.mark.asyncio
async def test_plan_reload_resets_ambiguous_duplicate_song_names(
    service: tuple[EventBus, StateStore, StateService],
) -> None:
    bus, store, state_service = service
    await load(bus, make_plan(song("old-1", "Repeat", 1), song("old-2", "Repeat", 2)))
    await state_service.dispatch(ActionName.START_NEXT)

    await load(
        bus,
        make_plan(
            song("new-1", "Repeat", 1),
            song("new-2", "Repeat", 2),
            plan_id="plan-reloaded",
        ),
    )
    state = await store.snapshot()

    assert state.current_song is None
    assert state.current_song_index is None
    assert state.next_song and state.next_song.id == "new-1"


@pytest.mark.asyncio
@pytest.mark.parametrize("duration_seconds", [None, 0])
async def test_missing_or_zero_duration_never_starts_timer(
    service: tuple[EventBus, StateStore, StateService],
    duration_seconds: int | None,
) -> None:
    bus, store, state_service = service
    await load(bus, make_plan(song("a", "No Duration", 1, duration_seconds)))
    started: list[StagePilotEvent] = []
    await bus.subscribe(EventType.SONG_STARTED, started.append)

    outcome = await state_service.dispatch(ActionName.START_NEXT)
    state = await store.snapshot()

    assert outcome.accepted is False
    assert state.current_song and state.current_song.title == "No Duration"
    assert state.timer.status is TimerStatus.ERROR
    assert state.recent_errors
    assert started == []


@pytest.mark.asyncio
async def test_reset_position_returns_to_pre_service_state(
    service: tuple[EventBus, StateStore, StateService],
) -> None:
    bus, store, state_service = service
    await load(bus, make_plan(song("a", "Alpha", 1), song("b", "Beta", 2)))
    await state_service.dispatch(ActionName.START_NEXT)

    outcome = await state_service.dispatch(ActionName.RESET_POSITION)
    state = await store.snapshot()

    assert outcome.accepted is True
    assert state.current_song is None
    assert state.current_song_index is None
    assert state.next_song and state.next_song.id == "a"
    assert state.timer.status is TimerStatus.STOPPED


@pytest.mark.asyncio
async def test_date_rollover_clears_plan_and_resets_running_timer(
    service: tuple[EventBus, StateStore, StateService],
) -> None:
    bus, store, _state_service = service
    stop_requests: list[StagePilotEvent] = []
    await bus.subscribe(EventType.TIMER_STOP_REQUESTED, stop_requests.append)
    await load(bus, make_plan(song("a", "Alpha", 1)))
    await bus.publish(
        new_event(
            EventType.TIMER_STARTED,
            source="test",
            payload=TimerPayload(duration_seconds=240),
        )
    )

    await bus.publish(
        new_event(
            EventType.SERVICE_LOAD_CHANGED,
            source="test",
            payload=ServiceLoadPayload(
                status=ServiceLoadStatus.ERROR,
                target_date=date(2026, 7, 13),
                message="The new service could not be loaded.",
            ),
        )
    )
    state = await store.snapshot()

    assert state.plan is None
    assert state.current_song is None
    assert state.current_song_index is None
    assert state.next_song is None
    assert state.timer.status is TimerStatus.STOPPED
    assert state.timer.duration_seconds is None
    assert state.timer.started_at is None
    assert len(stop_requests) == 1


@pytest.mark.asyncio
async def test_same_day_stale_load_keeps_plan_and_running_timer(
    service: tuple[EventBus, StateStore, StateService],
) -> None:
    bus, store, _state_service = service
    plan = make_plan(song("a", "Alpha", 1))
    await load(bus, plan)
    await bus.publish(
        new_event(
            EventType.TIMER_STARTED,
            source="test",
            payload=TimerPayload(duration_seconds=240),
        )
    )

    await bus.publish(
        new_event(
            EventType.SERVICE_LOAD_CHANGED,
            source="test",
            payload=ServiceLoadPayload(
                status=ServiceLoadStatus.ERROR,
                target_date=plan.date,
                message="The refresh failed.",
                is_stale=True,
            ),
        )
    )
    state = await store.snapshot()

    assert state.plan == plan
    assert state.service_load.is_stale is True
    assert state.timer.status is TimerStatus.RUNNING
    assert state.timer.duration_seconds == 240
