from __future__ import annotations

import asyncio
import json
import signal
import socket
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
import uvicorn
from fastapi import FastAPI
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, InvalidStatus
from websockets.typing import Origin

from stagepilot.api.remote_ingress import COOKIE_NAME
from stagepilot.core.config import Settings
from stagepilot.main import create_app
from stagepilot.remote_server import RemoteServer, attach_remote_listener
from stagepilot.services.remote_auth import RemoteStore

ORIGIN = Origin("https://remote.stagepilot.test")
PASSWORD = "test-only-password-123"


def unused_port() -> int:
    with socket.create_server(("127.0.0.1", 0)) as listener:
        return int(listener.getsockname()[1])


@asynccontextmanager
async def serve_lan(app: FastAPI) -> AsyncIterator[str]:
    with socket.create_server(("127.0.0.1", 0)) as listener:
        port = listener.getsockname()[1]
        server = RemoteServer(uvicorn.Config(app, lifespan="on", log_config=None, access_log=False))
        task = asyncio.create_task(server.serve(sockets=[listener]))
        try:
            async with asyncio.timeout(10):
                await server.ready.wait()
                assert server.started
            yield f"http://127.0.0.1:{port}"
        finally:
            server.should_exit = True
            await asyncio.wait_for(task, 10)


async def test_real_listeners_share_runtime_auth_and_drain(tmp_path: Path) -> None:
    app = create_app(
        Settings(demo_mode=True),
        dashboard_auth_enforced=True,
        remote_store=RemoteStore(tmp_path / "identity.sqlite3"),
    )
    starts: list[str] = []
    original = app.router.lifespan_context

    @asynccontextmanager
    async def counted(application: FastAPI) -> AsyncIterator[None]:
        async with original(application):
            starts.append("start")
            yield
            starts.append("stop")

    app.router.lifespan_context = counted
    port = unused_port()
    attach_remote_listener(app, public_origin=ORIGIN, port=port)
    handler = signal.getsignal(signal.SIGTERM)
    async with (
        serve_lan(app) as lan_url,
        httpx.AsyncClient(base_url=lan_url, trust_env=False) as lan,
        httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}", trust_env=False) as remote,
    ):
        assert starts == ["start"]
        assert signal.getsignal(signal.SIGTERM) == handler
        assert (await lan.get("/api/v1/state")).status_code == 401
        await lan.post("/api/v1/dashboard-auth/login", json={"pin": "1234"})
        created = await lan.post(
            "/api/v1/remote-auth/users",
            json={"email": "operator@example.com", "password": PASSWORD, "role": "Operator"},
        )
        assert created.status_code == 201
        assert (await lan.get("/api/v1/access")).json()["mode"] == "lan"
        assert (await remote.get("/api/v1/access")).json()["mode"] == "remote"
        forged = {
            "Origin": "tauri://localhost",
            "X-Forwarded-For": "127.0.0.1",
            "X-Forwarded-Proto": "https",
            "Cookie": "; ".join(f"{k}={v}" for k, v in lan.cookies.items()),
        }
        assert (await remote.get("/api/v1/state", headers=forged)).status_code == 401
        with pytest.raises(InvalidStatus):
            async with connect(f"ws://127.0.0.1:{port}/ws", origin=ORIGIN, proxy=None):
                pytest.fail("Anonymous WebSocket accepted")
        response = await remote.post(
            "/api/v1/remote-auth/login",
            json={"email": "operator@example.com", "password": PASSWORD},
            headers={"Origin": ORIGIN, "X-StagePilot-Remote": "1"},
        )
        assert response.status_code == 200
        assert "Secure" in response.headers["set-cookie"]
        # Simulate the HTTPS terminator forwarding the browser's secure cookie;
        # httpx correctly refuses to send it automatically over loopback HTTP.
        assert (await remote.get("/api/v1/state")).status_code == 401
        cookie = f"{COOKIE_NAME}={response.cookies.get(COOKIE_NAME)}"
        headers = {
            "Cookie": cookie,
            "Origin": ORIGIN,
            "X-CSRF-Token": response.json()["csrf_token"],
        }
        action = await remote.post("/api/v1/actions/start_next", headers=headers)
        assert action.status_code == 200
        local_state = (await lan.get("/api/v1/state")).json()
        assert local_state["timer"]["status"] == "running"
        websocket = await connect(
            f"ws://127.0.0.1:{port}/ws",
            origin=ORIGIN,
            additional_headers={"Cookie": cookie},
            proxy=None,
        )
        snapshot = json.loads(await asyncio.wait_for(websocket.recv(), 5))
        assert snapshot["type"] == "state.snapshot"
        # Reconnecting the transport doesn't restart production.
        await websocket.close()
        websocket = await connect(
            f"ws://127.0.0.1:{port}/ws",
            origin=ORIGIN,
            additional_headers={"Cookie": cookie},
            proxy=None,
        )
        await asyncio.wait_for(websocket.recv(), 5)
        assert starts == ["start"]
    assert starts == ["start", "stop"]
    with pytest.raises(ConnectionClosed):
        await asyncio.wait_for(websocket.recv(), 5)
    await websocket.close()
    with socket.create_server(("127.0.0.1", port)):
        pass  # Remote socket is released after graceful shutdown.


async def test_remote_port_conflict_keeps_lan_alive(tmp_path: Path) -> None:
    app = create_app(Settings(), remote_store=RemoteStore(tmp_path / "identity.sqlite3"))
    with socket.create_server(("127.0.0.1", 0)) as occupied:
        attach_remote_listener(app, public_origin=ORIGIN, port=occupied.getsockname()[1])
        async with serve_lan(app) as url, httpx.AsyncClient(trust_env=False) as client:
            assert (await client.get(url + "/api/v1/state")).status_code == 200


async def test_unavailable_identity_store_keeps_lan_alive(tmp_path: Path) -> None:
    app = create_app(Settings(), remote_store=RemoteStore(tmp_path))
    port = unused_port()
    attach_remote_listener(app, public_origin=ORIGIN, port=port)
    async with serve_lan(app) as url, httpx.AsyncClient(trust_env=False) as client:
        response = await client.post(
            f"http://127.0.0.1:{port}/api/v1/remote-auth/login",
            json={"email": "operator@example.com", "password": PASSWORD},
            headers={"Origin": ORIGIN, "X-StagePilot-Remote": "1"},
        )
        assert response.status_code == 503
        assert (await client.get(url + "/api/v1/state")).status_code == 200


@pytest.mark.parametrize(
    "origin,port", [("http://remote.test", 8766), (ORIGIN + "/path", 8766), (ORIGIN, 0)]
)
def test_invalid_listener_configuration(tmp_path: Path, origin: str, port: int) -> None:
    app = create_app(Settings(), remote_store=RemoteStore(tmp_path / "identity.sqlite3"))
    with pytest.raises(ValueError):
        attach_remote_listener(app, public_origin=origin, port=port)
    assert not getattr(app.state, "remote_listener_attached", False)


def test_listener_is_opt_in_and_cannot_attach_twice(tmp_path: Path) -> None:
    app = create_app(Settings(), remote_store=RemoteStore(tmp_path / "identity.sqlite3"))
    assert not getattr(app.state, "remote_listener_attached", False)
    attach_remote_listener(app, public_origin=ORIGIN, port=unused_port())
    with pytest.raises(ValueError, match="already attached"):
        attach_remote_listener(app, public_origin=ORIGIN, port=unused_port())
