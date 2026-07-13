"""Synchronous, typed boundary around Mido's MIDI input API."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Literal, Protocol, TypeGuard, cast

import mido

from stagepilot.plugins.midi_playback.models import MidiMessage

type MidiMessageCallback = Callable[[MidiMessage], None]


class MidiInputPortContract(Protocol):
    """Minimal input-port surface owned by the MIDI plugin lifecycle."""

    @property
    def closed(self) -> bool: ...

    def close(self) -> None: ...


class MidiBackendContract(Protocol):
    """Discover and open MIDI inputs without exposing vendor objects."""

    def list_input_names(self) -> list[str]: ...

    def open_input(
        self,
        name: str,
        callback: MidiMessageCallback,
    ) -> MidiInputPortContract: ...


type MidiBackendFactory = Callable[[], MidiBackendContract]


class _MidoInputPort(Protocol):
    @property
    def closed(self) -> bool: ...

    def close(self) -> None: ...


class _RawMidiMessage(Protocol):
    type: object
    channel: object
    note: object
    velocity: object


type _MidoMessageCallback = Callable[[object], None]


class _MidoBackend(Protocol):
    def get_input_names(self) -> Sequence[str]: ...

    def open_input(
        self,
        name: str,
        *,
        callback: _MidoMessageCallback,
    ) -> _MidoInputPort: ...


class MidoInputPort:
    """Hide a Mido input port behind StagePilot's narrow lifecycle contract."""

    def __init__(self, port: _MidoInputPort) -> None:
        self._port = port

    @property
    def closed(self) -> bool:
        return bool(self._port.closed)

    def close(self) -> None:
        if not self.closed:
            self._port.close()


class MidoMidiBackend:
    """Use Mido's RtMidi backend while emitting only validated note messages."""

    def __init__(self, backend: _MidoBackend | None = None) -> None:
        self._backend = backend or cast(_MidoBackend, mido.Backend("mido.backends.rtmidi"))

    def list_input_names(self) -> list[str]:
        return list(self._backend.get_input_names())

    def open_input(
        self,
        name: str,
        callback: MidiMessageCallback,
    ) -> MidiInputPortContract:
        matches = self.list_input_names().count(name)
        if matches == 0:
            raise ValueError("The configured MIDI input is unavailable.")
        if matches > 1:
            raise ValueError("The configured MIDI input name is ambiguous.")

        def receive(raw_message: object) -> None:
            message = _normalize_message(raw_message)
            if message is not None:
                callback(message)

        return MidoInputPort(self._backend.open_input(name, callback=receive))


def _normalize_message(raw_message: object) -> MidiMessage | None:
    """Translate one Mido message, dropping malformed or unsupported input."""

    message = cast(_RawMidiMessage, raw_message)
    try:
        message_type = message.type
        channel = message.channel
        note = message.note
        velocity = message.velocity
    except Exception:
        return None

    if message_type != "note_on" and message_type != "note_off":
        return None
    if (
        not _is_midi_integer(channel)
        or not _is_midi_integer(note)
        or not _is_midi_integer(velocity)
    ):
        return None
    if not 0 <= channel <= 15 or not 0 <= note <= 127 or not 0 <= velocity <= 127:
        return None

    normalized_type: Literal["note_on", "note_off"] = (
        "note_off" if message_type == "note_on" and velocity == 0 else message_type
    )
    return MidiMessage(
        type=normalized_type,
        channel=channel + 1,
        note=note,
        velocity=velocity,
    )


def _is_midi_integer(value: object) -> TypeGuard[int]:
    return isinstance(value, int) and not isinstance(value, bool)
