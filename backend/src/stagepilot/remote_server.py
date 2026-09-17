"""Opt-in server launcher; tunnel transport runs as an independent service."""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import socket
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from starlette.responses import Response
from starlette.types import ASGIApp, Receive, Scope, Send

from stagepilot.api.remote_ingress import RemoteAccess, RemoteIngress
from stagepilot.services.remote_auth import RemoteStore

logger = logging.getLogger(__name__)
REMOTE_HOST = "127.0.0.1"


class HTTPSOnlyIngress:
    """Transport check, never identity: the connector must overwrite this header."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in {"http", "websocket"}:
            protocols = [v for k, v in scope["headers"] if k.lower() == b"x-forwarded-proto"]
            if protocols != [b"https"]:
                if scope["type"] == "websocket":
                    await send({"type": "websocket.close", "code": 4403})
                else:
                    await Response(status_code=426, headers={"Cache-Control": "no-store"})(
                        scope, receive, send
                    )
                return
        await self.app(scope, receive, send)


class RemoteServer(uvicorn.Server):
    """The owning LAN server alone handles process signals."""

    def __init__(self, config: uvicorn.Config) -> None:
        super().__init__(config)
        self.ready = asyncio.Event()

    async def startup(self, sockets: list[socket.socket] | None = None) -> None:
        try:
            await super().startup(sockets=sockets)
        finally:
            self.ready.set()

    @contextmanager
    def capture_signals(self) -> Iterator[None]:
        yield


async def _serve(server: RemoteServer, listener: socket.socket) -> None:
    try:
        await server.serve(sockets=[listener])
    except (Exception, SystemExit):
        # A transport failure must not take down local production. Never log
        # request headers, credentials, or provider configuration here.
        logger.error("Remote listener stopped unexpectedly; LAN remains available.")
    finally:
        server.ready.set()


@asynccontextmanager
async def remote_listener(ingress: ASGIApp, port: int) -> AsyncIterator[asyncio.Task[None] | None]:
    try:
        listener = socket.create_server((REMOTE_HOST, port))
    except OSError:
        logger.error("Remote loopback port unavailable; LAN remains available.")
        yield None
        return
    with listener:
        server = RemoteServer(
            uvicorn.Config(
                ingress,
                host=REMOTE_HOST,
                port=port,
                lifespan="off",
                workers=1,
                proxy_headers=False,
                access_log=False,
                log_config=None,
                timeout_graceful_shutdown=5,
                ws_max_size=16_384,
                ws_max_queue=4,
            )
        )
        task = asyncio.create_task(_serve(server, listener), name="stagepilot-remote")
        try:
            await server.ready.wait()
            yield task if server.started else None
        finally:
            server.should_exit = True
            await task


def attach_remote_listener(
    application: FastAPI, *, public_origin: str, port: int, require_proxy_https: bool = False
) -> None:
    """Attach before startup, wrapping (not duplicating) the owning lifespan.

    Only loopback HTTP/WebSocket is exposed. A separately managed tunnel must
    terminate public HTTPS/WSS and forward exclusively to this dedicated port.
    """
    if not 1 <= port <= 65535:
        raise ValueError("Remote port must be between 1 and 65535.")
    if getattr(application.state, "remote_listener_attached", False):
        raise ValueError("Remote listener is already attached.")
    ingress: ASGIApp = RemoteIngress(application, public_origin=public_origin)
    if require_proxy_https:
        ingress = HTTPSOnlyIngress(ingress)
    original_lifespan = application.router.lifespan_context

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        async with original_lifespan(app), remote_listener(ingress, port):
            yield

    application.router.lifespan_context = lifespan
    application.state.remote_listener_attached = True


def run() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--public-origin", help="Exact public HTTPS origin, no path")
    source.add_argument("--control-file", type=Path, help="Private managed Remote desired state")
    parser.add_argument(
        "--identity-db", required=True, type=Path, help="Absolute private SQLite path"
    )
    parser.add_argument("--remote-port", type=int, default=8766, help="Dedicated loopback port")
    parser.add_argument("--require-proxy-https", action="store_true")
    args = parser.parse_args()
    if not args.identity_db.is_absolute():
        parser.error("--identity-db must be an absolute private path")

    # Reuse the normal server's single application/runtime. Import only after
    # argument parsing, so --help never constructs production integrations.
    from stagepilot.main import app

    settings = app.state.runtime.settings
    if args.remote_port == settings.bind_port:
        parser.error("--remote-port must differ from the LAN port")
    app.state.remote_access = RemoteAccess(RemoteStore(args.identity_db))
    try:
        if args.control_file:
            from stagepilot.remote_runtime import attach_managed_remote

            attach_managed_remote(app, args.control_file, lan_port=settings.bind_port)
        else:
            attach_remote_listener(
                app,
                public_origin=args.public_origin,
                port=args.remote_port,
                require_proxy_https=args.require_proxy_https,
            )
    except ValueError as exc:
        parser.error(str(exc))
    uvicorn.run(
        app,
        workers=1,
        host=settings.bind_host,
        port=settings.bind_port,
        log_level=settings.log_level.casefold(),
        proxy_headers=True,
        forwarded_allow_ips=os.environ.get("STAGEPILOT_FORWARDED_ALLOW_IPS", "127.0.0.1"),
    )


if __name__ == "__main__":
    run()
