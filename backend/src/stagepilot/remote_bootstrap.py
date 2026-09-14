"""One-time desktop import for friend-specific private-beta bootstrap bundles."""

from __future__ import annotations

import json
import os
import re
import stat
import sys
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Protocol
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from stagepilot.remote_files import atomic_write
from stagepilot.remote_provider import ProviderError

BOOTSTRAP_SCHEMA = "org.stagepilot.private-beta-bootstrap"
BOOTSTRAP_VERSION = 1
BOOTSTRAP_MAX_AGE = timedelta(days=7)
BOOTSTRAP_FUTURE_SKEW = timedelta(minutes=5)
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


class BootstrapBundle(BaseModel):
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
    installation_credential: str = Field(alias="installationCredential", min_length=70)
    issued_at: str = Field(alias="issuedAt")

    @field_validator("bundle_id")
    @classmethod
    def uuid_v4(cls, value: str) -> str:
        try:
            parsed = UUID(value)
        except (ValueError, AttributeError) as exc:
            raise ValueError("Bootstrap bundle ID must be UUID v4") from exc
        if parsed.version != 4 or str(parsed) != value.casefold():
            raise ValueError("Bootstrap bundle ID must be UUID v4")
        return value

    @field_validator("issued_at")
    @classmethod
    def issue_time(cls, value: str) -> str:
        try:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
        except (ValueError, TypeError) as exc:
            raise ValueError("Invalid bootstrap issue time") from exc
        return value

    @model_validator(mode="after")
    def binding_policy(self) -> BootstrapBundle:
        if self.schema_name != BOOTSTRAP_SCHEMA or self.version != BOOTSTRAP_VERSION:
            raise ValueError("Unsupported bootstrap bundle schema")
        parsed = urlsplit(self.control_plane_origin)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
            or parsed.username
            or parsed.password
            or self.control_plane_origin != f"https://{parsed.netloc}"
        ):
            raise ValueError("Control-plane origin must be an exact HTTPS origin")
        if not _HOSTNAME.fullmatch(self.hostname) or ".." in self.hostname:
            raise ValueError("Invalid installation hostname")
        suffix = self.hostname.split(".", 1)[1]
        if self.hostname != f"sp-{self.installation_id}.{suffix}":
            raise ValueError("Bootstrap hostname is not bound to its installation ID")
        credential = _CREDENTIAL.fullmatch(self.installation_credential)
        if credential is None or credential.group(1) != self.installation_id:
            raise ValueError("Bootstrap credential is not bound to its installation ID")
        if self.remote_port == 8765:
            raise ValueError("Remote port must differ from the local StagePilot port")
        return self


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
    consumed_bundle_ids: list[str] = Field(default_factory=list, alias="consumedBundleIds")


class DesktopBootstrapStore:
    def __init__(
        self,
        path: Path,
        credentials: RemoteCredentialStore | None = None,
        *,
        trusted_origins: frozenset[str] = TRUSTED_CONTROL_PLANE_ORIGINS,
        verify_enrollment: Callable[[BootstrapBundle], None] | None = None,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        if not path.is_absolute():
            raise ValueError("Desktop bootstrap state path must be absolute")
        self.path = path
        self.credentials = credentials or NativeRemoteCredentialStore()
        self.trusted_origins = trusted_origins
        self.verify_enrollment = verify_enrollment or self._verify_enrollment
        self.now = now

    def state(self) -> BootstrapState:
        if not self.path.exists():
            return BootstrapState()
        try:
            if self.path.is_symlink() or self.path.stat().st_size > 32_768:
                raise ValueError("Invalid bootstrap metadata file")
            return BootstrapState.model_validate_json(self.path.read_text(encoding="utf-8"))
        except OSError as exc:
            raise ProviderError("Bootstrap metadata is unavailable") from exc

    def import_path(self, source: Path) -> BootstrapMetadata:
        if not source.is_absolute():
            raise ProviderError("Select an absolute bootstrap bundle path")
        try:
            details = source.lstat()
            if not stat.S_ISREG(details.st_mode) or source.is_symlink() or details.st_size > 16_384:
                raise ProviderError("The bootstrap bundle must be a small regular file")
            # Enrollment creates mode 0600. Windows ACLs do not map reliably to POSIX mode bits.
            if sys.platform != "win32" and details.st_mode & 0o077:
                raise ProviderError("The bootstrap bundle is not private to the current user")
            payload = json.loads(source.read_text(encoding="utf-8"))
            bundle = BootstrapBundle.model_validate(payload)
        except ProviderError:
            raise
        except (OSError, ValueError, TypeError) as exc:
            raise ProviderError("The bootstrap bundle is invalid or unavailable") from exc
        return self.import_bundle(bundle)

    def import_bundle(self, bundle: BootstrapBundle) -> BootstrapMetadata:
        if bundle.control_plane_origin not in self.trusted_origins:
            raise ProviderError("The bootstrap bundle did not come from the trusted control plane")
        issued_at = datetime.fromisoformat(bundle.issued_at.replace("Z", "+00:00"))
        if issued_at.tzinfo is None:
            raise ProviderError("The bootstrap bundle issue time must include a timezone")
        age = self.now().astimezone(UTC) - issued_at.astimezone(UTC)
        if age < -BOOTSTRAP_FUTURE_SKEW or age > BOOTSTRAP_MAX_AGE:
            raise ProviderError("The bootstrap bundle is expired or not yet valid")
        current = self.state()
        if bundle.bundle_id in current.consumed_bundle_ids:
            raise ProviderError("This bootstrap bundle was already imported")
        if current.active is not None:
            try:
                existing_credential = self.credential(current.active)
            except ProviderError:
                existing_credential = ""
            if existing_credential:
                raise ProviderError("This StagePilot installation is already provisioned")
        self.verify_enrollment(bundle)
        metadata = BootstrapMetadata.model_validate(
            {
                "schema": bundle.schema_name,
                "version": bundle.version,
                "bundleId": bundle.bundle_id,
                "controlPlaneOrigin": bundle.control_plane_origin,
                "installationId": bundle.installation_id,
                "hostname": bundle.hostname,
                "remotePort": bundle.remote_port,
            }
        )
        self.credentials.set(bundle.installation_id, bundle.installation_credential)
        try:
            current.active = metadata
            current.consumed_bundle_ids.append(bundle.bundle_id)
            self._write(current)
        except Exception:
            self.credentials.delete(bundle.installation_id)
            raise
        return metadata

    @staticmethod
    def _verify_enrollment(bundle: BootstrapBundle) -> None:
        try:
            response = httpx.get(
                f"{bundle.control_plane_origin}/v1/installations/{bundle.installation_id}/status",
                headers={"Authorization": f"Bearer {bundle.installation_credential}"},
                timeout=10,
                trust_env=False,
                follow_redirects=False,
            )
        except httpx.HTTPError as exc:
            raise ProviderError("The bootstrap enrollment could not be verified") from exc
        if response.status_code in {401, 403}:
            raise ProviderError("The bootstrap enrollment is expired or revoked")
        try:
            payload = response.json()
        except ValueError as exc:
            raise ProviderError("The bootstrap enrollment response was invalid") from exc
        if (
            response.status_code != 200
            or not isinstance(payload, dict)
            or payload.get("installationId") != bundle.installation_id
            or payload.get("hostname") != bundle.hostname
            or payload.get("revoked") is not False
        ):
            raise ProviderError("The bootstrap enrollment did not match the trusted control plane")

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
            self._write(state)

    def _write(self, state: BootstrapState) -> None:
        atomic_write(self.path, state.model_dump_json(by_alias=True))
