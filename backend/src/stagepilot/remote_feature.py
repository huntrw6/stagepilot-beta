"""Product intent/status for the existing independent Remote service.

No account credentials, provider APIs or production lifecycle operations here.
The supervisor alone publishes the trusted listener origin. Files are private.
"""

from __future__ import annotations

import json
import os
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field

from stagepilot.remote_files import DesiredRemote, atomic_write, read_desired


class RemoteIntent(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    enabled: bool = False
    generation: str = ""
    requested_at: float = 0.0
    port: int = Field(default=8766, ge=1024, le=65535)


class RemoteFeature:
    def __init__(self, control: Path, port: int = 8766) -> None:
        self.control = control
        self.intent_path = control.with_name("access-request.json")
        self.status_path = control.with_name("access-status.json")
        self.port = port

    @contextmanager
    def locked(self) -> Iterator[None]:
        # This is the installed Linux service path, not a desktop dependency.
        import fcntl

        self.control.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(self.control.with_name("access.lock"), os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            os.close(fd)

    def intent(self) -> RemoteIntent:
        try:
            if self.intent_path.stat().st_size > 4096:
                return RemoteIntent()
            return RemoteIntent.model_validate_json(self.intent_path.read_text())
        except (OSError, ValueError):
            return RemoteIntent()

    def set_enabled(self, enabled: bool) -> None:
        with self.locked():
            current = self.intent()
            if enabled and current.enabled:
                return  # Lost-response retries do not create another tunnel/session epoch.
            if enabled:
                # Do not adopt/replace externally managed named or manually enabled routes.
                existing = read_desired(self.control)
                if existing.enabled:
                    raise ValueError("Remote is already managed elsewhere")
            else:
                existing = read_desired(self.control)
                # Preserve the non-secret stable-origin marker used by the
                # external named-tunnel control plane.
                marker = (
                    DesiredRemote(public_origin=existing.public_origin, port=existing.port)
                    if existing.public_origin
                    else DesiredRemote()
                )
                atomic_write(self.control, marker.model_dump_json())
            atomic_write(
                self.intent_path,
                RemoteIntent(
                    enabled=enabled,
                    generation=str(uuid4()),
                    requested_at=time.time(),
                    port=self.port,
                ).model_dump_json(),
            )

    def set_managed_enabled(self, enabled: bool, generation: str = "") -> None:
        """Persist named-Remote intent using the control-plane generation."""

        if enabled:
            UUID(generation)
        with self.locked():
            existing = read_desired(self.control)
            if not enabled:
                marker = (
                    DesiredRemote(public_origin=existing.public_origin, port=existing.port)
                    if existing.public_origin
                    else DesiredRemote()
                )
                atomic_write(self.control, marker.model_dump_json())
            atomic_write(
                self.intent_path,
                RemoteIntent(
                    enabled=enabled,
                    generation=generation if enabled else str(uuid4()),
                    requested_at=time.time(),
                    port=existing.port,
                ).model_dump_json(),
            )

    def status(self) -> dict[str, Any]:
        intent = self.intent()
        try:
            if self.status_path.stat().st_size > 4096:
                raise ValueError("Invalid status")
            status = json.loads(self.status_path.read_text())
            fresh = 0 <= time.time() - float(status.get("checked_at", 0)) < 10
        except (OSError, ValueError, TypeError, AttributeError):
            status, fresh = {}, False
        available = fresh and status.get("available") is True
        state = "off"
        url = None
        message = None
        if intent.enabled:
            state = "enabling"
            if not fresh or status.get("generation") != intent.generation:
                if time.time() - intent.requested_at > 15:
                    state = "error"
            else:
                state = status.get("state", "error")
                if state not in {"enabling", "connected", "reconnecting", "error"}:
                    state = "error"
                candidate = status.get("url")
                if state == "connected" and isinstance(candidate, str):
                    # Validate syntax without exposing arbitrary text from service output.
                    from urllib.parse import urlsplit

                    parsed = urlsplit(candidate)
                    if (
                        parsed.scheme == "https"
                        and parsed.hostname
                        and not parsed.username
                        and not parsed.password
                        and not parsed.path
                        and not parsed.query
                        and not parsed.fragment
                        and not parsed.port
                    ):
                        url = candidate
                    else:
                        state = "error"
                if state == "connected" and url is None:
                    state = "error"
            if state == "error":
                message = "Remote connection is unavailable. Check your connection or try again."
            elif state == "reconnecting":
                message = "Reconnecting Remote Access. Local StagePilot is unaffected."
        elif not available:
            message = (
                "Remote Access is unavailable on this installation. Local StagePilot is unaffected."
            )
        return {
            "available": available,
            "enabled": intent.enabled,
            "state": state,
            "url": url,
            "message": message,
            "temporary_url": status.get("temporary_url") is not False,
        }
