from __future__ import annotations

import time
from pathlib import Path

from stagepilot.remote_feature import RemoteFeature
from stagepilot.remote_files import read_desired
from stagepilot.remote_quick import QuickConnector
from test_remote_server import unused_port


def test_quick_child_lifecycle_without_account_token(tmp_path: Path) -> None:
    binary = tmp_path / "quick-substitute"
    binary.write_text(
        "#!/usr/bin/python3\n"
        "import sys,time\n"
        "assert '--url' in sys.argv and '--token-file' not in sys.argv\n"
        "print('https://substitute.trycloudflare.com', flush=True)\n"
        "time.sleep(60)\n"
    )
    binary.chmod(0o700)
    feature = RemoteFeature(tmp_path / "remote.json", unused_port())
    feature.set_enabled(True)
    connector = QuickConnector(binary, feature, unused_port())
    try:
        connector.step()
        deadline = time.monotonic() + 3
        while not connector.url and time.monotonic() < deadline:
            time.sleep(0.01)
        connector.step()
        assert read_desired(feature.control).enabled
        assert feature.status()["state"] == "reconnecting"  # No real edge/ingress health.
        assert feature.status()["url"] is None
        assert connector.process is not None
        first = connector.process.pid
        connector.process.kill()
        connector.process.wait(timeout=5)
        connector.step()
        assert not read_desired(feature.control).enabled
        connector.retry_at = 0
        connector.step()
        assert connector.process is not None and connector.process.pid != first
        feature.set_enabled(False)
        connector.step()
        assert connector.process is None
        assert not read_desired(feature.control).enabled
        assert feature.status()["state"] == "off"
    finally:
        connector.stop()


def test_missing_binary_is_safe_product_error(tmp_path: Path) -> None:
    feature = RemoteFeature(tmp_path / "remote.json")
    feature.set_enabled(True)
    connector = QuickConnector(tmp_path / "missing", feature, unused_port())
    connector.step()
    status = feature.status()
    assert status["state"] == "error" and status["url"] is None
    assert str(tmp_path) not in str(status)
    assert not read_desired(feature.control).enabled
