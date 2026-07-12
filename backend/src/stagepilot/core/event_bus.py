"""Failure-isolated in-process event bus."""

from __future__ import annotations

import asyncio
import inspect
from collections import defaultdict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

from stagepilot.core.events import EventType, StagePilotEvent
from stagepilot.core.logging import get_logger

type Subscriber = Callable[[StagePilotEvent], Awaitable[None] | None]


@dataclass(frozen=True, slots=True)
class Subscription:
    id: UUID
    event_type: EventType | None


@dataclass(frozen=True, slots=True)
class SubscriberFailure:
    subscription_id: UUID
    error: str


@dataclass(frozen=True, slots=True)
class PublishReport:
    event: StagePilotEvent
    delivered: int
    failures: tuple[SubscriberFailure, ...]


class EventBus:
    """Publish typed events to independent synchronous or asynchronous subscribers."""

    def __init__(self) -> None:
        self._subscribers: dict[EventType | None, dict[UUID, Subscriber]] = defaultdict(dict)
        self._lock = asyncio.Lock()
        self._logger = get_logger("event_bus")

    async def subscribe(
        self,
        event_type: EventType | None,
        subscriber: Subscriber,
    ) -> Subscription:
        """Subscribe to one event type, or all events when *event_type* is ``None``."""

        subscription = Subscription(id=uuid4(), event_type=event_type)
        async with self._lock:
            self._subscribers[event_type][subscription.id] = subscriber
        return subscription

    async def unsubscribe(self, subscription: Subscription) -> bool:
        """Remove a subscription, returning whether it was still registered."""

        async with self._lock:
            subscribers = self._subscribers.get(subscription.event_type)
            if subscribers is None:
                return False
            removed = subscribers.pop(subscription.id, None) is not None
            if not subscribers:
                self._subscribers.pop(subscription.event_type, None)
            return removed

    async def publish(self, event: StagePilotEvent) -> PublishReport:
        """Deliver an event concurrently and report failures without raising them."""

        async with self._lock:
            subscribers = [
                *self._subscribers.get(event.type, {}).items(),
                *self._subscribers.get(None, {}).items(),
            ]

        results = await asyncio.gather(
            *(
                self._invoke(subscription_id, subscriber, event)
                for subscription_id, subscriber in subscribers
            )
        )
        failures = tuple(result for result in results if result is not None)
        if failures:
            self._logger.warning(
                "event_subscriber_failures",
                event_id=str(event.id),
                event_type=event.type,
                failures=len(failures),
            )
        else:
            self._logger.debug(
                "event_published",
                event_id=str(event.id),
                event_type=event.type,
                subscribers=len(subscribers),
            )
        return PublishReport(
            event=event,
            delivered=len(subscribers) - len(failures),
            failures=failures,
        )

    async def _invoke(
        self,
        subscription_id: UUID,
        subscriber: Subscriber,
        event: StagePilotEvent,
    ) -> SubscriberFailure | None:
        try:
            if inspect.iscoroutinefunction(subscriber):
                await subscriber(event)
            else:
                result: Any = await asyncio.to_thread(subscriber, event)
                if inspect.isawaitable(result):
                    await result
        except Exception as exc:  # subscriber isolation is the purpose of this boundary
            self._logger.exception(
                "event_subscriber_failed",
                event_id=str(event.id),
                event_type=event.type,
                subscription_id=str(subscription_id),
            )
            return SubscriberFailure(subscription_id=subscription_id, error=str(exc))
        return None
