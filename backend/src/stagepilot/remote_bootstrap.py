"""Native credential storage and transparent private-beta enrollment."""

from __future__ import annotations

import os
import random
import re
import time
from collections.abc import Callable
from pathlib import Path
from typing import Annotated, Protocol
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from pydantic import BaseModel, ConfigDict, Field

from stagepilot.remote_files import atomic_write
from stagepilot.remote_provider import ProviderError

INSTALLATION_SCHEMA = "org.stagepilot.private-beta-installation"
DEFAULT_CONTROL_PLANE_ORIGIN = (
    "https://stagepilot-beta-control-plane.stagepilot-illuminary-beta.workers.dev"
)
DEFAULT_REMOTE_PORT = 18766
TRUSTED_CONTROL_PLANE_ORIGINS = frozenset(
    {"https://stagepilot-beta-control-plane.stagepilot-illuminary-beta.workers.dev"}
)
_HOSTNAME = re.compile(
    r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$"
)
_CREDENTIAL = re.compile(r"^spi_([a-f0-9]{32})\.([A-Za-z0-9_-]{32,})$")


class RemoteCredentialStore(Protocol):
    def get(self, installation_id: str) -> str | None: ...

    def set(self, installation_id: str, credential: str) -> None: ...

    def delete(self, installation_id: str) -> None: ...


class NativeRemoteCredentialStore:
    """Use the authenticated Tauri broker for Credential Manager or Keychain."""

    def __init__(self, origin: str | None = None, authorization: str | None = None) -> None:
        self.origin = origin or os.environ.get("STAGEPILOT_CREDENTIAL_BROKER_ORIGIN", "")
        self.authorization = authorization or os.environ.get(
            "STAGEPILOT_CREDENTIAL_BROKER_TOKEN", ""
        )

    def _request(
        self, method: str, installation_id: str, credential: str | None = None
    ) -> httpx.Response:
        parsed = urlsplit(self.origin)
        try:
            port = parsed.port
        except ValueError:
            port = None
        if (
            parsed.scheme != "http"
            or parsed.hostname != "127.0.0.1"
            or port is None
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
            or parsed.username
            or parsed.password
            or not self.authorization
        ):
            raise ProviderError("The operating-system credential store is unavailable")
        try:
            return httpx.request(
                method,
                f"{self.origin}/v1/credentials/{installation_id}",
                headers={"Authorization": f"Bearer {self.authorization}"},
                content=credential or b"",
                timeout=3,
                trust_env=False,
                follow_redirects=False,
            )
        except httpx.HTTPError as exc:
            raise ProviderError("The operating-system credential store is unavailable") from exc

    def get(self, installation_id: str) -> str | None:
        response = self._request("GET", installation_id)
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            raise ProviderError("The operating-system credential store is unavailable")
        return response.text

    def set(self, installation_id: str, credential: str) -> None:
        if self._request("PUT", installation_id, credential).status_code != 204:
            raise ProviderError("The installation credential could not be saved")

    def delete(self, installation_id: str) -> None:
        if self._request("DELETE", installation_id).status_code != 204:
            raise ProviderError("The installation credential could not be removed")


class BootstrapMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)

    schema_name: str = Field(alias="schema")
    version: int
    bundle_id: str = Field(alias="bundleId")
    control_plane_origin: str = Field(alias="controlPlaneOrigin")
    installation_id: Annotated[str, Field(pattern=r"^[a-f0-9]{32}$")] = Field(
        alias="installationId"
    )
    hostname: str
    remote_port: int = Field(alias="remotePort", ge=1024, le=65535)


class BootstrapState(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)

    active: BootstrapMetadata | None = None
    enrollment_nonce: str | None = Field(default=None, alias="enrollmentNonce")
    legacy_consumed_bundle_ids: list[str] = Field(
        default_factory=list, alias="consumedBundleIds", exclude=True
    )


