"""Local-only Remote provisioning CLI; account secrets never enter installations."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Literal
from uuid import uuid4

import httpx
from pydantic import BaseModel, Field

from stagepilot.file_lock import exclusive_lock
from stagepilot.remote_files import (
    ControlConfig,
    DesiredRemote,
    atomic_write,
    is_group_or_world_readable,
)
from stagepilot.remote_provider import CloudflareProvider, ProviderError, TunnelProvider


class ProvisionState(BaseModel):
    installation: str = Field(default_factory=lambda: str(uuid4()))
    generation: str = ""
    phase: Literal["disabled", "enabling", "enabled", "revoking"] = "disabled"
    binding: dict[str, str | int] = Field(default_factory=dict)
    tunnel_id: str = ""


class RemoteControl:
    def __init__(self, config: ControlConfig, provider: TunnelProvider) -> None:
        self.config = config
        self.provider = provider
        self.state_path = config.control_dir / "state.json"
        self.desired_path = config.installation_dir / "remote.json"
        self.token_path = config.installation_dir / "connector.token"

    def apply(self, action: str) -> dict[str, object]:
        self.config.control_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        with exclusive_lock(self.config.control_dir / "control.lock"):
            return self._apply(action)

    def _apply(self, action: str) -> dict[str, object]:
        try:
            state = (
                ProvisionState.model_validate_json(self.state_path.read_text())
                if self.state_path.exists()
                else ProvisionState()
            )
        except (OSError, ValueError):
            if action == "disable":
                atomic_write(self.desired_path, DesiredRemote().model_dump_json())
                self.token_path.unlink(missing_ok=True)
            raise
        binding: dict[str, str | int] = {
            "account": self.config.account_id,
            "zone": self.config.zone_id,
            "hostname": self.config.hostname,
            "port": self.config.remote_port,
            "export": str(self.config.installation_dir),
        }
        if state.binding and state.binding != binding:
            raise ProviderError("Configuration changed; preserve the original control state")
        state.binding = binding
        if action == "status":
            return {
                "phase": state.phase,
                "installation": state.installation,
                "hostname": self.config.hostname,
                "tunnel_id": state.tunnel_id,
            }
        if action not in {"enable", "disable"}:
            raise ValueError("Unknown Remote operation")
        if action == "enable":
            if state.phase == "revoking":
                raise ProviderError("Finish retrying disable before re-enabling")
            if state.phase == "disabled":
                state.generation = str(uuid4())
                state.phase = "enabling"
                atomic_write(
                    self.desired_path,
                    DesiredRemote(
                        public_origin=f"https://{self.config.hostname}",
                        port=self.config.remote_port,
                    ).model_dump_json(),
                )
            atomic_write(self.state_path, state.model_dump_json())
            name = f"stagepilot-{state.installation}-{state.generation}"
            tunnel_id, token = self.provider.ensure(
                name, self.config.hostname, self.config.remote_port
            )
            atomic_write(self.token_path, token)
            atomic_write(
                self.desired_path,
                DesiredRemote(
                    enabled=True,
                    generation=state.generation,
                    public_origin=f"https://{self.config.hostname}",
                    port=self.config.remote_port,
                ).model_dump_json(),
            )
            state.tunnel_id = tunnel_id
            state.phase = "enabled"
        else:
            # Journal intent first so an interrupted disable cannot be mistaken
            # for an idempotent enable of the old installation generation.
            if state.phase != "disabled":
                state.phase = "revoking"
                atomic_write(self.state_path, state.model_dump_json())
            # Local fail-closed state always precedes remote network revocation.
            # Keep only the non-secret stable-origin marker for future UI requests.
            atomic_write(
                self.desired_path,
                DesiredRemote(
                    public_origin=f"https://{self.config.hostname}",
                    port=self.config.remote_port,
                ).model_dump_json(),
            )
            self.token_path.unlink(missing_ok=True)
            if state.phase == "revoking":
                self.provider.revoke(
                    f"stagepilot-{state.installation}-{state.generation}", self.config.hostname
                )
            state.phase = "disabled"
            state.tunnel_id = ""
        atomic_write(self.state_path, state.model_dump_json())
        return {
            "phase": state.phase,
            "installation": state.installation,
            "hostname": self.config.hostname,
            "tunnel_id": state.tunnel_id,
        }


def run() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["enable", "disable", "status"])
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    try:
        config = ControlConfig.model_validate_json(args.config.read_text())
        # Never accept account secrets on command lines or print provider bodies.
        token = ""
        if args.action != "status":
            try:
                if is_group_or_world_readable(config.api_token_file):
                    raise ProviderError("Account token file must be private (0600)")
                token = config.api_token_file.read_text().strip()
                if not token or any(c.isspace() for c in token):
                    raise ProviderError("Account token file is invalid")
            except (OSError, ProviderError):
                if args.action != "disable":
                    raise
                # Still perform the local disable before remote revocation fails.
                token = ""
        with httpx.Client(
            base_url="https://api.cloudflare.com/client/v4",
            headers={"Authorization": f"Bearer {token}"},
            timeout=20,
            trust_env=False,
            follow_redirects=False,
        ) as client:
            result = RemoteControl(config, CloudflareProvider(config, client)).apply(args.action)
        print(json.dumps(result))
    except (OSError, ValueError, ProviderError):
        # Validation errors may echo secret input; intentionally don't stringify.
        parser.exit(1, "Remote operation incomplete; check private configuration and retry.\n")


if __name__ == "__main__":
    run()
