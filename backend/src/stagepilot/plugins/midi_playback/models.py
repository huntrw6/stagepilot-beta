"""Vendor-neutral MIDI messages accepted by the Playback integration."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class MidiMessage(BaseModel):
    """A validated note message with an operator-facing, one-based channel."""

    model_config = ConfigDict(frozen=True, strict=True)

    type: Literal["note_on", "note_off"]
    channel: int = Field(ge=1, le=16)
    note: int = Field(ge=0, le=127)
    velocity: int = Field(ge=0, le=127)
