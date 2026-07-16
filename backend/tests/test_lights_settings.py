from __future__ import annotations

from pathlib import Path

from stagepilot.core.config import LightingCue, LightsSettings, SongLightingCueMap
from stagepilot.core.settings import (
    MemoryCredentialStore,
    PersistentSettings,
    SettingsFileStore,
    SettingsService,
)


def configured_lights() -> LightsSettings:
    return LightsSettings(
        enabled=True,
        output_name="StagePilot to Lightkey",
        channel=4,
        pulse_ms=125,
        cue_maps={
            "song-1": SongLightingCueMap(
                song_key="song-1",
                song_title="Holy Forever",
                cues=[
                    LightingCue(
                        at_seconds=65,
                        note=72,
                        velocity=110,
                        label="First chorus",
                    )
                ],
            )
        },
    )


def test_lights_output_and_song_cues_survive_settings_service_restart(tmp_path: Path) -> None:
    store = SettingsFileStore(tmp_path / "StagePilot" / "settings.json")
    first = SettingsService(store, MemoryCredentialStore(), environ={})
    first.load()
    first.save(PersistentSettings(lights=configured_lights()))

    restarted = SettingsService(store, MemoryCredentialStore(), environ={})
    runtime = restarted.load()

    assert runtime.lights.enabled is True
    assert runtime.lights.output_name == "StagePilot to Lightkey"
    assert runtime.lights.channel == 4
    assert runtime.lights.pulse_ms == 125
    cue = runtime.lights.cue_maps["song-1"].cues[0]
    assert cue.at_seconds == 65
    assert cue.note == 72
    assert cue.label == "First chorus"


def test_lights_environment_values_override_saved_output_settings(tmp_path: Path) -> None:
    store = SettingsFileStore(tmp_path / "settings.json")
    store.save(PersistentSettings(lights=configured_lights()))
    service = SettingsService(
        store,
        MemoryCredentialStore(),
        environ={
            "STAGEPILOT_LIGHTS_ENABLED": "true",
            "STAGEPILOT_LIGHTS_OUTPUT_NAME": "Rehearsal Lightkey",
            "STAGEPILOT_LIGHTS_CHANNEL": "7",
            "STAGEPILOT_LIGHTS_PULSE_MS": "250",
        },
    )

    runtime = service.load()

    assert runtime.lights.output_name == "Rehearsal Lightkey"
    assert runtime.lights.channel == 7
    assert runtime.lights.pulse_ms == 250
    assert "song-1" in runtime.lights.cue_maps
