from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from stagepilot.remote_bootstrap import DesktopBootstrapStore
from stagepilot.remote_desktop import DesktopRemoteManager
from stagepilot.remote_files import read_desired
from stagepilot.remote_provider import ProviderError

TEST_ORIGINS = frozenset({"https://control.example.com"})


class MemoryCredentials:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    def get(self, installation_id: str) -> str | None:
        return self.values.get(installation_id)

    def set(self, installation_id: str, credential: str) -> None:
        self.values[installation_id] = credential

    def delete(self, installation_id: str) -> None:
        self.values.pop(installation_id, None)


def verified_store(path: Path, credentials: MemoryCredentials) -> DesktopBootstrapStore:
    return DesktopBootstrapStore(
        path,
        credentials,
        trusted_origins=TEST_ORIGINS,
    )


def bundle_payload(
    installation_id: str = "a" * 32,
) -> dict[str, object]:
    return {
        "installationId": installation_id,
        "hostname": f"sp-{installation_id}.remote.example.com",
        "installationCredential": f"spi_{installation_id}.{'s' * 43}",
    }


class FakeControlPlane:
    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload
        self.generation = ""
        self.revoked = False
        self.reject_credential = False
        self.fail_revoke = False
        self.offline = False
        self.enrollment_nonce = ""

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if self.offline:
            raise httpx.ConnectError("test outage")
        if request.url.path.endswith("/v1/installations/enroll"):
            self.enrollment_nonce = str(json.loads(request.content)["nonce"])
            return httpx.Response(201, json=self.payload)
        if self.reject_credential:
            return httpx.Response(401, json={"error": "unauthorized"})
        expected = "Bear" + f"er {self.payload['installationCredential']}"
        if request.headers.get("authorization") != expected:
            return httpx.Response(401, json={"error": "unauthorized"})
        if request.url.path.endswith("/provision"):
            body: dict[str, Any] = json.loads(request.content)
            self.generation = str(body["generation"])
            return httpx.Response(
                200,
                json={
                    "installationId": self.payload["installationId"],
                    "hostname": self.payload["hostname"],
                    "generation": self.generation,
                    "phase": "provisioned",
                    "tunnelToken": "desktop-installation-cloudflared-token",
                },
            )
        if request.url.path.endswith("/reconcile"):
            return httpx.Response(
                200,
                json={
                    "installationId": self.payload["installationId"],
                    "hostname": self.payload["hostname"],
                    "generation": self.generation,
                    "phase": "provisioned",
                    "tunnelToken": "desktop-installation-cloudflared-token",
                },
            )
        if request.url.path.endswith("/revoke"):
            if self.fail_revoke:
                raise httpx.ConnectError("test outage")
            self.revoked = True
            self.generation = ""
            return httpx.Response(
                200,
                json={
                    "installationId": self.payload["installationId"],
                    "hostname": self.payload["hostname"],
                    "phase": "disabled",
                    "revoked": True,
                },
            )
        raise AssertionError(f"unexpected route {request.url.path}")


def manager_fixture(
    tmp_path: Path,
) -> tuple[DesktopRemoteManager, MemoryCredentials, FakeControlPlane, dict[str, object]]:
    payload = bundle_payload()
    credentials = MemoryCredentials()
    store = verified_store(tmp_path / "remote/bootstrap.json", credentials)
    fake = FakeControlPlane(payload)
    store.ensure_enrolled(
        control_plane_origin="https://control.example.com",
        transport=httpx.MockTransport(fake),
    )
    binary = tmp_path / "resources/cloudflared"
    binary.parent.mkdir()
    binary.write_bytes(b"test binary")
    manager = DesktopRemoteManager(
        tmp_path / "remote",
        binary,
        bootstrap_store=store,
        transport=httpx.MockTransport(fake),
        control_plane_origin="https://control.example.com",
    )
    return manager, credentials, fake, payload


def test_first_enable_transparently_enrolls_and_keeps_credential_native(tmp_path: Path) -> None:
    payload = bundle_payload()
    credentials = MemoryCredentials()
    store = DesktopBootstrapStore(
        tmp_path / "remote/bootstrap.json",
        credentials,
        trusted_origins=TEST_ORIGINS,
    )
    binary = tmp_path / "resources/cloudflared"
    binary.parent.mkdir()
    binary.write_bytes(b"test binary")
    fake = FakeControlPlane(payload)
    manager = DesktopRemoteManager(
        tmp_path / "remote",
        binary,
        bootstrap_store=store,
        transport=httpx.MockTransport(fake),
        control_plane_origin="https://control.example.com",
    )

    enabled = manager.enable()

    assert enabled["provisioned"] is True
    active = store.state().active
    assert active is not None
    assert active.installation_id == payload["installationId"]
    assert credentials.get(active.installation_id) == payload["installationCredential"]
    serialized = store.path.read_text(encoding="utf-8")
    assert str(payload["installationCredential"]) not in serialized
    assert store.state().enrollment_nonce is None
    assert active.bundle_id == active.installation_id
    assert fake.enrollment_nonce not in serialized


