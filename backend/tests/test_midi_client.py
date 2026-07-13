from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from stagepilot.plugins.midi_playback.client import MidoMidiBackend
from stagepilot.plugins.midi_playback.models import MidiMessage


class FakeMidoPort:
    def __init__(self) -> None:
        self.closed = False
        self.close_calls = 0

    def close(self) -> None:
        self.close_calls += 1
        self.closed = True


class FakeMidoBackend:
    def __init__(self, input_names: Sequence[str]) -> None:
        self.input_names = list(input_names)
        self.list_calls = 0
        self.open_calls: list[str] = []
        self.callback: Callable[[object], None] | None = None
        self.port = FakeMidoPort()

    def get_input_names(self) -> Sequence[str]:
        self.list_calls += 1
        return self.input_names

    def open_input(
        self,
        name: str,
        *,
        callback: Callable[[object], None],
    ) -> FakeMidoPort:
        self.open_calls.append(name)
        self.callback = callback
        return self.port

    def emit(self, message: object) -> None:
        assert self.callback is not None
        self.callback(message)


@dataclass
class BrokenMessage:
    @property
    def type(self) -> str:
        raise RuntimeError("malformed vendor message")


def raw_message(
    message_type: object = "note_on",
    *,
    channel: object = 0,
    note: object = 60,
    velocity: object = 100,
) -> object:
    return SimpleNamespace(
        type=message_type,
        channel=channel,
        note=note,
        velocity=velocity,
    )


def test_midi_message_is_strict_validated_and_frozen() -> None:
    message = MidiMessage(type="note_on", channel=1, note=60, velocity=100)

    with pytest.raises(ValidationError):
        message.channel = 2  # type: ignore[misc]
    with pytest.raises(ValidationError):
        MidiMessage(type="note_on", channel=0, note=60, velocity=100)
    with pytest.raises(ValidationError):
        MidiMessage(type="note_on", channel=1, note=True, velocity=100)


def test_lists_inputs_without_exposing_the_vendor_collection() -> None:
    vendor = FakeMidoBackend(["Playback", "Keyboard"])
    backend = MidoMidiBackend(vendor)

    names = backend.list_input_names()
    names.append("Mutated")

    assert names == ["Playback", "Keyboard", "Mutated"]
    assert vendor.input_names == ["Playback", "Keyboard"]
    assert vendor.list_calls == 1


def test_opens_only_an_exact_available_input_and_wraps_its_port() -> None:
    vendor = FakeMidoBackend(["Playback", "Playback Auxiliary"])
    backend = MidoMidiBackend(vendor)

    port = backend.open_input("Playback", lambda _message: None)

    assert vendor.open_calls == ["Playback"]
    assert port.closed is False
    port.close()
    port.close()
    assert port.closed is True
    assert vendor.port.close_calls == 1


@pytest.mark.parametrize(
    ("available", "requested", "message"),
    [
        (["Playback Auxiliary"], "Playback", "unavailable"),
        (["Playback", "Playback"], "Playback", "ambiguous"),
    ],
)
def test_rejects_missing_or_ambiguous_exact_input_names(
    available: list[str],
    requested: str,
    message: str,
) -> None:
    vendor = FakeMidoBackend(available)
    backend = MidoMidiBackend(vendor)

    with pytest.raises(ValueError, match=message):
        backend.open_input(requested, lambda _message: None)

    assert vendor.open_calls == []


def test_normalizes_note_messages_and_converts_channels_to_one_based() -> None:
    vendor = FakeMidoBackend(["Playback"])
    backend = MidoMidiBackend(vendor)
    received: list[MidiMessage] = []
    backend.open_input("Playback", received.append)

    vendor.emit(raw_message("note_on", channel=0, note=60, velocity=100))
    vendor.emit(raw_message("note_off", channel=15, note=127, velocity=64))

    assert received == [
        MidiMessage(type="note_on", channel=1, note=60, velocity=100),
        MidiMessage(type="note_off", channel=16, note=127, velocity=64),
    ]


def test_note_on_with_zero_velocity_is_normalized_to_note_off() -> None:
    vendor = FakeMidoBackend(["Playback"])
    backend = MidoMidiBackend(vendor)
    received: list[MidiMessage] = []
    backend.open_input("Playback", received.append)

    vendor.emit(raw_message("note_on", channel=4, note=42, velocity=0))

    assert received == [MidiMessage(type="note_off", channel=5, note=42, velocity=0)]


@pytest.mark.parametrize(
    "message",
    [
        raw_message("control_change"),
        raw_message(channel=-1),
        raw_message(channel=16),
        raw_message(channel=True),
        raw_message(channel="0"),
        raw_message(note=-1),
        raw_message(note=128),
        raw_message(note=True),
        raw_message(note="60"),
        raw_message(velocity=-1),
        raw_message(velocity=128),
        raw_message(velocity=True),
        raw_message(velocity="100"),
        SimpleNamespace(type="note_on"),
        BrokenMessage(),
    ],
)
def test_ignores_non_note_malformed_and_out_of_range_messages(message: object) -> None:
    vendor = FakeMidoBackend(["Playback"])
    backend = MidoMidiBackend(vendor)
    received: list[MidiMessage] = []
    backend.open_input("Playback", received.append)

    vendor.emit(message)

    assert received == []
