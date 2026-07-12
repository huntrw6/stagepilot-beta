from __future__ import annotations

import asyncio

import pytest

from stagepilot.core.event_bus import EventBus
from stagepilot.core.events import EventType, StagePilotEvent, new_event


@pytest.mark.asyncio
async def test_event_publication_reaches_subscriber() -> None:
    bus = EventBus()
    received: list[StagePilotEvent] = []
    await bus.subscribe(EventType.APPLICATION_STARTED, received.append)
    event = new_event(EventType.APPLICATION_STARTED, source="test")

    report = await bus.publish(event)

    assert received == [event]
    assert report.delivered == 1
    assert report.failures == ()


@pytest.mark.asyncio
async def test_multiple_subscribers_each_receive_event() -> None:
    bus = EventBus()
    first: list[str] = []
    second: list[str] = []
    await bus.subscribe(EventType.APPLICATION_STARTED, lambda event: first.append(event.source))
    await bus.subscribe(EventType.APPLICATION_STARTED, lambda event: second.append(event.source))

    report = await bus.publish(new_event(EventType.APPLICATION_STARTED, source="test"))

    assert first == ["test"]
    assert second == ["test"]
    assert report.delivered == 2


@pytest.mark.asyncio
async def test_subscriber_failure_is_isolated() -> None:
    bus = EventBus()
    received: list[StagePilotEvent] = []

    def broken_subscriber(_event: StagePilotEvent) -> None:
        raise RuntimeError("subscriber exploded")

    await bus.subscribe(EventType.APPLICATION_STARTED, broken_subscriber)
    await bus.subscribe(EventType.APPLICATION_STARTED, received.append)
    event = new_event(EventType.APPLICATION_STARTED, source="test")

    report = await bus.publish(event)

    assert received == [event]
    assert report.delivered == 1
    assert len(report.failures) == 1
    assert report.failures[0].error == "subscriber exploded"


@pytest.mark.asyncio
async def test_async_subscriber_is_awaited() -> None:
    bus = EventBus()
    finished = asyncio.Event()

    async def subscriber(_event: StagePilotEvent) -> None:
        await asyncio.sleep(0)
        finished.set()

    await bus.subscribe(EventType.APPLICATION_STARTED, subscriber)

    await bus.publish(new_event(EventType.APPLICATION_STARTED, source="test"))

    assert finished.is_set()


@pytest.mark.asyncio
async def test_wildcard_subscriber_receives_every_event_type() -> None:
    bus = EventBus()
    received: list[EventType] = []
    await bus.subscribe(None, lambda event: received.append(event.type))

    await bus.publish(new_event(EventType.APPLICATION_STARTED, source="test"))
    await bus.publish(new_event(EventType.APPLICATION_STOPPING, source="test"))

    assert received == [EventType.APPLICATION_STARTED, EventType.APPLICATION_STOPPING]


@pytest.mark.asyncio
async def test_unsubscribe_prevents_future_delivery() -> None:
    bus = EventBus()
    received: list[StagePilotEvent] = []
    subscription = await bus.subscribe(EventType.APPLICATION_STARTED, received.append)

    assert await bus.unsubscribe(subscription) is True
    assert await bus.unsubscribe(subscription) is False
    report = await bus.publish(new_event(EventType.APPLICATION_STARTED, source="test"))

    assert received == []
    assert report.delivered == 0
