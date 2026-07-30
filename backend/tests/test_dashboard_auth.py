from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from stagepilot.api.dashboard_auth import COOKIE_NAME
from stagepilot.core.config import Settings
from stagepilot.main import create_app


def client() -> TestClient:
    return TestClient(
        create_app(Settings(), dashboard_auth_enforced=True),
        base_url="http://stagepilot.local",
    )


def test_browser_api_requires_default_pin_and_uses_session_cookie() -> None:
    with client() as browser:
        status = browser.get("/api/v1/dashboard-auth/status")
        assert status.json() == {"required": True, "authenticated": False}
        assert browser.get("/api/v1/state").status_code == 401
        assert (
            browser.post(
                "/api/v1/dashboard-auth/login",
                json={"pin": "9999"},
            ).status_code
            == 401
        )

        login = browser.post("/api/v1/dashboard-auth/login", json={"pin": "1234"})
        assert login.status_code == 200
        assert login.json()["authenticated"] is True
        assert "httponly" in login.headers["set-cookie"].casefold()
        assert browser.get("/api/v1/state").status_code == 200


def test_desktop_origin_bypasses_browser_pin() -> None:
    with client() as browser:
        response = browser.get(
            "/api/v1/state",
            headers={"Origin": "tauri://localhost"},
        )
        assert response.status_code == 200


def test_pin_can_be_replaced_and_protection_disabled() -> None:
    with client() as browser:
        browser.post("/api/v1/dashboard-auth/login", json={"pin": "1234"})
        updated = browser.post(
            "/api/v1/dashboard-auth/settings",
            json={"enabled": True, "pin": "8642"},
        )
        assert updated.status_code == 200
        assert "web_dashboard_pin_hash" not in updated.text
        assert browser.get("/api/v1/state").status_code == 401
        assert (
            browser.post(
                "/api/v1/dashboard-auth/login",
                json={"pin": "1234"},
            ).status_code
            == 401
        )
        assert (
            browser.post(
                "/api/v1/dashboard-auth/login",
                json={"pin": "8642"},
            ).status_code
            == 200
        )

        disabled = browser.post(
            "/api/v1/dashboard-auth/settings",
            json={"enabled": False},
        )
        assert disabled.status_code == 200
        assert browser.get("/api/v1/state").status_code == 200


def test_websocket_requires_the_same_authenticated_browser_session() -> None:
    with client() as browser:
        with (
            pytest.raises(WebSocketDisconnect) as rejected,
            browser.websocket_connect("/ws") as websocket,
        ):
            websocket.receive_json()
        assert rejected.value.code == 4401

        browser.post("/api/v1/dashboard-auth/login", json={"pin": "1234"})
        cookie = browser.cookies.get(COOKIE_NAME)
        with browser.websocket_connect(
            "/ws",
            headers={"cookie": f"{COOKIE_NAME}={cookie}"},
        ) as websocket:
            envelope = websocket.receive_json()
            assert envelope["type"] == "state.snapshot"
