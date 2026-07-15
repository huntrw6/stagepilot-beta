"""Runtime contracts and observable snapshots for the ProPresenter integration."""

from __future__ import annotations

from datetime import datetime
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field

from stagepilot.core.config import ProPresenterSettings
from stagepilot.models.state import ConnectionStatus


class ProPresenterTimerSummary(BaseModel):
    """Safe timer metadata exposed to the dashboard."""

    model_config = ConfigDict(frozen=True)

    id: str = Field(min_length=1, max_length=256)
    name: str = Field(min_length=1, max_length=255)
    index: int = Field(ge=0)
    is_countdown: bool
    state: str | None = None


class ProPresenterSnapshot(BaseModel):
    """Current session configuration and discovery state."""

    model_config = ConfigDict(frozen=True)

    enabled: bool
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(ge=1, le=65535)
    timer_name: str = Field(min_length=1, max_length=255)
    request_timeout_seconds: float = Field(gt=0, le=60.0)
    connection_status: ConnectionStatus
    detail: str | None = None
    timers: list[ProPresenterTimerSummary] = Field(default_factory=list)
    selected_timer_id: str | None = None
    timer_found: bool = False
    last_checked_at: datetime | None = None


class ProPresenterController(Protocol):
    """Operations used by the REST layer without depending on plugin internals."""

    async def snapshot(self, *, refresh: bool = False) -> ProPresenterSnapshot: ...

    async def test_connection(self) -> ProPresenterSnapshot: ...

    async def refresh_timers(self) -> ProPresenterSnapshot: ...

    async def reconfigure(self, settings: ProPresenterSettings) -> ProPresenterSnapshot: ...
