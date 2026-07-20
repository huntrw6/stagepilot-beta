"""Async HTTP client for the documented ProPresenter timer API."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any, Protocol, cast

import httpx
from pydantic import ValidationError

from stagepilot.core.config import ProPresenterSettings
from stagepilot.plugins.propresenter.errors import (
    ProPresenterConnectionError,
    ProPresenterResponseError,
    ProPresenterTimerNotFoundError,
    ProPresenterTimerTypeError,
)
from stagepilot.plugins.propresenter.models import ProPresenterLook, ProPresenterTimer

TIMER_UPDATE_VERIFICATION_ATTEMPTS = 30
TIMER_UPDATE_VERIFICATION_INTERVAL_SECONDS = 0.2


class ProPresenterClientContract(Protocol):
    async def close(self) -> None: ...

    async def list_timers(self) -> list[ProPresenterTimer]: ...

    async def find_timer(self, name: str) -> ProPresenterTimer: ...

    async def list_looks(self) -> list[ProPresenterLook]: ...

    async def current_look(self) -> ProPresenterLook: ...

    async def trigger_look(self, look_id: str) -> None: ...

    async def stop_timer(self, timer_id: str) -> None: ...

    async def set_timer_duration(
        self,
        timer: ProPresenterTimer,
        duration_seconds: int,
    ) -> ProPresenterTimer: ...

    async def reset_timer(self, timer_id: str) -> None: ...

    async def start_timer(self, timer_id: str) -> None: ...


class ProPresenterClient:
    """Small, typed boundary around ProPresenter's HTTP timer endpoints."""

    def __init__(
        self,
        settings: ProPresenterSettings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._settings = settings
        self._client = httpx.AsyncClient(
            base_url=settings.base_url,
            timeout=settings.request_timeout_seconds,
            transport=transport,
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def list_timers(self) -> list[ProPresenterTimer]:
        payload = await self._request("GET", "/v1/timers")
        raw_timers = self._extract_timer_list(payload)
        timers: list[ProPresenterTimer] = []
        for raw_timer in raw_timers:
            try:
                timers.append(ProPresenterTimer.model_validate(raw_timer))
            except ValidationError as exc:
                raise ProPresenterResponseError(
                    "ProPresenter returned an invalid timer object."
                ) from exc
        return timers

    async def find_timer(self, name: str) -> ProPresenterTimer:
        normalized_name = name.strip().casefold()
        matches = [
            timer
            for timer in await self.list_timers()
            if timer.id.name.strip().casefold() == normalized_name
        ]
        if not matches:
            raise ProPresenterTimerNotFoundError(f'ProPresenter timer "{name}" was not found.')
        if len(matches) > 1:
            raise ProPresenterTimerNotFoundError(
                f'Multiple ProPresenter timers are named "{name}".'
            )
        timer = matches[0]
        if timer.countdown is None:
            raise ProPresenterTimerTypeError(
                f'ProPresenter timer "{name}" is not a countdown timer.'
            )
        return timer

    async def get_timer(self, timer_id: str) -> ProPresenterTimer:
        """Read one timer directly so write verification does not use a stale list."""

        payload = await self._request("GET", f"/v1/timer/{timer_id}")
        try:
            return ProPresenterTimer.model_validate(payload)
        except ValidationError as exc:
            raise ProPresenterResponseError(
                "ProPresenter returned an invalid timer object."
            ) from exc

    async def list_looks(self) -> list[ProPresenterLook]:
        payload = await self._request("GET", "/v1/looks")
        raw_looks = self._extract_resource_list(payload, "looks")
        try:
            return [ProPresenterLook.model_validate(look) for look in raw_looks]
        except ValidationError as exc:
            raise ProPresenterResponseError(
                "ProPresenter returned an invalid Look object."
            ) from exc

    async def current_look(self) -> ProPresenterLook:
        payload = await self._request("GET", "/v1/look/current")
        try:
            return ProPresenterLook.model_validate(payload)
        except ValidationError as exc:
            raise ProPresenterResponseError(
                "ProPresenter returned an invalid current Look object."
            ) from exc

    async def trigger_look(self, look_id: str) -> None:
        if not look_id.strip():
            raise ValueError("Look ID cannot be empty.")
        await self._request("GET", f"/v1/look/{look_id}/trigger")

    async def stop_timer(self, timer_id: str) -> None:
        await self._timer_operation(timer_id, "stop")

    async def set_timer_duration(
        self,
        timer: ProPresenterTimer,
        duration_seconds: int,
    ) -> ProPresenterTimer:
        if duration_seconds < 0:
            raise ValueError("Timer duration must not be negative.")
        if timer.countdown is None:
            raise ProPresenterTimerTypeError(
                f'ProPresenter timer "{timer.id.name}" is not a countdown timer.'
            )
        await self._request(
            "PUT",
            f"/v1/timer/{timer.id.uuid}",
            json=timer.update_payload(duration_seconds),
        )
        return await self._verify_timer_duration(timer, duration_seconds)

    async def _verify_timer_duration(
        self,
        timer: ProPresenterTimer,
        duration_seconds: int,
    ) -> ProPresenterTimer:
        """Wait until ProPresenter exposes the saved duration before it is reset or started."""

        for attempt in range(TIMER_UPDATE_VERIFICATION_ATTEMPTS):
            current = await self.get_timer(timer.id.uuid)
            if (
                current is not None
                and current.countdown is not None
                and current.countdown.duration == duration_seconds
            ):
                return current
            if attempt + 1 < TIMER_UPDATE_VERIFICATION_ATTEMPTS:
                await asyncio.sleep(TIMER_UPDATE_VERIFICATION_INTERVAL_SECONDS)
        raise ProPresenterResponseError(
            f'ProPresenter did not confirm timer "{timer.id.name}" duration '
            f"as {duration_seconds} seconds. The timer was not started."
        )

    async def reset_timer(self, timer_id: str) -> None:
        await self._timer_operation(timer_id, "reset")

    async def start_timer(self, timer_id: str) -> None:
        await self._timer_operation(timer_id, "start")

    async def _timer_operation(self, timer_id: str, operation: str) -> None:
        await self._request("GET", f"/v1/timer/{timer_id}/{operation}")

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
    ) -> Any:
        try:
            response = await self._client.request(method, path, json=json)
            response.raise_for_status()
        except httpx.TimeoutException as exc:
            timeout = self._settings.request_timeout_seconds
            raise ProPresenterConnectionError(
                f"ProPresenter did not respond within {timeout:g} seconds."
            ) from exc
        except httpx.ConnectError as exc:
            raise ProPresenterConnectionError(
                f"Could not connect to ProPresenter at {self._settings.base_url}."
            ) from exc
        except httpx.RequestError as exc:
            raise ProPresenterConnectionError("The ProPresenter API request failed.") from exc
        except httpx.HTTPStatusError as exc:
            detail = self._safe_response_detail(exc.response)
            raise ProPresenterResponseError(
                f"ProPresenter returned HTTP {exc.response.status_code}{detail}."
            ) from exc

        if not response.content:
            return None
        try:
            return response.json()
        except ValueError as exc:
            raise ProPresenterResponseError("ProPresenter returned a non-JSON response.") from exc

    @staticmethod
    def _extract_timer_list(payload: Any) -> list[dict[str, Any]]:
        if isinstance(payload, list):
            return [cast(dict[str, Any], value) for value in payload if isinstance(value, dict)]
        if isinstance(payload, dict):
            for key in ("timers", "items", "data"):
                values = payload.get(key)
                if isinstance(values, list):
                    return [
                        cast(dict[str, Any], value) for value in values if isinstance(value, dict)
                    ]
        raise ProPresenterResponseError("ProPresenter returned an unexpected timer-list response.")

    @staticmethod
    def _extract_resource_list(payload: Any, resource_key: str) -> list[dict[str, Any]]:
        if isinstance(payload, list):
            return [cast(dict[str, Any], value) for value in payload if isinstance(value, dict)]
        if isinstance(payload, dict):
            for key in (resource_key, "items", "data"):
                values = payload.get(key)
                if isinstance(values, list):
                    return [
                        cast(dict[str, Any], value) for value in values if isinstance(value, dict)
                    ]
        raise ProPresenterResponseError(
            f"ProPresenter returned an unexpected {resource_key}-list response."
        )

    @staticmethod
    def _safe_response_detail(response: httpx.Response) -> str:
        text = response.text.strip().replace("\r", " ").replace("\n", " ")
        return f": {text[:200]}" if text else ""


ProPresenterClientFactory = Callable[[ProPresenterSettings], ProPresenterClientContract]
