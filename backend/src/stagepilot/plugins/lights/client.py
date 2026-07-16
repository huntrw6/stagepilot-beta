"""Synchronous, typed boundary around Mido's MIDI output API."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Protocol, cast

import mido


class MidiOutputPortContract(Protocol):
    @property
    def closed(self) -> bool: ...

    def send_note_on(self, channel: int, note: int, velocity: int) -> None: ...

    def send_note_off(self, channel: int, note: int) -> None: ...

    def close(self) -> None: ...


class MidiOutputBackendContract(Protocol):
    def list_output_names(self) -> list[str]: ...

    def open_output(self, name: str) -> MidiOutputPortContract: ...


type MidiOutputBackendFactory = Callable[[], MidiOutputBackendContract]


class _MidoOutputPort(Protocol):
    @property
    def closed(self) -> bool: ...

    def send(self, message: object) -> None: ...

    def close(self) -> None: ...


class _MidoBackend(Protocol):
    def get_output_names(self) -> Sequence[str]: ...

    def open_output(self, name: str) -> _MidoOutputPort: ...


class MidoOutputPort:
    def __init__(self, port: _MidoOutputPort) -> None:
        self._port = port

    @property
    def closed(self) -> bool:
        return bool(self._port.closed)

    def send_note_on(self, channel: int, note: int, velocity: int) -> None:
        self._port.send(mido.Message("note_on", channel=channel - 1, note=note, velocity=velocity))

    def send_note_off(self, channel: int, note: int) -> None:
        self._port.send(mido.Message("note_off", channel=channel - 1, note=note, velocity=0))

    def close(self) -> None:
        if not self.closed:
            self._port.close()


class MidoMidiOutputBackend:
    """Discover and open CoreMIDI/RtMidi outputs exposed to StagePilot."""

    def __init__(self, backend: _MidoBackend | None = None) -> None:
        self._backend = backend or cast(_MidoBackend, mido.Backend("mido.backends.rtmidi"))

    def list_output_names(self) -> list[str]:
        return list(self._backend.get_output_names())

    def open_output(self, name: str) -> MidiOutputPortContract:
        matches = self.list_output_names().count(name)
        if matches == 0:
            raise ValueError("The configured lighting MIDI output is unavailable.")
        if matches > 1:
            raise ValueError("The configured lighting MIDI output name is ambiguous.")
        return MidoOutputPort(self._backend.open_output(name))
