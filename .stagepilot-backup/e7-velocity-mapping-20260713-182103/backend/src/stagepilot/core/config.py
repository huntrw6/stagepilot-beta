"""Runtime configuration with environment-variable overrides."""

from __future__ import annotations

import os
from functools import lru_cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator

from stagepilot.core.midi import MidiCueName


class DemoSettings(BaseModel):
    """Control which integrations are simulated while using the demo service plan."""

    simulate_midi: bool = True
    simulate_propresenter: bool = True


class MidiNoteMappings(BaseModel):
    """Configurable note-on mappings for Playback cues."""

    start_next: int | None = Field(default=100, ge=0, le=127)
    restart_current: int | None = Field(default=101, ge=0, le=127)
    previous: int | None = Field(default=102, ge=0, le=127)
    next: int | None = Field(default=103, ge=0, le=127)
    reload_plan: int | None = Field(default=104, ge=0, le=127)
    stop_timer: int | None = Field(default=105, ge=0, le=127)

    @model_validator(mode="after")
    def mapped_notes_are_unique(self) -> MidiNoteMappings:
        notes = [note for _cue, note in self.configured()]
        if len(notes) != len(set(notes)):
            raise ValueError("Every configured MIDI action must use a distinct note.")
        return self

    def configured(self) -> tuple[tuple[MidiCueName, int], ...]:
        values = (
            (MidiCueName.START_NEXT, self.start_next),
            (MidiCueName.RESTART_CURRENT, self.restart_current),
            (MidiCueName.PREVIOUS, self.previous),
            (MidiCueName.NEXT, self.next),
            (MidiCueName.RELOAD_PLAN, self.reload_plan),
            (MidiCueName.STOP_TIMER, self.stop_timer),
        )
        return tuple((cue, note) for cue, note in values if note is not None)

    def note_for(self, cue: MidiCueName) -> int | None:
        return dict(self.configured()).get(cue)

    def cue_for(self, note: int) -> MidiCueName | None:
        return next((cue for cue, mapped_note in self.configured() if mapped_note == note), None)


class MidiSettings(BaseModel):
    """Validated runtime settings for the Playback MIDI input."""

    enabled: bool = False
    input_name: str | None = Field(default=None, max_length=512)
    channel: int = Field(default=1, ge=1, le=16)
    mappings: MidiNoteMappings = Field(default_factory=MidiNoteMappings)
    debounce_ms: int = Field(default=250, ge=0, le=2000)

    @field_validator("input_name", mode="before")
    @classmethod
    def empty_input_name_is_unset(cls, value: object) -> object:
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value


class ProPresenterSettings(BaseModel):
    """Validated runtime settings for ProPresenter's local HTTP API."""

    enabled: bool = False
    host: str = Field(default="127.0.0.1", min_length=1, max_length=255)
    port: int = Field(default=1025, ge=1, le=65535)
    timer_name: str = Field(default="Song Countdown", min_length=1, max_length=255)
    request_timeout_seconds: float = Field(default=3.0, gt=0, le=60.0)

    @field_validator("host", "timer_name", mode="before")
    @classmethod
    def values_are_trimmed(cls, value: object) -> object:
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                raise ValueError("Value cannot be empty.")
            return stripped
        return value

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"


class PlanningCenterSettings(BaseModel):
    """Validated server-side settings for Planning Center Personal Access Tokens."""

    model_config = ConfigDict(hide_input_in_errors=True)

    app_id: SecretStr | None = None
    secret: SecretStr | None = None
    service_type_id: str | None = Field(default=None, min_length=1)
    upcoming_lookahead_days: int = Field(default=30, ge=0, le=365)
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
    demo: DemoSettings = Field(default_factory=DemoSettings)
    timezone: str = "America/Los_Angeles"
    planning_center: PlanningCenterSettings = Field(default_factory=PlanningCenterSettings)
    midi: MidiSettings = Field(default_factory=MidiSettings)
    propresenter: ProPresenterSettings = Field(default_factory=ProPresenterSettings)
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


def _environment_optional_int(name: str, default: int | None) -> int | None:
    value = _environment_optional(name)
    return default if value is None else int(value)


@lru_cache
def get_settings() -> Settings:
    """Load application settings from StagePilot environment variables."""

    return Settings(
        bind_host=os.getenv("STAGEPILOT_HOST", "127.0.0.1"),
        bind_port=int(os.getenv("STAGEPILOT_PORT", "8765")),
        log_level=os.getenv("STAGEPILOT_LOG_LEVEL", "INFO").upper(),
        demo_mode=_environment_bool("STAGEPILOT_DEMO_MODE", True),
        demo=DemoSettings(
            simulate_midi=_environment_bool("STAGEPILOT_DEMO_SIMULATE_MIDI", True),
            simulate_propresenter=_environment_bool(
                "STAGEPILOT_DEMO_SIMULATE_PROPRESENTER", True
            ),
        ),
        timezone=os.getenv("STAGEPILOT_TIMEZONE", "America/Los_Angeles"),
        planning_center=PlanningCenterSettings(
            app_id=_environment_optional("STAGEPILOT_PCO_APP_ID"),
            secret=_environment_optional("STAGEPILOT_PCO_SECRET"),
            service_type_id=_environment_optional("STAGEPILOT_PCO_SERVICE_TYPE_ID"),
            upcoming_lookahead_days=int(os.getenv("STAGEPILOT_PCO_LOOKAHEAD_DAYS", "30")),
            request_timeout_seconds=float(os.getenv("STAGEPILOT_PCO_TIMEOUT_SECONDS", "10.0")),
            user_agent=os.getenv(
                "STAGEPILOT_PCO_USER_AGENT",
                "StagePilot/0.1.0 (https://github.com/huntrw6/stage-pilot)",
            ),
        ),
        midi=MidiSettings(
            enabled=_environment_bool("STAGEPILOT_MIDI_ENABLED", False),
            input_name=_environment_optional("STAGEPILOT_MIDI_INPUT_NAME"),
            channel=int(os.getenv("STAGEPILOT_MIDI_CHANNEL", "1")),
            mappings=MidiNoteMappings(
                start_next=_environment_optional_int("STAGEPILOT_MIDI_START_NEXT_NOTE", 100),
                restart_current=_environment_optional_int(
                    "STAGEPILOT_MIDI_RESTART_CURRENT_NOTE", 101
                ),
                previous=_environment_optional_int("STAGEPILOT_MIDI_PREVIOUS_NOTE", 102),
                next=_environment_optional_int("STAGEPILOT_MIDI_NEXT_NOTE", 103),
                reload_plan=_environment_optional_int("STAGEPILOT_MIDI_RELOAD_PLAN_NOTE", 104),
                stop_timer=_environment_optional_int("STAGEPILOT_MIDI_STOP_TIMER_NOTE", 105),
            ),
            debounce_ms=int(os.getenv("STAGEPILOT_MIDI_DEBOUNCE_MS", "250")),
        ),
        propresenter=ProPresenterSettings(
            enabled=_environment_bool("STAGEPILOT_PROPRESENTER_ENABLED", False),
            host=os.getenv("STAGEPILOT_PROPRESENTER_HOST", "127.0.0.1"),
            port=int(os.getenv("STAGEPILOT_PROPRESENTER_PORT", "1025")),
            timer_name=os.getenv(
                "STAGEPILOT_PROPRESENTER_TIMER_NAME",
                "Song Countdown",
            ),
            request_timeout_seconds=float(
                os.getenv("STAGEPILOT_PROPRESENTER_TIMEOUT_SECONDS", "3.0")
            ),
        ),
    )

