from __future__ import annotations

import asyncio
import json
import socket
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed
from websockets.typing import Origin

from stagepilot.api.remote_ingress import COOKIE_NAME
from stagepilot.core.config import Settings
from stagepilot.main import create_app
from stagepilot.remote_files import DesiredRemote, atomic_write
from stagepilot.remote_runtime import attach_managed_remote
from stagepilot.services.remote_auth import RemoteRole, RemoteStore
from test_remote_server import serve_lan, unused_port

ORIGIN = "https://managed.stagepilot.test"
PASSWORD = "test-only-managed-password"


async def wait_listener(client: httpx.AsyncClient, enabled: bool) -> None:
    async with asyncio.timeout(8):
        for _ in range(160):
            try:
                response = await client.get("/api/v1/access")
                if enabled and response.status_code == 200:
                    return
            except httpx.TransportError:
                if not enabled:
                    return
            await asyncio.sleep(0.05)
    pytest.fail("Listener did not reach requested state")


async def test_live_enable_disable_reenable_and_restart_persistence(tmp_path: Path) -> None:
    control = tmp_path / "remote.json"
    store = RemoteStore(tmp_path / "identity.sqlite3")
    store.create_user("operator@test.invalid", PASSWORD, RemoteRole.OPERATOR)
    port = unused_port()
    desired = DesiredRemote(enabled=True, generation=str(uuid4()), public_origin=ORIGIN, port=port)
    application = create_app(Settings(demo_mode=True), remote_store=store)
    runtime = application.state.runtime
    attach_managed_remote(application, control, lan_port=8765)
    headers = {"X-Forwarded-Proto": "https", "Origin": ORIGIN}
    async with (
        serve_lan(application) as lan_url,
        httpx.AsyncClient(base_url=lan_url, trust_env=False) as lan,
        httpx.AsyncClient(
            base_url=f"http://127.0.0.1:{port}", headers=headers, trust_env=False
        ) as remote,
    ):
        await wait_listener(remote, False)
        atomic_write(control, desired.model_dump_json())
        await wait_listener(remote, True)
        login = await remote.post(
            "/api/v1/remote-auth/login",
            json={"email": "operator@test.invalid", "password": PASSWORD},
            headers={"X-StagePilot-Remote": "1"},
        )
        assert login.status_code == 200
        cookie = f"{COOKIE_NAME}={login.cookies.get(COOKIE_NAME)}"
        remote.headers["Cookie"] = cookie
        remote.headers["X-CSRF-Token"] = login.json()["csrf_token"]
        assert (await remote.post("/api/v1/actions/start_next")).status_code == 200
        websocket = await connect(
            f"ws://127.0.0.1:{port}/ws",
            origin=Origin(ORIGIN),
            proxy=None,
            additional_headers={"X-Forwarded-Proto": "https", "Cookie": cookie},
        )
        assert json.loads(await websocket.recv())["type"] == "state.snapshot"
        atomic_write(control, DesiredRemote().model_dump_json())
        await wait_listener(remote, False)
        async with asyncio.timeout(5):
            with pytest.raises(ConnectionClosed):
                while True:
                    await websocket.recv()
        await websocket.close()
        assert application.state.runtime is runtime
        assert (await lan.get("/api/v1/state")).json()["timer"]["status"] == "running"
        desired.generation = str(uuid4())
        atomic_write(control, desired.model_dump_json())
        await wait_listener(remote, True)
        assert (await remote.get("/api/v1/state")).status_code == 401
        assert application.state.runtime is runtime
        # Corrupt desired state closes Remote but not LAN; recovery is automatic.
        atomic_write(control, "not-json")
        await wait_listener(remote, False)
        assert (await lan.get("/api/v1/state")).status_code == 200
        atomic_write(control, desired.model_dump_json())
        await wait_listener(remote, True)
        login = await remote.post(
            "/api/v1/remote-auth/login",
            json={"email": "operator@test.invalid", "password": PASSWORD},
            headers={"X-StagePilot-Remote": "1"},
        )
        assert login.status_code == 200
        persistent_cookie = f"{COOKIE_NAME}={login.cookies.get(COOKIE_NAME)}"
    # Fresh process-equivalent app/store recovers desired state and existing sessions.
    restarted = create_app(Settings(), remote_store=RemoteStore(store.path))
    attach_managed_remote(restarted, control, lan_port=8765)
    async with (
        serve_lan(restarted),
        httpx.AsyncClient(
            base_url=f"http://127.0.0.1:{port}",
            trust_env=False,
            headers={**headers, "Cookie": persistent_cookie},
        ) as remote,
    ):
        await wait_listener(remote, True)
        assert (await remote.get("/api/v1/state")).status_code == 200


async def test_bind_conflict_retry_and_invalid_policy_leave_lan_alive(tmp_path: Path) -> None:
    control = tmp_path / "remote.json"
    application = create_app(Settings(), remote_store=RemoteStore(tmp_path / "identity.sqlite3"))
    attach_managed_remote(application, control, lan_port=8765)
    occupied = socket.create_server(("127.0.0.1", 0))
    port = occupied.getsockname()[1]
    desired = DesiredRemote(enabled=True, generation=str(uuid4()), public_origin=ORIGIN, port=port)
    atomic_write(control, desired.model_dump_json())
    try:
        async with serve_lan(application) as url, httpx.AsyncClient(trust_env=False) as lan:
            await asyncio.sleep(0.2)
            assert (await lan.get(url + "/api/v1/state")).status_code == 200
            occupied.close()
            async with httpx.AsyncClient(
                base_url=f"http://127.0.0.1:{port}",
                trust_env=False,
                headers={"X-Forwarded-Proto": "https"},
            ) as remote:
                await wait_listener(remote, True)
                desired.port = 8765
                atomic_write(control, desired.model_dump_json())
                await wait_listener(remote, False)
                assert (await lan.get(url + "/api/v1/state")).status_code == 200
    finally:
        occupied.close()
