from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
import pytest

from stagepilot.remote_control import RemoteControl
from stagepilot.remote_files import ControlConfig, is_group_or_world_readable, read_desired
from stagepilot.remote_provider import CloudflareProvider, ProviderError


class FakeCloudflare:
    """Explicit provider substitute; never evidence of real account operations."""

    def __init__(self) -> None:
        self.tunnels: dict[str, dict[str, Any]] = {}
        self.records: list[dict[str, Any]] = []
        self.configs: dict[str, Any] = {}
        self.created = 0
        self.dns_created = 0
        self.writes = 0
        self.lose_after = 0
        self.offline = False
        self.bad_readback = False

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if self.offline:
            raise httpx.ConnectError("test outage")
        path = request.url.path
        method = request.method
        data = json.loads(request.content) if request.content else {}
        result: Any = None
        if path.endswith("/cfd_tunnel"):
            if method == "GET":
                result = [
                    t for t in self.tunnels.values() if t["name"] == request.url.params["name"]
                ]
            else:
                self.created += 1
                tid = str(uuid4())
                self.tunnels[tid] = {"id": tid, **data}
                result = self.tunnels[tid]
        elif "/dns_records" in path:
            if method == "GET":
                result = self.records.copy()
            elif method == "POST":
                self.dns_created += 1
                record = {"id": str(uuid4()), **data}
                self.records.append(record)
                result = record
            else:
                self.records = [r for r in self.records if r["id"] != path.split("/")[-1]]
                result = {}
        elif path.endswith("/configurations"):
            tid = path.split("/")[-2]
            if method == "PUT":
                self.configs[tid] = data
            result = {} if self.bad_readback else self.configs[tid]
        elif path.endswith("/token"):
            result = "test-installation-token-not-an-account-secret"
        elif path.endswith("/connections"):
            result = {}
        elif method == "DELETE":
            self.tunnels.pop(path.split("/")[-1], None)
            result = {}
        else:
            raise AssertionError("Unexpected provider route")
        if method != "GET":
            self.writes += 1
            if self.writes == self.lose_after:
                raise httpx.ReadTimeout("test lost response after successful write")
        return httpx.Response(200, json={"success": True, "result": result})


def setup_control(tmp_path: Path) -> tuple[RemoteControl, FakeCloudflare]:
    config = ControlConfig(
        account_id="a" * 32,
        zone_id="b" * 32,
        hostname="remote.example.com",
        api_token_file=tmp_path / "account-token",
        control_dir=tmp_path / "control",
        installation_dir=tmp_path / "installation",
    )
    fake = FakeCloudflare()
    client = httpx.Client(
        base_url="https://api.cloudflare.com/client/v4", transport=httpx.MockTransport(fake)
    )
    return RemoteControl(config, CloudflareProvider(config, client)), fake


def test_fresh_enable_retry_disable_reenable_persisted(tmp_path: Path) -> None:
    control, fake = setup_control(tmp_path)
    first = control.apply("enable")
    desired = read_desired(control.desired_path)
    assert first["phase"] == "enabled" and desired.enabled
    # Windows synthesizes st_mode from the read-only attribute, so the POSIX
    # permission bits are meaningless there; privacy comes from the profile
    # directory ACL. Assert the same contract the product code enforces.
    assert not is_group_or_world_readable(control.token_path)
    assert not is_group_or_world_readable(control.desired_path)
    for _ in range(3):
        assert RemoteControl(control.config, control.provider).apply("enable") == first
    assert fake.created == fake.dns_created == 1
    configuration = next(iter(fake.configs.values()))["config"]
    assert configuration["ingress"] == [
        {"hostname": "remote.example.com", "service": "http://127.0.0.1:8766"},
        {"service": "http_status:404"},
    ]
    assert configuration["warp-routing"]["enabled"] is False
    assert "account-token" not in control.desired_path.read_text()
    assert control.apply("disable")["phase"] == "disabled"
    disabled = read_desired(control.desired_path)
    assert not disabled.enabled and not control.token_path.exists()
    assert disabled.public_origin == "https://remote.example.com"
    assert disabled.port == 8766
    assert not fake.records and not fake.tunnels
    control.apply("disable")
    second = control.apply("enable")
    assert second["installation"] == first["installation"]
    assert second["tunnel_id"] != first["tunnel_id"]
    assert read_desired(control.desired_path).generation != desired.generation


@pytest.mark.parametrize("cut", [1, 2, 3])
def test_lost_create_configure_dns_response_reconciles_without_duplicates(
    tmp_path: Path, cut: int
) -> None:
    control, fake = setup_control(tmp_path)
    fake.lose_after = cut
    with pytest.raises(ProviderError):
        control.apply("enable")
    assert not read_desired(control.desired_path).enabled
    assert control.apply("enable")["phase"] == "enabled"
    assert fake.created == fake.dns_created == 1


@pytest.mark.parametrize("cut", [4, 5, 6, 7])
def test_lost_disable_responses_reconcile_and_stay_closed(tmp_path: Path, cut: int) -> None:
    control, fake = setup_control(tmp_path)
    control.apply("enable")
    fake.lose_after = cut
    with pytest.raises(ProviderError):
        control.apply("disable")
    assert not read_desired(control.desired_path).enabled
    assert not control.token_path.exists()
    with pytest.raises(ProviderError, match="disable"):
        control.apply("enable")
    assert control.apply("disable")["phase"] == "disabled"
    assert not fake.tunnels and not fake.records


def test_network_outage_disable_is_local_first(tmp_path: Path) -> None:
    control, fake = setup_control(tmp_path)
    control.apply("enable")
    fake.offline = True
    with pytest.raises(ProviderError):
        control.apply("disable")
    assert not read_desired(control.desired_path).enabled
    assert not control.token_path.exists()
    fake.offline = False
    control.apply("disable")
    assert not fake.tunnels and not fake.records


def test_ownership_and_configuration_fail_closed(tmp_path: Path) -> None:
    control, fake = setup_control(tmp_path)
    fake.records = [{"name": "remote.example.com", "id": "foreign"}]
    with pytest.raises(ProviderError, match="owned"):
        control.apply("enable")
    assert fake.created == 0 and len(fake.records) == 1
    fake.records = []
    fake.bad_readback = True
    with pytest.raises(ProviderError, match="read-back"):
        control.apply("enable")
    assert not read_desired(control.desired_path).enabled
    fake.bad_readback = False
    control.apply("enable")
    fake.records[0]["comment"] = "foreign"
    with pytest.raises(ProviderError, match="unowned"):
        control.apply("disable")
    assert len(fake.records) == 1 and not read_desired(control.desired_path).enabled


def test_parallel_enable_is_serialized(tmp_path: Path) -> None:
    control, fake = setup_control(tmp_path)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: control.apply("enable"), range(4)))
    assert all(result == results[0] for result in results)
    assert fake.created == fake.dns_created == 1


def test_binding_change_refused_and_bad_control_file_disabled(tmp_path: Path) -> None:
    control, _ = setup_control(tmp_path)
    control.apply("enable")
    changed = control.config.model_copy(update={"hostname": "other.example.com"})
    with pytest.raises(ProviderError, match="Configuration changed"):
        RemoteControl(changed, control.provider).apply("enable")
    control.desired_path.write_text('{"enabled":"true"}')
    assert not read_desired(control.desired_path).enabled
    with pytest.raises(ValueError):
        ControlConfig.model_validate({**control.config.model_dump(), "remote_port": 8765})
    with pytest.raises(ValueError):
        ControlConfig.model_validate(
            {
                **control.config.model_dump(),
                "api_token_file": control.config.installation_dir / "account-token",
            }
        )
