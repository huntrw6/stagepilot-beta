from __future__ import annotations

from dataclasses import dataclass, field

from fastapi.testclient import TestClient

from stagepilot.core.config import Settings
from stagepilot.main import create_app


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
    ports: list[FakeOutputPort] = field(default_factory=list)

    def list_output_names(self) -> list[str]:
        return ["StagePilot to Lightkey"]

    def open_output(self, name: str) -> FakeOutputPort:
        assert name == "StagePilot to Lightkey"
        port = FakeOutputPort()
        self.ports.append(port)
        return port


def test_lights_settings_test_pulse_and_cue_map_persist_through_api() -> None:
    backend = FakeOutputBackend()
    app = create_app(Settings(), lights_backend_factory=lambda: backend)

    with TestClient(app) as client:
        initial = client.get("/api/v1/lights")
        configured = client.post(
            "/api/v1/lights/settings",
            json={
                "enabled": True,
                "output_name": "StagePilot to Lightkey",
                "channel": 4,
                "pulse_ms": 10,
            },
        )
        tested = client.post("/api/v1/lights/test", json={"note": 76, "velocity": 115})
        saved = client.put(
            "/api/v1/lights/cue-map",
            json={
                "song_key": "song-1",
                "song_title": "Holy Forever",
                "cues": [
                    {
                        "id": "c17d19ab-1447-4e73-898e-468b2dfa87c7",
                        "at_seconds": 65,
                        "note": 77,
                        "velocity": 120,
                        "label": "First chorus",
                    }
                ],
            },
        )
        settings = client.get("/api/v1/settings")

    assert initial.status_code == 200
    assert initial.json()["outputs"][0]["name"] == "StagePilot to Lightkey"
    assert configured.status_code == 200
    assert configured.json()["accepted"] is True
    assert configured.json()["lights"]["connection_status"] == "connected"
    assert tested.status_code == 200
    assert tested.json()["accepted"] is True
    assert backend.ports[0].messages == [
        ("note_on", 4, 76, 115),
        ("note_off", 4, 76, 0),
    ]
    assert saved.status_code == 200
    cue_map = settings.json()["settings"]["lights"]["cue_maps"]["song-1"]
    assert cue_map["song_title"] == "Holy Forever"
    assert cue_map["cues"][0]["at_seconds"] == 65

