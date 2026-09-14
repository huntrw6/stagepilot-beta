"""Quick transport adapter for the existing independent connector service."""

from __future__ import annotations

import os
import re
import socket
import subprocess
import threading
import time
from pathlib import Path
from uuid import uuid4

import httpx

from stagepilot.remote_feature import RemoteFeature
from stagepilot.remote_files import DesiredRemote, atomic_write, safe_status


class QuickConnector:
    def __init__(self, binary: Path, feature: RemoteFeature, metrics_port: int) -> None:
        self.binary = binary
        self.feature = feature
        self.metrics_port = metrics_port
        self.process: subprocess.Popen[bytes] | None = None
        self.reader: threading.Thread | None = None
        self.url: str | None = None
        self.generation = ""
        self.listener_generation = ""
        self.retry_at = 0.0
        self.delay = 1.0
        self.started_at = 0.0
        self.rate_limited = False

    def stop(self) -> None:
        if self.process is not None:
            self.process.terminate() if self.process.poll() is None else None
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
            if self.reader:
                self.reader.join(timeout=2)
            self.process = None
        self.url = None

    def capture(self, process: subprocess.Popen[bytes]) -> None:
        assert process.stdout is not None
        # Bound reads; discard all raw output rather than retain provider diagnostics.
        while line := process.stdout.readline(4096):
            if b"status 429" in line and self.process is process:
                self.rate_limited = True
            match = re.search(rb"https://[a-z0-9-]+\.trycloudflare\.com\b", line)
            if match and self.process is process:
                self.url = match.group().decode("ascii")
        process.stdout.close()

    def step(self) -> None:
        with self.feature.locked():
            intent = self.feature.intent()
            if intent.generation != self.generation or not intent.enabled:
                self.stop()
                self.generation = intent.generation
                self.retry_at = 0
                self.delay = 1
                self.rate_limited = False
                atomic_write(self.feature.control, DesiredRemote().model_dump_json())
            state = "off"
            available = self.binary.is_file() and os.access(self.binary, os.X_OK)
            if intent.enabled:
                state = "enabling"
                if self.process and self.process.poll() is not None:
                    self.stop()
                    atomic_write(self.feature.control, DesiredRemote().model_dump_json())
                    self.retry_at = time.monotonic() + self.delay
                    self.delay = min(30, self.delay * 2)
                if self.rate_limited:
                    self.stop()
                    atomic_write(self.feature.control, DesiredRemote().model_dump_json())
                    state = "error"
                elif not available:
                    state = "error"
                elif self.process is None and time.monotonic() >= self.retry_at:
                    try:
                        with socket.create_server(("127.0.0.1", self.metrics_port)):
                            pass
                        self.process = subprocess.Popen(
                            [
                                str(self.binary),
                                "tunnel",
                                "--config",
                                "/dev/null",
                                "--no-autoupdate",
                                "--metrics",
                                f"127.0.0.1:{self.metrics_port}",
                                "--url",
                                f"http://127.0.0.1:{intent.port}",
                            ],
                            stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT,
                            env={"PATH": os.defpath, "HOME": str(self.feature.control.parent)},
                        )
                        self.started_at = time.monotonic()
                        self.listener_generation = str(uuid4())
                        self.reader = threading.Thread(
                            target=self.capture, args=(self.process,), daemon=True
                        )
                        self.reader.start()
                    except OSError:
                        self.retry_at = time.monotonic() + self.delay
                        self.delay = min(30, self.delay * 2)
                        state = "error"
                if self.url:
                    desired = DesiredRemote(
                        enabled=True,
                        generation=self.listener_generation,
                        public_origin=self.url,
                        port=intent.port,
                    )
                    if self.feature.control.read_text() != desired.model_dump_json():
                        atomic_write(self.feature.control, desired.model_dump_json())
                    state = "reconnecting"
                    try:
                        with httpx.Client(timeout=1, trust_env=False) as client:
                            edge = client.get(f"http://127.0.0.1:{self.metrics_port}/ready")
                            local = client.get(
                                f"http://127.0.0.1:{intent.port}/api/v1/access",
                                headers={"X-Forwarded-Proto": "https"},
                            )
                            if edge.status_code == 200 and local.status_code == 200:
                                state = "connected"
                                self.delay = 1
                    except httpx.HTTPError:
                        pass
                elif self.process and time.monotonic() - self.started_at > 60:
                    self.stop()
                    self.retry_at = time.monotonic() + 30
                    state = "error"
                elif self.process is None:
                    state = "error"
            safe_status(
                self.feature.status_path,
                state=state,
                available=available,
                checked_at=time.time(),
                generation=intent.generation,
                url=self.url if state == "connected" else None,
            )
