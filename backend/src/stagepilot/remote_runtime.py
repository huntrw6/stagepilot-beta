"""Reconcile the local Remote listener without restarting production."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from uuid import UUID

from fastapi import FastAPI

from stagepilot.api.remote_ingress import RemoteAccess, RemoteIngress
from stagepilot.remote_files import read_desired
from stagepilot.remote_server import HTTPSOnlyIngress, remote_listener
from stagepilot.services.remote_auth import RemoteAuthError

logger = logging.getLogger(__name__)


async def pause(stop: asyncio.Event, seconds: float = 0.25) -> None:
    with suppress(TimeoutError):
        await asyncio.wait_for(stop.wait(), seconds)


async def reconcile(application: FastAPI, path: Path, lan_port: int, stop: asyncio.Event) -> None:
    access: RemoteAccess = application.state.remote_access
    while not stop.is_set():
        try:
            desired = await asyncio.to_thread(read_desired, path)
            if desired.enabled:
                UUID(desired.generation)
                if desired.port == lan_port:
                    raise ValueError("Remote cannot bind the LAN port")
                ingress = HTTPSOnlyIngress(
                    RemoteIngress(application, public_origin=desired.public_origin)
                )
                await access.call(access.store.installation_generation, desired.generation)
                async with remote_listener(ingress, desired.port) as task:
                    while task is not None and not task.done() and not stop.is_set():
                        current = await asyncio.to_thread(read_desired, path)
                        if current != desired:
                            break
                        await pause(stop)
        except (OSError, ValueError, RemoteAuthError):
            logger.error("Managed Remote unavailable; local production continues.")
        await pause(stop, 1)


def attach_managed_remote(application: FastAPI, path: Path, *, lan_port: int) -> None:
    if not path.is_absolute():
        raise ValueError("Remote control file must be absolute")
    if getattr(application.state, "remote_listener_attached", False):
        raise ValueError("Remote listener is already attached")
    if not isinstance(getattr(application.state, "remote_access", None), RemoteAccess):
        raise ValueError("A Remote identity store is required")
    original = application.router.lifespan_context
    from stagepilot.remote_feature import RemoteFeature

    application.state.remote_feature = RemoteFeature(path)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        async with original(app):
            stop = asyncio.Event()
            task = asyncio.create_task(reconcile(app, path, lan_port, stop))
            try:
                yield
            finally:
                stop.set()
                await task

    application.router.lifespan_context = lifespan
    application.state.remote_listener_attached = True
