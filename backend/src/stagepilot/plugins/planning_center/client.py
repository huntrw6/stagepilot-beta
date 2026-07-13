"""Asynchronous, typed client for the Planning Center Services API."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import httpx
from pydantic import ValidationError

from stagepilot.core.config import PlanningCenterSettings
from stagepilot.plugins.planning_center.errors import (
    PlanningCenterApiError,
    PlanningCenterAuthenticationError,
    PlanningCenterConfigurationError,
    PlanningCenterPermissionError,
    PlanningCenterRateLimitError,
    PlanningCenterResponseError,
    PlanningCenterTimeoutError,
    PlanningCenterTransportError,
)
from stagepilot.plugins.planning_center.models import (
    CollectionDocument,
    PlanningCenterServiceType,
    ServiceTypeResource,
)

API_BASE_URL = "https://api.planningcenteronline.com/"
API_HOST = "api.planningcenteronline.com"
API_VERSION = "2018-11-01"
SERVICE_TYPES_PATH = "services/v2/service_types"
MAX_PAGE_SIZE = 100
MAX_PAGES = 100


class PlanningCenterClient:
    """Call Planning Center with PAT authentication and safe error translation."""

    def __init__(
        self,
        settings: PlanningCenterSettings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        try:
            app_id, secret = settings.credentials()
        except ValueError:
            raise PlanningCenterConfigurationError(
                "Planning Center credentials are not configured."
            ) from None
        self._client = httpx.AsyncClient(
            base_url=API_BASE_URL,
            auth=httpx.BasicAuth(app_id, secret),
            headers={
                "Accept": "application/json",
                "User-Agent": settings.user_agent,
                "X-PCO-API-Version": API_VERSION,
            },
            timeout=httpx.Timeout(settings.request_timeout_seconds),
            transport=transport,
        )

    async def __aenter__(self) -> PlanningCenterClient:
        return self

    async def __aexit__(self, *_args: object) -> None:
        await self.close()

    async def close(self) -> None:
        """Release the underlying connection pool."""

        await self._client.aclose()

    async def list_service_types(self) -> list[PlanningCenterServiceType]:
        """Return all available service types in their configured sequence."""

        resources = await self._get_service_type_pages()
        return [
            PlanningCenterServiceType(
                id=resource.id,
                name=resource.attributes.name,
                sequence=resource.attributes.sequence,
                archived=(
                    resource.attributes.archived_at is not None
                    or resource.attributes.deleted_at is not None
                ),
            )
            for resource in resources
        ]

    async def _get_service_type_pages(self) -> list[ServiceTypeResource]:
        resources: list[ServiceTypeResource] = []
        request_url: str = SERVICE_TYPES_PATH
        request_params: Mapping[str, Any] | None = {
            "order": "sequence",
            "per_page": MAX_PAGE_SIZE,
            "offset": 0,
        }
        seen_requests: set[str] = set()
        for _page_number in range(MAX_PAGES):
            request_key = self._request_key(request_url, request_params)
            if request_key in seen_requests:
                raise PlanningCenterResponseError(
                    "Planning Center returned a repeated pagination request."
                )
            seen_requests.add(request_key)
            offset = self._request_offset(request_url, request_params)
            document = await self._get_service_type_page(
                request_url,
                params=request_params,
            )
            resources.extend(document.data)
            if document.links.next:
                request_url = self._validated_next_url(document.links.next)
                request_params = None
                continue
            next_offset = self._next_offset(document, offset)
            if next_offset is None:
                return resources
            offset = next_offset
            request_url = SERVICE_TYPES_PATH
            request_params = {
                "order": "sequence",
                "per_page": MAX_PAGE_SIZE,
                "offset": offset,
            }
        raise PlanningCenterResponseError("Planning Center pagination exceeded the safety limit.")

    async def _get_service_type_page(
        self,
        request_url: str,
        *,
        params: Mapping[str, Any] | None,
    ) -> CollectionDocument[ServiceTypeResource]:
        try:
            response = await self._client.get(request_url, params=params)
        except httpx.TimeoutException:
            raise PlanningCenterTimeoutError(
                "Planning Center did not respond before the request timeout."
            ) from None
        except httpx.RequestError:
            raise PlanningCenterTransportError("Could not connect to Planning Center.") from None

        if response.status_code == 401:
            raise PlanningCenterAuthenticationError(
                "Planning Center rejected the configured application ID or secret."
            )
        if response.status_code == 403:
            raise PlanningCenterPermissionError(
                "The Planning Center user cannot access Services service types."
            )
        if response.status_code == 429:
            raise PlanningCenterRateLimitError(
                self._parse_retry_after(response.headers.get("Retry-After"))
            )
        if not response.is_success:
            raise PlanningCenterApiError(response.status_code)

        try:
            return CollectionDocument[ServiceTypeResource].model_validate(response.json())
        except (ValueError, ValidationError):
            raise PlanningCenterResponseError(
                "Planning Center returned an invalid service type response."
            ) from None

    def _validated_next_url(self, value: str) -> str:
        try:
            url = self._client.base_url.join(value)
        except httpx.InvalidURL:
            raise PlanningCenterResponseError(
                "Planning Center returned an invalid pagination URL."
            ) from None
        if url.scheme != "https" or url.host != API_HOST:
            raise PlanningCenterResponseError("Planning Center returned an unsafe pagination URL.")
        return str(url)

    def _request_key(self, request_url: str, params: Mapping[str, Any] | None) -> str:
        url = self._client.base_url.join(request_url)
        if params:
            url = url.copy_merge_params(params)
        return str(url)

    def _request_offset(self, request_url: str, params: Mapping[str, Any] | None) -> int:
        raw_offset = (
            params.get("offset", 0)
            if params is not None
            else self._client.base_url.join(request_url).params.get("offset", "0")
        )
        try:
            offset = int(str(raw_offset))
        except ValueError:
            raise PlanningCenterResponseError(
                "Planning Center returned an invalid pagination offset."
            ) from None
        if offset < 0:
            raise PlanningCenterResponseError(
                "Planning Center returned an invalid pagination offset."
            )
        return offset

    @staticmethod
    def _parse_retry_after(value: str | None) -> int | None:
        if value is None:
            return None
        try:
            retry_after = int(value)
        except ValueError:
            return None
        return retry_after if retry_after >= 0 else None

    @staticmethod
    def _next_offset(
        document: CollectionDocument[ServiceTypeResource],
        current_offset: int,
    ) -> int | None:
        if document.meta.next is not None:
            next_offset = document.meta.next.offset
        elif (
            document.meta.total_count is not None
            and current_offset + len(document.data) < document.meta.total_count
        ) or len(document.data) == MAX_PAGE_SIZE:
            next_offset = current_offset + len(document.data)
        else:
            return None

        if next_offset <= current_offset:
            raise PlanningCenterResponseError(
                "Planning Center returned a non-advancing pagination offset."
            )
        return next_offset
