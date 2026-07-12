"""Runtime configuration with environment-variable overrides."""

from __future__ import annotations

import os
from functools import lru_cache

from pydantic import BaseModel, Field


class Settings(BaseModel):
    """Safe, non-secret Milestone 1 settings."""

    app_name: str = "StagePilot"
    version: str = "0.1.0"
    bind_host: str = "127.0.0.1"
    bind_port: int = Field(default=8765, ge=1, le=65535)
    log_level: str = "INFO"
    demo_mode: bool = True
    recent_event_limit: int = Field(default=100, ge=1, le=1000)
    recent_error_limit: int = Field(default=50, ge=1, le=500)


def _environment_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.casefold() in {"1", "true", "yes", "on"}


@lru_cache
def get_settings() -> Settings:
    """Load application settings from StagePilot environment variables."""

    return Settings(
        bind_host=os.getenv("STAGEPILOT_HOST", "127.0.0.1"),
        bind_port=int(os.getenv("STAGEPILOT_PORT", "8765")),
        log_level=os.getenv("STAGEPILOT_LOG_LEVEL", "INFO").upper(),
        demo_mode=_environment_bool("STAGEPILOT_DEMO_MODE", True),
    )
