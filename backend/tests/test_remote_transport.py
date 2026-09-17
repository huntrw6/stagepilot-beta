"""Transport provenance is an extra check, never a source of authorization."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from stagepilot.api.remote_ingress import RemoteIngress
from stagepilot.core.config import Settings
from stagepilot.main import create_app
from stagepilot.remote_server import HTTPSOnlyIngress
from stagepilot.services.remote_auth import RemoteStore


def test_transport_https_does_not_replace_remote_identity(tmp_path: Path) -> None:
    app = create_app(Settings(), remote_store=RemoteStore(tmp_path / "identity.sqlite3"))
    ingress = HTTPSOnlyIngress(RemoteIngress(app, public_origin="https://remote.test"))
    with TestClient(ingress) as client:
        for headers in ({}, {"X-Forwarded-Proto": "http"}, {"X-Forwarded-Proto": "https,http"}):
            assert client.get("/api/v1/access", headers=headers).status_code == 426
        response = client.get("/api/v1/access", headers=[("X-Forwarded-Proto", "https")] * 2)
        assert response.status_code == 426
        response = client.get("/api/v1/access", headers={"X-Forwarded-Proto": "https"})
        assert response.json()["authentication"] == "password"
        response = client.get(
            "/api/v1/state", headers={"X-Forwarded-Proto": "https", "Origin": "tauri://localhost"}
        )
        assert response.status_code == 401
        with pytest.raises(WebSocketDisconnect), client.websocket_connect("/ws"):
            pass
