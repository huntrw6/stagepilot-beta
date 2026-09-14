from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
import pytest

from stagepilot.remote_bootstrap import BootstrapBundle, DesktopBootstrapStore
from stagepilot.remote_desktop import DesktopRemoteManager
from stagepilot.remote_files import read_desired
from stagepilot.remote_provider import ProviderError

TEST_ORIGINS = frozenset({"https://control.example.com"})
TEST_NOW = datetime(2026, 9, 14, tzinfo=UTC)


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
        verify_enrollment=lambda _: None,
        now=lambda: TEST_NOW,
    )


def bundle_payload(
    installation_id: str = "a" * 32,
    *,
    bundle_id: str | None = None,
) -> dict[str, object]:
    return {
        "schema": "org.stagepilot.private-beta-bootstrap",
        "version": 1,
        "bundleId": bundle_id or str(uuid4()),
        "controlPlaneOrigin": "https://control.example.com",
        "installationId": installation_id,
        "hostname": f"sp-{installation_id}.remote.example.com",
        "remotePort": 18766,
        "installationCredential": f"spi_{installation_id}.{'s' * 43}",
        "issuedAt": "2026-09-13T20:00:00.000Z",
    }


def private_bundle(tmp_path: Path, payload: dict[str, object]) -> Path:
    path = tmp_path / "friend.bootstrap.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    path.chmod(0o600)
    return path


def test_import_persists_only_metadata_and_rejects_replay(tmp_path: Path) -> None:
    credentials = MemoryCredentials()
    store = verified_store(tmp_path / "state/bootstrap.json", credentials)
    payload = bundle_payload()
    source = private_bundle(tmp_path, payload)

    metadata = store.import_path(source)

    assert metadata.installation_id == payload["installationId"]
    persisted = store.path.read_text(encoding="utf-8")
    assert str(payload["installationCredential"]) not in persisted
    assert credentials.get(str(payload["installationId"])) == payload["installationCredential"]
    with pytest.raises(ProviderError, match=r"already imported|already provisioned"):
        store.import_path(source)


def test_import_rejects_unknown_fields_and_binding_mismatches(tmp_path: Path) -> None:
    for update in (
        {"unexpected": True},
        {"controlPlaneOrigin": "http://control.example.com"},
        {"hostname": "sp-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.remote.example.com"},
        {"installationCredential": f"spi_{'b' * 32}.{'s' * 43}"},
        {"remotePort": 8765},
    ):
        payload = {**bundle_payload(), **update}
        with pytest.raises(ValueError):
            BootstrapBundle.model_validate(payload)

    store = DesktopBootstrapStore(
        tmp_path / "state/bootstrap.json",
        MemoryCredentials(),
        verify_enrollment=lambda _: None,
        now=lambda: TEST_NOW,
    )
    with pytest.raises(ProviderError, match="trusted control plane"):
        store.import_bundle(BootstrapBundle.model_validate(bundle_payload()))


def test_import_rejects_expired_future_and_unverified_enrollment(tmp_path: Path) -> None:
    credentials = MemoryCredentials()
    store = verified_store(tmp_path / "state/bootstrap.json", credentials)
    expired = bundle_payload()
    expired["issuedAt"] = (TEST_NOW - timedelta(days=8)).isoformat()
    with pytest.raises(ProviderError, match="expired"):
        store.import_bundle(BootstrapBundle.model_validate(expired))

    future = bundle_payload()
    future["issuedAt"] = (TEST_NOW + timedelta(minutes=6)).isoformat()
    with pytest.raises(ProviderError, match="not yet valid"):
        store.import_bundle(BootstrapBundle.model_validate(future))

    rejected = DesktopBootstrapStore(
        tmp_path / "other/bootstrap.json",
        credentials,
        trusted_origins=TEST_ORIGINS,
        verify_enrollment=lambda _: (_ for _ in ()).throw(
            ProviderError("The bootstrap enrollment is expired or revoked")
        ),
        now=lambda: TEST_NOW,
    )
    with pytest.raises(ProviderError, match="expired or revoked"):
        rejected.import_bundle(BootstrapBundle.model_validate(bundle_payload()))
    assert credentials.values == {}


def test_revoke_keeps_replay_history_and_allows_new_installation(tmp_path: Path) -> None:
    credentials = MemoryCredentials()
    store = verified_store(tmp_path / "state/bootstrap.json", credentials)
    first_payload = bundle_payload()
    first = store.import_bundle(BootstrapBundle.model_validate(first_payload))
    store.finish_revoke(first)

    assert credentials.get(first.installation_id) is None
    assert store.state().active is None
    with pytest.raises(ProviderError, match="already imported"):
        store.import_bundle(BootstrapBundle.model_validate(first_payload))

    second_payload = bundle_payload("b" * 32)
    second = store.import_bundle(BootstrapBundle.model_validate(second_payload))
    assert second.installation_id == "b" * 32
    assert len(store.state().consumed_bundle_ids) == 2


class FakeControlPlane:
    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload
        self.generation = ""
        self.revoked = False
        self.reject_credential = False
        self.fail_revoke = False
        self.offline = False

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if self.offline:
            raise httpx.ConnectError("test outage")
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
    store.import_bundle(BootstrapBundle.model_validate(payload))
    binary = tmp_path / "resources/cloudflared"
    binary.parent.mkdir()
    binary.write_bytes(b"test binary")
    fake = FakeControlPlane(payload)
    manager = DesktopRemoteManager(
        tmp_path / "remote",
        binary,
        bootstrap_store=store,
        transport=httpx.MockTransport(fake),
    )
    return manager, credentials, fake, payload


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
    restarted.bootstrap.import_bundle(BootstrapBundle.model_validate(replacement))
    replacement_control = FakeControlPlane(replacement)
    restarted.transport = httpx.MockTransport(replacement_control)
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


def test_missing_native_credential_allows_safe_bundle_reimport(tmp_path: Path) -> None:
    manager, credentials, _, payload = manager_fixture(tmp_path)
    credentials.delete(str(payload["installationId"]))

    status = manager.status()

    assert status["provisioned"] is True
    assert status["credential_available"] is False

    replacement = bundle_payload("b" * 32)
    manager.bootstrap.import_bundle(BootstrapBundle.model_validate(replacement))
    active = manager.bootstrap.state().active
    assert active is not None
    assert active.installation_id == "b" * 32
