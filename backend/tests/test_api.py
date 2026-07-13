from __future__ import annotations

from fastapi.testclient import TestClient

from stagepilot.core.config import PlanningCenterSettings, Settings
from stagepilot.main import create_app


def test_health_state_and_action_endpoints() -> None:
    app = create_app(Settings(demo_mode=True))

    with TestClient(app) as client:
        health = client.get("/api/v1/health")
        state = client.get("/api/v1/state")
        action = client.post("/api/v1/actions/start_next")

    assert health.status_code == 200
    assert health.json()["status"] == "healthy"
    assert state.status_code == 200
    assert len(state.json()["plan"]["songs"]) == 4
    assert action.status_code == 200
    assert action.json()["accepted"] is True
    assert action.json()["state"]["current_song"]["title"] == "Battle Belongs"
    assert action.json()["state"]["timer"]["status"] == "running"


def test_unknown_action_is_rejected_by_validation() -> None:
    app = create_app(Settings(demo_mode=True))

    with TestClient(app) as client:
        response = client.post("/api/v1/actions/not-an-action")

    assert response.status_code == 422


def test_planning_center_credentials_are_absent_from_public_responses() -> None:
    app = create_app(
        Settings(
            demo_mode=True,
            planning_center=PlanningCenterSettings(
                app_id="private-app-id",
                secret="private-secret",
            ),
        )
    )

    with TestClient(app) as client:
        public_text = "\n".join(
            [
                client.get("/api/v1/health").text,
                client.get("/api/v1/state").text,
            ]
        )

    assert "private-app-id" not in public_text
    assert "private-secret" not in public_text


def test_websocket_sends_initial_and_updated_full_state() -> None:
    app = create_app(Settings(demo_mode=True))

    with TestClient(app) as client, client.websocket_connect("/ws") as websocket:
        initial = websocket.receive_json()
        client.post("/api/v1/actions/start_next")
        updated = websocket.receive_json()
        while updated["data"]["current_song"] is None:
            updated = websocket.receive_json()

    assert initial["type"] == "state.snapshot"
    assert initial["data"]["plan"]["title"] == "Sunday Worship — Demo"
    assert updated["type"] == "state.snapshot"
    assert updated["data"]["current_song"]["title"] == "Battle Belongs"