class DesktopBootstrapStore:
    def __init__(
        self,
        path: Path,
        credentials: RemoteCredentialStore | None = None,
        *,
        trusted_origins: frozenset[str] = TRUSTED_CONTROL_PLANE_ORIGINS,
    ) -> None:
        if not path.is_absolute():
            raise ValueError("Desktop bootstrap state path must be absolute")
        self.path = path
        self.credentials = credentials or NativeRemoteCredentialStore()
        self.trusted_origins = trusted_origins

    def ensure_enrolled(
        self,
        *,
        control_plane_origin: str = DEFAULT_CONTROL_PLANE_ORIGIN,
        remote_port: int = DEFAULT_REMOTE_PORT,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        random_value: Callable[[], float] = random.random,
    ) -> BootstrapMetadata:
        """Transparently create and securely retain this installation identity."""

        if control_plane_origin not in self.trusted_origins:
            raise ProviderError("The enrollment service is not trusted")
        current = self.state()
        if current.active is not None:
            self.credential(current.active)
            return current.active
        if current.enrollment_nonce is None:
            current.enrollment_nonce = str(UUID(bytes=os.urandom(16), version=4))
            self._write(current)
        response: httpx.Response | None = None
        with httpx.Client(
            base_url=control_plane_origin,
            timeout=20,
            trust_env=False,
            follow_redirects=False,
            transport=transport,
        ) as client:
            for attempt in range(3):
                try:
                    response = client.post(
                        "/v1/installations/enroll", json={"nonce": current.enrollment_nonce}
                    )
                except httpx.HTTPError as exc:
                    if attempt == 2:
                        raise ProviderError("The enrollment service is unavailable") from exc
                else:
                    if response.status_code not in {429, 503} or attempt == 2:
                        break
                retry_after = 0
                if response is not None:
                    try:
                        retry_after = max(
                            0, min(300, int(response.headers.get("Retry-After", "0")))
                        )
                    except ValueError:
                        retry_after = 0
                sleep(max(float(retry_after), min(0.5 * (2**attempt) + random_value() * 0.25, 5.0)))
        if response is None or response.status_code not in {200, 201}:
            raise ProviderError("The enrollment service is unavailable; retry later")
        try:
            payload = response.json()
            installation_id = payload["installationId"]
            hostname = payload["hostname"]
            credential = payload["installationCredential"]
        except (ValueError, KeyError, TypeError) as exc:
            raise ProviderError("The enrollment response was invalid") from exc
        match = _CREDENTIAL.fullmatch(credential) if isinstance(credential, str) else None
        if (
            not isinstance(installation_id, str)
            or not re.fullmatch(r"[a-f0-9]{32}", installation_id)
            or match is None
            or match.group(1) != installation_id
            or not isinstance(hostname, str)
            or not _HOSTNAME.fullmatch(hostname)
            or hostname != f"sp-{installation_id}.{hostname.split('.', 1)[1]}"
        ):
            raise ProviderError("The enrollment response was not installation-bound")
        metadata = BootstrapMetadata.model_validate(
            {
                "schema": INSTALLATION_SCHEMA,
                "version": 1,
                "bundleId": current.enrollment_nonce,
                "controlPlaneOrigin": control_plane_origin,
                "installationId": installation_id,
                "hostname": hostname,
                "remotePort": remote_port,
            }
        )
        self.credentials.set(installation_id, credential)
        try:
            current.active = metadata
            self._write(current)
        except Exception:
            self.credentials.delete(installation_id)
            raise
        return metadata

    def state(self) -> BootstrapState:
        if not self.path.exists():
            return BootstrapState()
        try:
            if self.path.is_symlink() or self.path.stat().st_size > 32_768:
                raise ValueError("Invalid bootstrap metadata file")
            return BootstrapState.model_validate_json(self.path.read_text(encoding="utf-8"))
        except OSError as exc:
            raise ProviderError("Bootstrap metadata is unavailable") from exc


    def credential(self, metadata: BootstrapMetadata) -> str:
        value = self.credentials.get(metadata.installation_id)
        match = _CREDENTIAL.fullmatch(value or "")
        if match is None or match.group(1) != metadata.installation_id:
            raise ProviderError("The installation credential is unavailable")
        return value or ""

    def finish_revoke(self, metadata: BootstrapMetadata) -> None:
        self.credentials.delete(metadata.installation_id)
        state = self.state()
        if state.active is not None and state.active.installation_id == metadata.installation_id:
            state.active = None
            state.enrollment_nonce = None
            self._write(state)

    def _write(self, state: BootstrapState) -> None:
        atomic_write(self.path, state.model_dump_json(by_alias=True))
