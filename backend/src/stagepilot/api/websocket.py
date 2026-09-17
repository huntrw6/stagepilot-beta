"""Live full-state WebSocket stream."""

from __future__ import annotations

import asyncio
from contextlib import suppress

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from stagepilot.api.remote_ingress import remote_context
from stagepilot.core.runtime import Runtime
from stagepilot.models.api import StateEnvelope
from stagepilot.services.remote_auth import RemoteAuthError

router = APIRouter()


@router.websocket("/ws")
async def state_stream(websocket: WebSocket) -> None:
    context = remote_context(websocket.scope)

    async def remote_valid() -> bool:
        if context is None:
            return True
        try:
            current = await context.access.call(context.access.store.session, context.token)
        except RemoteAuthError:
            await websocket.close(code=4503, reason="Remote storage unavailable")
            return False
        if current is None:
            await websocket.close(code=4401, reason="Remote session expired or revoked")
            return False
        return True

    await websocket.accept()
    runtime: Runtime = websocket.app.state.runtime
    remote_receive = asyncio.create_task(websocket.receive()) if context is not None else None
    queue = await runtime.state_store.subscribe()
    try:
        if not await remote_valid():
            return
        initial = await runtime.state_store.snapshot()
        last_revision = initial.revision
        await websocket.send_json(StateEnvelope(data=initial).model_dump(mode="json"))
        while True:
            if context is None:
                snapshot = await queue.get()
            else:
                if remote_receive is not None and remote_receive.done():
                    message = remote_receive.result()
                    if message["type"] != "websocket.disconnect":
                        await websocket.close(code=4403, reason="State stream is receive-only")
                    return
                if not await remote_valid():
                    return
                try:
                    snapshot = await asyncio.wait_for(queue.get(), timeout=1.0)
                except TimeoutError:
                    continue
                if not await remote_valid():
                    return
            if snapshot.revision <= last_revision:
                continue
            last_revision = snapshot.revision
            await websocket.send_json(StateEnvelope(data=snapshot).model_dump(mode="json"))
    except WebSocketDisconnect:
        pass
    finally:
        if remote_receive is not None:
            remote_receive.cancel()
            with suppress(asyncio.CancelledError):
                await remote_receive
        await runtime.state_store.unsubscribe(queue)
