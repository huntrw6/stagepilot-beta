"""Live full-state WebSocket stream."""

from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from stagepilot.core.runtime import Runtime
from stagepilot.models.api import StateEnvelope

router = APIRouter()


@router.websocket("/ws")
async def state_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    runtime: Runtime = websocket.app.state.runtime
    queue = await runtime.state_store.subscribe()
    try:
        initial = await runtime.state_store.snapshot()
        last_revision = initial.revision
        await websocket.send_json(StateEnvelope(data=initial).model_dump(mode="json"))
        while True:
            snapshot = await queue.get()
            if snapshot.revision <= last_revision:
                continue
            last_revision = snapshot.revision
            await websocket.send_json(StateEnvelope(data=snapshot).model_dump(mode="json"))
    except WebSocketDisconnect:
        pass
    finally:
        await runtime.state_store.unsubscribe(queue)
