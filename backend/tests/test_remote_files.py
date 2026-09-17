from __future__ import annotations

import sys
from pathlib import Path

import pytest

from stagepilot.remote_files import atomic_write, is_group_or_world_readable


def test_private_file_is_not_reported_as_exposed(tmp_path: Path) -> None:
    secret = tmp_path / "connector.token"
    atomic_write(secret, "spi_test.token")
    if sys.platform != "win32":
        secret.chmod(0o600)
    assert not is_group_or_world_readable(secret)


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX permission bits only")
def test_group_or_world_readable_file_is_reported_as_exposed(tmp_path: Path) -> None:
    secret = tmp_path / "connector.token"
    atomic_write(secret, "spi_test.token")
    secret.chmod(0o644)
    assert is_group_or_world_readable(secret)


@pytest.mark.skipif(sys.platform != "win32", reason="Windows st_mode synthesis only")
def test_windows_synthesized_mode_never_reports_exposure(tmp_path: Path) -> None:
    # Windows derives st_mode from the read-only attribute alone, so a normal
    # file reports 0o666 and a raw `st_mode & 0o077` test would reject every
    # file. Privacy there comes from the per-user profile directory ACL.
    secret = tmp_path / "connector.token"
    atomic_write(secret, "spi_test.token")
    assert secret.stat().st_mode & 0o077
    assert not is_group_or_world_readable(secret)
