"""Independent connector supervisor; no production runtime or account secrets."""

from __future__ import annotations

import argparse
import json
import os
import signal
import socket
import subprocess
import threading
import time
from collections.abc import Callable
from pathlib import Path

import httpx

from stagepilot.remote_files import DesiredRemote, read_desired, safe_status


class Connector:
    def __init__(
        self,
        binary: Path,
        control: Path,
        status: Path,
        metrics_port: int,
        token_provider: Callable[[], str] | None = None,
        token_path: Path | None = None,
    ) -> None:
        self.binary = binary
        self.control = control
        self.status = status
        self.metrics_port = metrics_port
        self.token_provider = token_provider
        self.token_path = token_path or control.with_name("connector.token")
        self.process: subprocess.Popen[bytes] | None = None
        self.desired = DesiredRemote()
        self.retry_at = 0.0
        self.delay = 1.0

    def stop(self) -> None:
        if self.process is not None:
            if self.process.poll() is None:
                self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
            self.process = None
        if self.token_provider is not None:
            self.token_path.unlink(missing_ok=True)

    def step(self) -> None:
        desired = read_desired(self.control)
        token = self.token_path
        if desired != self.desired:
            self.stop()
            self.desired = desired
            self.retry_at = 0
            self.delay = 1
        if not desired.enabled:
            self.stop()
            safe_status(self.status, state="disabled", checked_at=time.time())
            return
        if self.process is not None and self.process.poll() is not None:
            self.process = None
            self.retry_at = time.monotonic() + self.delay
            self.delay = min(self.delay * 2, 30)
        if self.process is None and time.monotonic() >= self.retry_at:
            try:
                if self.token_provider is not None:
                    token_arguments = ["--token", self.token_provider()]
                else:
                    if token.is_symlink() or not token.is_file() or token.stat().st_mode & 0o077:
                        raise OSError("Installation token is missing or not private")
                    token_arguments = ["--token-file", str(token)]
                # Do not mistake another local service's /ready for our connector.
                with socket.create_server(("127.0.0.1", self.metrics_port)):
                    pass
                self.process = subprocess.Popen(
                    [
                        str(self.binary),
                        "tunnel",
                        "--no-autoupdate",
                        "--metrics",
                        f"127.0.0.1:{self.metrics_port}",
                        "run",
                        *token_arguments,
                    ],
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    env={"PATH": os.defpath, "HOME": str(self.control.parent)},
                )
            except OSError:
                if self.token_provider is not None:
                    token.unlink(missing_ok=True)
                self.retry_at = time.monotonic() + self.delay
                self.delay = min(self.delay * 2, 30)
        healthy = False
        if self.process is not None:
            try:
                with httpx.Client(timeout=1, trust_env=False) as client:
                    healthy = (
                        client.get(f"http://127.0.0.1:{self.metrics_port}/ready").status_code == 200
                    )
            except httpx.HTTPError:
                pass
        healthy = healthy and self.process is not None and self.process.poll() is None
        if healthy:
            self.delay = 1
        safe_status(
            self.status,
            state="connected" if healthy else "reconnecting",
            checked_at=time.time(),
            pid=self.process.pid if self.process else None,
            generation=desired.generation,
        )


def run() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--control-file", type=Path, required=True)
    parser.add_argument("--status-file", type=Path, required=True)
    parser.add_argument("--metrics-port", type=int, default=18767)
    args = parser.parse_args()
    if not all(p.is_absolute() for p in (args.binary, args.control_file, args.status_file)):
        parser.error("Paths must be absolute")
    if not 1024 <= args.metrics_port <= 65535:
        parser.error("Metrics port must be unprivileged")
    stop = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop.set())
    connector = Connector(args.binary, args.control_file, args.status_file, args.metrics_port)
    from stagepilot.remote_feature import RemoteFeature
    from stagepilot.remote_quick import QuickConnector

    feature = RemoteFeature(args.control_file)
    quick = QuickConnector(args.binary, feature, args.metrics_port)
    try:
        while not stop.is_set():
            try:
                desired = read_desired(args.control_file)
                intent = feature.intent()
                named = bool(desired.public_origin)
                if feature.intent_path.exists() and intent.enabled and not named:
                    connector.stop()
                    quick.step()
                    safe_status(
                        args.status_file,
                        state="disabled" if not feature.intent().enabled else "reconnecting",
                        checked_at=time.time(),
                    )
                else:
                    quick.stop()
                    connector.step()
                    if feature.intent_path.exists():
                        state = "off"
                        url = None
                        if intent.enabled:
                            state = "enabling"
                            if desired.enabled:
                                try:
                                    current = json.loads(args.status_file.read_text())
                                    if current.get("generation") == desired.generation:
                                        candidate = current.get("state")
                                        if candidate in {"connected", "reconnecting"}:
                                            state = candidate
                                except (OSError, ValueError, TypeError):
                                    pass
                                if state == "connected":
                                    url = desired.public_origin
                        safe_status(
                            feature.status_path,
                            state=state,
                            available=args.binary.is_file(),
                            checked_at=time.time(),
                            generation=intent.generation,
                            url=url,
                            temporary_url=False,
                        )
                    else:
                        safe_status(
                            feature.status_path,
                            state="off",
                            available=args.binary.is_file(),
                            checked_at=time.time(),
                        )
            except (OSError, ValueError):
                connector.stop()  # Bad/unwritable state cannot keep public access alive.
                quick.stop()
            stop.wait(0.5)
    finally:
        quick.stop()
        connector.stop()
        safe_status(args.status_file, state="stopped", checked_at=time.time())


if __name__ == "__main__":
    run()
