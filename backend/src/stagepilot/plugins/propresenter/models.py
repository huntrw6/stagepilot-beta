"""Validated ProPresenter timer models."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ProPresenterIdentifier(BaseModel):
    """The API identity object ProPresenter uses for named resources."""

    model_config = ConfigDict(frozen=True, extra="ignore")

    uuid: str = Field(min_length=1)
    name: str = Field(min_length=1)
    index: int = Field(ge=0)


class ProPresenterCountdown(BaseModel):
    """Countdown-specific timer settings."""

    model_config = ConfigDict(frozen=True, extra="ignore")

    duration: int = Field(ge=0)


class ProPresenterLook(BaseModel):
    """A saved audience Look returned by ProPresenter's public API."""

    model_config = ConfigDict(frozen=True, extra="ignore")

    id: ProPresenterIdentifier

    @model_validator(mode="before")
    @classmethod
    def normalize_look_shapes(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value
        data: dict[str, Any] = dict(value)
        nested = data.get("look")
        if isinstance(nested, dict):
            data = dict(nested)
        identifier = data.get("id")
        if isinstance(identifier, str):
            data["id"] = {
                "uuid": identifier,
                "name": data.get("name"),
                "index": data.get("index", 0),
            }
        elif not isinstance(identifier, dict):
            uuid = data.get("uuid")
            name = data.get("name")
            if isinstance(uuid, str) and isinstance(name, str):
                data["id"] = {"uuid": uuid, "name": name, "index": data.get("index", 0)}
        return data


class ProPresenterTimer(BaseModel):
    """The stable subset of a timer returned by the ProPresenter HTTP API."""

    model_config = ConfigDict(frozen=True, extra="ignore")

    id: ProPresenterIdentifier
    allows_overrun: bool = False
    countdown: ProPresenterCountdown | None = None
    state: str | None = None
    time: str | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_timer_shapes(cls, value: object) -> object:
        """Accept the documented shape and a few wrapper shapes seen in API clients."""

        if not isinstance(value, dict):
            return value

        data: dict[str, Any] = dict(value)
        nested = data.get("timer")
        if isinstance(nested, dict):
            merged = dict(nested)
            if "id" not in merged and "id" in data:
                merged["id"] = data["id"]
            if "id" not in merged:
                name = data.get("name")
                uuid = data.get("uuid")
                index = data.get("index")
                if isinstance(name, str) and isinstance(uuid, str) and isinstance(index, int):
                    merged["id"] = {"name": name, "uuid": uuid, "index": index}
            data = merged

        identifier = data.get("id")
        if isinstance(identifier, str):
            name = data.get("name")
            index = data.get("index", 0)
            if isinstance(name, str) and isinstance(index, int):
                data["id"] = {"uuid": identifier, "name": name, "index": index}
        elif isinstance(identifier, dict):
            normalized_id = dict(identifier)
            normalized_id.setdefault("name", data.get("name"))
            normalized_id.setdefault("index", data.get("index", 0))
            data["id"] = normalized_id

        return data

    def update_payload(self, duration_seconds: int) -> dict[str, Any]:
        """Return a countdown definition, replacing any previous timer type."""

        if duration_seconds < 0:
            raise ValueError("Timer duration must not be negative.")
        return {
            "id": self.id.model_dump(mode="json"),
            "allows_overrun": self.allows_overrun,
            "countdown": {"duration": duration_seconds},
        }
