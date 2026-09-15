from __future__ import annotations

import asyncio
from pathlib import Path

import httpx
import pytest

from stagepilot.api.remote_ingress import COOKIE_NAME
from stagepilot.core.config import Settings
from stagepilot.main import create_app
from stagepilot.remote_files import DesiredRemote, read_desired
from stagepilot.remote_runtime import attach_managed_remote
from stagepilot.services.remote_auth import RemoteRole, RemoteStore
from test_remote_control import setup_control
from test_remote_runtime import wait_listener
from test_remote_server import serve_lan, unused_port


async def test_provider_control_export_drives_real_listener(tmp_path: Path) -> None:
    control, fake = setup_control(tmp_path)
    control.config.remote_port = unused_port()
    store = RemoteStore(tmp_path / "backend/identity.sqlite3")
    store.create_user("operator@test.invalid", "test-lifecycle-password", RemoteRole.OPERATOR)
    app = create_app(Settings(demo_mode=True), remote_store=store)
    attach_managed_remote(app, control.desired_path, lan_port=8765)
    async with (
        serve_lan(app) as url,
        httpx.AsyncClient(base_url=url, trust_env=False) as lan,
        httpx.AsyncClient(
            base_url=f"http://127.0.0.1:{control.config.remote_port}",
            trust_env=False,
            headers={"X-Forwarded-Proto": "https", "Origin": "https://remote.example.com"},
        ) as remote,
    ):
        first = await asyncio.to_thread(control.apply, "enable")
        await wait_listener(remote, True)
        response = await remote.post(
            "/api/v1/remote-auth/login",
            json={"email": "operator@test.invalid", "password": "test-lifecycle-password"},
            headers={"X-StagePilot-Remote": "1"},
        )
        assert response.status_code == 200
        remote.headers["Cookie"] = f"{COOKIE_NAME}={response.cookies.get(COOKIE_NAME)}"
        remote.headers["X-CSRF-Token"] = response.json()["csrf_token"]
        assert (await remote.post("/api/v1/actions/start_next")).status_code == 200
        assert await asyncio.to_thread(control.apply, "enable") == first
        assert fake.created == 1
        await asyncio.to_thread(control.apply, "disable")
        await wait_listener(remote, False)
        assert not fake.tunnels and not fake.records
        assert (await lan.get("/api/v1/state")).json()["timer"]["status"] == "running"
        second = await asyncio.to_thread(control.apply, "enable")
        await wait_listener(remote, True)
        assert second["tunnel_id"] != first["tunnel_id"]
        assert (await remote.get("/api/v1/state")).status_code == 401
        await asyncio.to_thread(control.apply, "disable")


def test_corrupt_control_state_can_still_disable_local_access(tmp_path: Path) -> None:
    control, fake = setup_control(tmp_path)
    control.apply("enable")
    control.state_path.write_text("corrupt")
    with pytest.raises(ValueError):
        control.apply("disable")
    assert not read_desired(control.desired_path).enabled
    assert not control.token_path.exists()
    assert fake.tunnels  # Cannot claim provider revocation without recoverable identity.


@pytest.mark.parametrize("update", [{"generation": "bad"}, {"public_origin": "http://bad.test"}])
def test_invalid_enabled_policy_fails_validation(update: dict[str, str]) -> None:
    with pytest.raises(ValueError):
        DesiredRemote.model_validate({"enabled": True, **update})
