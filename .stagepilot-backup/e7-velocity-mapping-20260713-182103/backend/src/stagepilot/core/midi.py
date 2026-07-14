"""Vendor-neutral contracts exposed by the MIDI Playback integration."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Protocol

from stagepilot.core.actions import ActionOutcome
from stagepilot.core.events import ActionName


class MidiCueName(StrEnum):
    START_NEXT = "start_next"
    RESTART_CURRENT = "restart_current"
    PREVIOUS = "previous"
    NEXT = "next"
    RELOAD_PLAN = "reload_plan"
    STOP_TIMER = "stop_timer"

    @property
    def action(self) -> ActionName:
        return ActionName(self.value)


class MidiMessageDisposition(StrEnum):
    DISPATCHED = "dispatched"
    ACTION_REJECTED = "action_rejected"
    DUPLICATE = "duplicate"
    UNMAPPED = "unmapped"
    WRONG_CHANNEL = "wrong_channel"
    NOTE_RELEASE = "note_release"
    QUEUE_FULL = "queue_full"
    ERROR = "error"


@dataclass(frozen=True, slots=True)
class MidiInputInfo:
    id: str
    name: str
    ambiguous: bool
    selected: bool
    connected: bool


@dataclass(frozen=True, slots=True)
class MidiMonitorMessage:
    timestamp: datetime
    input_name: str | None
    message_type: str
    channel: int
    note: int
    note_name: str
    velocity: int
    disposition: MidiMessageDisposition
    detail: str
    action: ActionName | None = None
    simulated: bool = False


@dataclass(frozen=True, slots=True)
class MidiInputSnapshot:
    enabled: bool
    channel: int
    configured_input_name: str | None
    selected_input_name: str | None
    inputs: tuple[MidiInputInfo, ...]
    mappings: tuple[tuple[MidiCueName, int], ...]


class MidiController(Protocol):
    async def input_snapshot(self, *, refresh: bool = False) -> MidiInputSnapshot: ...

    async def select_input(self, input_id: str | None) -> ActionOutcome: ...

    async def simulate_cue(self, cue: MidiCueName) -> ActionOutcome: ...

    async def recent_messages(self) -> tuple[MidiMonitorMessage, ...]: ...
