from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

import pytest

from stagepilot.core.config import LightingCue, LightsSettings, SongLightingCueMap
from stagepilot.core.event_bus import EventBus
from stagepilot.core.events import EventType, SongPayload, TimerPayload, new_event
from stagepilot.core.state import StateStore
from stagepilot.models.state import ConnectionStatus, Song
from stagepilot.plugins.lights import LightsPlugin


@dataclass
class FakeOutputPort:
    closed: bool = False
    messages: list[tuple[str, int, int, int]] = field(default_factory=list)

    def send_note_on(self, channel: int, note: int, velocity: int) -> None:
        self.messages.append(("note_on", channel, note, velocity))

    def send_note_off(self, channel: int, note: int) -> None:
        self.messages.append(("note_off", channel, note, 0))

    def close(self) -> None:
        self.closed = True


@dataclass
class FakeOutputBackend:
    names: list[str] = field(default_factory=lambda: ["StagePilot to Lightkey"])
    ports: list[FakeOutputPort] = field(default_factory=list)

    def list_output_names(self) -> list[str]:
        return list(self.names)

    def open_output(self, name: str) -> FakeOutputPort:
        if self.names.count(name) != 1:
            raise ValueError("Output unavailable.")
        port = FakeOutputPort()
        self.ports.append(port)
        return port


def worship_song() -> Song:
    return Song(
        id="plan-item-1",
        source_song_id="song-1",
        title="Holy Forever",
        duration_seconds=300,
        order=1,
    )


def lights_settings(*cues: LightingCue) -> LightsSettings:
    return LightsSettings(
        enabled=True,
        output_name="StagePilot to Lightkey",
        channel=3,
        pulse_ms=10,
        cue_maps={
            "song-1": SongLightingCueMap(
                song_key="song-1",
                song_title="Holy Forever",
                cues=list(cues),
            )
        },
    )


async def publish_song_start(bus: EventBus, *, duration: int = 300) -> None:
    song = worship_song()
    await bus.publish(
        new_event(
            EventType.SONG_STARTED,
            source="test",
            payload=SongPayload(song=song, index=0),
        )
    )
    await bus.publish(
        new_event(
            EventType.TIMER_STARTED,
            source="propresenter",
            payload=TimerPayload(duration_seconds=duration, song=song),
        )
    )


@pytest.mark.asyncio
async def test_timer_start_sends_elapsed_cue_as_note_on_off_pulse() -> None:
    bus = EventBus()
    backend = FakeOutputBackend()
    plugin = LightsPlugin(
        bus,
        StateStore(),
        lights_settings(LightingCue(at_seconds=0, note=72, velocity=110, label="Intro")),
        backend_factory=lambda: backend,
    )

    await plugin.start()
    await publish_song_start(bus)
    await asyncio.sleep(0.05)
    snapshot = await plugin.snapshot()
    await plugin.stop()

    assert backend.ports[0].messages == [
        ("note_on", 3, 72, 110),
        ("note_off", 3, 72, 0),
    ]
    assert snapshot.connection_status is ConnectionStatus.CONNECTED
    assert snapshot.last_cue is not None
    assert snapshot.last_cue.label == "Intro"


@pytest.mark.asyncio
async def test_timer_payload_carries_song_without_relying_on_subscriber_order() -> None:
    bus = EventBus()
    backend = FakeOutputBackend()
    plugin = LightsPlugin(
        bus,
        StateStore(),
        lights_settings(LightingCue(at_seconds=0, note=71, velocity=120)),
        backend_factory=lambda: backend,
    )

    await plugin.start()
    await bus.publish(
        new_event(
            EventType.TIMER_STARTED,
            source="propresenter",
            payload=TimerPayload(duration_seconds=300, song=worship_song()),
        )
    )
    await asyncio.sleep(0.05)
    await plugin.stop()

    assert backend.ports[0].messages == [
        ("note_on", 3, 71, 120),
        ("note_off", 3, 71, 0),
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "event_type",
    [EventType.TIMER_STOP_REQUESTED, EventType.TIMER_RESET_REQUESTED],
)
async def test_stop_or_reset_request_cancels_future_lighting_cues(
    event_type: EventType,
) -> None:
    bus = EventBus()
    backend = FakeOutputBackend()
    plugin = LightsPlugin(
        bus,
        StateStore(),
        lights_settings(LightingCue(at_seconds=1, note=73, velocity=127)),
        backend_factory=lambda: backend,
    )

    await plugin.start()
    await publish_song_start(bus)
    await bus.publish(new_event(event_type, source="test"))
    await asyncio.sleep(0.05)
    await plugin.stop()

    assert backend.ports[0].messages == []


@pytest.mark.asyncio
async def test_restart_cancels_old_timeline_and_starts_exactly_one_new_timeline() -> None:
    bus = EventBus()
    backend = FakeOutputBackend()
    cue = LightingCue(at_seconds=0, note=74, velocity=100)
    plugin = LightsPlugin(
        bus,
        StateStore(),
        lights_settings(cue),
        backend_factory=lambda: backend,
    )

    await plugin.start()
    await publish_song_start(bus)
    await asyncio.sleep(0.03)
    await bus.publish(
        new_event(
            EventType.SONG_RESTARTED,
            source="test",
            payload=SongPayload(song=worship_song(), index=0),
        )
    )
    await bus.publish(
        new_event(
            EventType.TIMER_STARTED,
            source="propresenter",
            payload=TimerPayload(duration_seconds=300),
        )
    )
    await asyncio.sleep(0.03)
    await plugin.stop()

    assert [message[0] for message in backend.ports[0].messages] == [
        "note_on",
        "note_off",
        "note_on",
        "note_off",
    ]


@pytest.mark.asyncio
async def test_cues_after_confirmed_timer_duration_are_not_scheduled() -> None:
    bus = EventBus()
    backend = FakeOutputBackend()
    plugin = LightsPlugin(
        bus,
        StateStore(),
        lights_settings(LightingCue(at_seconds=5, note=75, velocity=127)),
        backend_factory=lambda: backend,
    )

    await plugin.start()
    await publish_song_start(bus, duration=4)
    await asyncio.sleep(0.02)
    await plugin.stop()

    assert backend.ports[0].messages == []
