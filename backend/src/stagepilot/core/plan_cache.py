"""Validated, non-secret last-known-good Planning Center service cache."""

from __future__ import annotations

import json
import os
from collections.abc import Mapping
from contextlib import suppress
from datetime import datetime
from pathlib import Path
from typing import Literal, Protocol
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, field_validator

from stagepilot.core.settings import default_settings_path
from stagepilot.models.state import ServicePlan


class PlanCacheError(RuntimeError):
    """The cached service plan could not be read or safely replaced."""


class CachedServicePlan(BaseModel):
    """Versioned projection containing only non-secret service data."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    plan: ServicePlan
    last_successful_refresh: datetime

    @field_validator("last_successful_refresh")
    @classmethod
    def refresh_timestamp_has_offset(cls, value: datetime) -> datetime:
        if value.utcoffset() is None:
            raise ValueError("The cached refresh timestamp must include an offset.")
        return value


class PlanCacheStore(Protocol):
    def load(self) -> CachedServicePlan | None: ...

    def save(self, cached: CachedServicePlan) -> None: ...


class FilePlanCacheStore:
    """Atomically persist one validated cached service plan."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def load(self) -> CachedServicePlan | None:
        if not self.path.exists():
            return None
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
            return CachedServicePlan.model_validate(payload)
        except (OSError, ValueError, TypeError) as exc:
            raise PlanCacheError(
                "The last-known-good service cache is corrupt or invalid."
            ) from exc

    def save(self, cached: CachedServicePlan) -> None:
        temporary = self.path.with_name(f".{self.path.name}.{uuid4().hex}.tmp")
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with temporary.open("x", encoding="utf-8", newline="\n") as handle:
                handle.write(cached.model_dump_json(indent=2))
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
        except OSError as exc:
            with suppress(OSError):
                temporary.unlink(missing_ok=True)
            raise PlanCacheError(
                "The last-known-good service cache could not be saved atomically."
            ) from exc


class MemoryPlanCacheStore:
    """In-memory cache used for explicitly configured application instances."""

    def __init__(self, cached: CachedServicePlan | None = None) -> None:
        self.cached = cached.model_copy(deep=True) if cached is not None else None

    def load(self) -> CachedServicePlan | None:
        return self.cached.model_copy(deep=True) if self.cached is not None else None

    def save(self, cached: CachedServicePlan) -> None:
        self.cached = cached.model_copy(deep=True)


def default_plan_cache_path(environ: Mapping[str, str] | None = None) -> Path:
    values = os.environ if environ is None else environ
    override = values.get("STAGEPILOT_PLAN_CACHE_PATH")
    if override:
        return Path(override).expanduser()
    return default_settings_path(values).with_name("last-known-good-service.json")
