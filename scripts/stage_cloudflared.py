"""Download and checksum the pinned cloudflared desktop runtime."""

from __future__ import annotations

import argparse
import hashlib
import io
import os
import platform
import shutil
import tarfile
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path

VERSION = "2026.9.1"
ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "desktop" / "src-tauri" / "resources"


@dataclass(frozen=True)
class Asset:
    name: str
    sha256: str
    executable_name: str
    archive: bool = False


ASSETS = {
    ("darwin", "x86_64"): Asset(
        "cloudflared-darwin-amd64.tgz",
        "ff0d3b51d5ff70eceef89d6b32145fee985018a2174596a5dbe405e2766e2ac4",
        "cloudflared",
        True,
    ),
    ("darwin", "arm64"): Asset(
        "cloudflared-darwin-arm64.tgz",
        "c27ab8fd0aa489449e3d201eb02f957ef460a13b613662928b1b23394bf1bcfe",
        "cloudflared",
        True,
    ),
    ("windows", "amd64"): Asset(
        "cloudflared-windows-amd64.exe",
        "2837888cc0f5d58f15b6dc478376de90b4d3ba5241c7947455d1e0a0df429712",
        "cloudflared.exe",
    ),
    ("windows", "x86_64"): Asset(
        "cloudflared-windows-amd64.exe",
        "2837888cc0f5d58f15b6dc478376de90b4d3ba5241c7947455d1e0a0df429712",
        "cloudflared.exe",
    ),
}


def host_asset() -> Asset:
    key = (platform.system().casefold(), platform.machine().casefold())
    try:
        return ASSETS[key]
    except KeyError as exc:
        raise SystemExit(f"cloudflared is not configured for {key[0]} {key[1]}") from exc


def download(asset: Asset) -> bytes:
    url = f"https://github.com/cloudflare/cloudflared/releases/download/{VERSION}/{asset.name}"
    request = urllib.request.Request(url, headers={"User-Agent": "StagePilot-build"})
    with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310 - fixed HTTPS host
        value = response.read()
    actual = hashlib.sha256(value).hexdigest()
    if actual != asset.sha256:
        raise SystemExit(f"cloudflared checksum mismatch for {asset.name}")
    return value


def executable(asset: Asset, payload: bytes) -> bytes:
    if not asset.archive:
        return payload
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
        members = [member for member in archive.getmembers() if member.isfile()]
        if len(members) != 1 or Path(members[0].name).name != "cloudflared":
            raise SystemExit("cloudflared archive layout was unexpected")
        extracted = archive.extractfile(members[0])
        if extracted is None:
            raise SystemExit("cloudflared archive did not contain its executable")
        return extracted.read()


def stage(asset: Asset) -> Path:
    payload = executable(asset, download(asset))
    DESTINATION.mkdir(parents=True, exist_ok=True)
    destination = DESTINATION / asset.executable_name
    descriptor, temporary_name = tempfile.mkstemp(prefix=".cloudflared-", dir=DESTINATION)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.chmod(0o755)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    if shutil.which(str(destination)) is None and os.name != "nt":
        raise SystemExit("staged cloudflared is not executable")
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate the pinned host mapping only")
    args = parser.parse_args()
    asset = host_asset()
    if args.check:
        print(f"cloudflared {VERSION}: {asset.name} -> {asset.executable_name}")
        return
    destination = stage(asset)
    print(f"Staged checksummed cloudflared {VERSION}: {destination.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
