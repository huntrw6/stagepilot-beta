"""Runtime configuration with environment-variable overrides."""

from __future__ import annotations

import os
from functools import lru_cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator


class PlanningCenterSettings(BaseModel):
    """Validated server-side settings for Planning Center Personal Access Tokens."""

    model_config = ConfigDict(hide_input_in_errors=True)

    app_id: SecretStr | None = None
    secret: SecretStr | None = None
    service_type_id: str | None = Field(default=None, min_length=1)
    request_timeout_seconds: float = Field(default=10.0, ge=1.0, le=60.0)
    user_agent: str = Field(
        default="StagePilot/0.1.0 (https://github.com/huntrw6/stage-pilot)",
        min_length=1,
        max_length=256,
    )

    @field_validator("app_id", "secret", mode="before")
    @classmethod
    def empty_secrets_are_unset(cls, value: object) -> object:
        """Treat empty environment values as absent credentials."""

        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value

    @field_validator("service_type_id", mode="before")
    @classmethod
    def empty_service_type_is_unset(cls, value: object) -> object:
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value

    @model_validator(mode="after")
    def credentials_are_complete(self) -> PlanningCenterSettings:
        if (self.app_id is None) != (self.secret is None):
            msg = "Planning Center application ID and secret must be configured together."
            raise ValueError(msg)
        return self

    @property
    def is_configured(self) -> bool:
        """Return a safe credential-presence flag without revealing either value."""

        return self.app_id is not None and self.secret is not None

    def credentials(self) -> tuple[str, str]:
        """Return credentials only to trusted backend integrations."""

        if self.app_id is None or self.secret is None:
            msg = "Planning Center credentials are not configured."
            raise ValueError(msg)
        return self.app_id.get_secret_value(), self.secret.get_secret_value()


class Settings(BaseModel):
    """Validated runtime settings; integration secrets remain server-side only."""

    app_name: str = "StagePilot"
    version: str = "0.1.0"
    bind_host: str = "127.0.0.1"
    bind_port: int = Field(default=8765, ge=1, le=65535)
    log_level: str = "INFO"
    demo_mode: bool = True
    timezone: str = "America/Los_Angeles"
    planning_center: PlanningCenterSettings = Field(default_factory=PlanningCenterSettings)
    recent_event_limit: int = Field(default=100, ge=1, le=1000)
    recent_error_limit: int = Field(default=50, ge=1, le=500)

    @field_validator("timezone")
    @classmethod
    def timezone_must_be_valid(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            msg = f"Unknown IANA timezone: {value}"
            raise ValueError(msg) from exc
        return value


def _environment_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.casefold() in {"1", "true", "yes", "on"}


def _environment_optional(name: str) -> str | None:
    value = os.getenv(name)
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


@lru_cache
def get_settings() -> Settings:
    """Load application settings from StagePilot environment variables."""

    return Settings(
        bind_host=os.getenv("STAGEPILOT_HOST", "127.0.0.1"),
        bind_port=int(os.getenv("STAGEPILOT_PORT", "8765")),
        log_level=os.getenv("STAGEPILOT_LOG_LEVEL", "INFO").upper(),
        demo_mode=_environment_bool("STAGEPILOT_DEMO_MODE", True),
        timezone=os.getenv("STAGEPILOT_TIMEZONE", "America/Los_Angeles"),
        planning_center=PlanningCenterSettings(
            app_id=_environment_optional("STAGEPILOT_PCO_APP_ID"),
            secret=_environment_optional("STAGEPILOT_PCO_SECRET"),
            service_type_id=_environment_optional("STAGEPILOT_PCO_SERVICE_TYPE_ID"),
            request_timeout_seconds=float(os.getenv("STAGEPILOT_PCO_TIMEOUT_SECONDS", "10.0")),
            user_agent=os.getenv(
                "STAGEPILOT_PCO_USER_AGENT",
                "StagePilot/0.1.0 (https://github.com/huntrw6/stage-pilot)",
            ),
        ),
    )
