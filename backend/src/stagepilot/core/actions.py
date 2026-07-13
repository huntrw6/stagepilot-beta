"""Shared contracts for dispatching StagePilot domain actions."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from stagepilot.core.events import ActionName


@dataclass(frozen=True, slots=True)
class ActionOutcome:
    """Result returned after the state service handles one domain action."""

    accepted: bool
    message: str


class ActionDispatcher(Protocol):
    """Narrow action boundary used by input integrations such as MIDI."""

    async def dispatch(
        self,
        action: ActionName,
        source: str = "api",
    ) -> ActionOutcome: ...
