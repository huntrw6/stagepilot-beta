"""Concurrency-safe observable application state store."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from contextlib import suppress
from datetime import UTC, datetime

from stagepilot.models.state import ApplicationState

type StateMutation = Callable[[ApplicationState], None]


class StateStore:
    """Own the current state and fan out immutable snapshots after each mutation."""

    def __init__(self, initial_state: ApplicationState | None = None) -> None:
        self._state = initial_state or ApplicationState()
        self._lock = asyncio.Lock()
        self._observers: set[asyncio.Queue[ApplicationState]] = set()

    async def snapshot(self) -> ApplicationState:
        async with self._lock:
            return self._state.model_copy(deep=True)

    async def mutate(self, mutation: StateMutation) -> ApplicationState:
        async with self._lock:
            mutation(self._state)
            self._state.revision += 1
            self._state.updated_at = datetime.now(UTC)
            snapshot = self._state.model_copy(deep=True)
            observers = tuple(self._observers)

        for observer in observers:
            if observer.full():
                with suppress(asyncio.QueueEmpty):
                    observer.get_nowait()
            observer.put_nowait(snapshot.model_copy(deep=True))
        return snapshot

    async def subscribe(self) -> asyncio.Queue[ApplicationState]:
        queue: asyncio.Queue[ApplicationState] = asyncio.Queue(maxsize=1)
        async with self._lock:
            self._observers.add(queue)
        return queue

    async def unsubscribe(self, queue: asyncio.Queue[ApplicationState]) -> None:
        async with self._lock:
            self._observers.discard(queue)
