"""Explicit dependency container for one StagePilot application instance."""

from __future__ import annotations

from dataclasses import dataclass

from stagepilot.core.config import Settings
from stagepilot.core.event_bus import EventBus
from stagepilot.core.midi import MidiController
from stagepilot.core.plugin import PluginManager
from stagepilot.core.state import StateStore
from stagepilot.services.state_service import StateService


@dataclass(frozen=True, slots=True)
class Runtime:
    settings: Settings
    event_bus: EventBus
    state_store: StateStore
    state_service: StateService
    plugin_manager: PluginManager
    midi_controller: MidiController | None