def test_enrollment_honors_retry_after_with_backoff_and_jitter(tmp_path: Path) -> None:
    payload = bundle_payload()
    credentials = MemoryCredentials()
    store = DesktopBootstrapStore(
        tmp_path / "remote/bootstrap.json",
        credentials,
        trusted_origins=TEST_ORIGINS,
    )
    attempts = 0
    sleeps: list[float] = []

    def enrollment(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            return httpx.Response(429, headers={"Retry-After": "2"}, json={"error": "limited"})
        return httpx.Response(201, json=payload)

    metadata = store.ensure_enrolled(
        control_plane_origin="https://control.example.com",
        transport=httpx.MockTransport(enrollment),
        sleep=sleeps.append,
        random_value=lambda: 0.5,
    )

    assert metadata.installation_id == payload["installationId"]
    assert attempts == 3
    assert sleeps == [2.0, 2.0]


def test_desktop_enable_restart_and_permanent_disable(tmp_path: Path) -> None:
    manager, credentials, fake, payload = manager_fixture(tmp_path)

    enabled = manager.enable()
    desired = read_desired(manager.desired_path)
    active = manager.bootstrap.state().active
    assert enabled["provisioned"] is True
    assert desired.enabled and desired.generation == manager.feature.intent().generation
    assert active is not None
    assert manager.bootstrap.credential(active) == payload["installationCredential"]

    restarted = DesktopRemoteManager(
        manager.root,
        manager.cloudflared_binary,
        bootstrap_store=manager.bootstrap,
        transport=httpx.MockTransport(fake),
    )
    restarted.reconcile_control()
    assert restarted.feature.intent().enabled
    assert read_desired(restarted.desired_path).enabled

    disabled = restarted.disable()
    assert fake.revoked
    assert disabled["provisioned"] is False
    assert not read_desired(restarted.desired_path).enabled
    assert not restarted.installation_dir.joinpath("connector.token").exists()
    assert credentials.get(str(payload["installationId"])) is None

    replacement = bundle_payload("b" * 32)
    replacement_control = FakeControlPlane(replacement)
    restarted.transport = httpx.MockTransport(replacement_control)
    restarted.control_plane_origin = "https://control.example.com"
    reenabled = restarted.enable()
    assert reenabled["provisioned"] is True
    active_replacement = restarted.bootstrap.state().active
    assert active_replacement is not None
    assert active_replacement.installation_id == "b" * 32


def test_revoke_failure_closes_local_access_and_retries_after_restart(tmp_path: Path) -> None:
    manager, credentials, fake, payload = manager_fixture(tmp_path)
    manager.enable()
    fake.fail_revoke = True

    with pytest.raises(ProviderError):
        manager.disable()

    assert not read_desired(manager.desired_path).enabled
    assert credentials.get(str(payload["installationId"])) is not None
    fake.fail_revoke = False
    restarted = DesktopRemoteManager(
        manager.root,
        manager.cloudflared_binary,
        bootstrap_store=manager.bootstrap,
        transport=httpx.MockTransport(fake),
    )
    restarted.reconcile_control()
    assert fake.revoked
    assert restarted.bootstrap.state().active is None
    assert credentials.get(str(payload["installationId"])) is None


@pytest.mark.asyncio
async def test_startup_reconciliation_retries_after_transient_outage(tmp_path: Path) -> None:
    manager, _, fake, _ = manager_fixture(tmp_path)
    manager.enable()
    restarted = DesktopRemoteManager(
        manager.root,
        manager.cloudflared_binary,
        bootstrap_store=manager.bootstrap,
        transport=httpx.MockTransport(fake),
    )
    fake.offline = True
    stop = asyncio.Event()
    task = asyncio.create_task(restarted.run(stop))
    try:
        await asyncio.sleep(0.2)
        assert restarted._connector_token is None
        fake.offline = False
        await asyncio.sleep(1.2)
        assert restarted._connector_token == "desktop-installation-cloudflared-token"
    finally:
        stop.set()
        await task


def test_revoked_or_expired_installation_is_retired_during_reconcile(tmp_path: Path) -> None:
    manager, credentials, fake, payload = manager_fixture(tmp_path)
    revoked_sessions: list[bool] = []
    manager.revoke_sessions = lambda: revoked_sessions.append(True)
    manager.enable()
    fake.reject_credential = True

    manager.reconcile_control()

    assert manager.bootstrap.state().active is None
    assert credentials.get(str(payload["installationId"])) is None
    assert not read_desired(manager.desired_path).enabled
    assert revoked_sessions == [True]
    assert manager._connector_token is None


def test_missing_native_credential_fails_closed_without_reenrollment(tmp_path: Path) -> None:
    manager, credentials, _, payload = manager_fixture(tmp_path)
    credentials.delete(str(payload["installationId"]))

    status = manager.status()

    assert status["provisioned"] is True
    assert status["credential_available"] is False
    with pytest.raises(ProviderError, match="credential is unavailable"):
        manager.enable()
    assert manager.bootstrap.state().active is not None
