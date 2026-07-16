"""Build and stage the Python backend using Tauri's target-triple naming."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
BINARIES = ROOT / "desktop" / "src-tauri" / "binaries"


def run(*command: str, cwd: Path = ROOT, capture: bool = False) -> str:
    result = subprocess.run(
        command,
        cwd=cwd,
        check=True,
        text=True,
        stdout=subprocess.PIPE if capture else None,
    )
    return result.stdout.strip() if capture else ""


def rust_host_target() -> str:
    details = run("rustc", "-vV", capture=True)
    for line in details.splitlines():
        if line.startswith("host: "):
            return line.removeprefix("host: ").strip()
    raise RuntimeError("rustc did not report a host target triple.")


def main() -> None:
    uv = shutil.which("uv")
    if uv is None:
        raise SystemExit("uv is required to build the StagePilot backend sidecar.")

    run(
        uv,
        "run",
        "--isolated",
        "--project",
        str(BACKEND),
        "--extra",
        "packaging",
        "--locked",
        "pyinstaller",
        "--clean",
        "--noconfirm",
        "--distpath",
        str(BACKEND / "dist"),
        "--workpath",
        str(BACKEND / "build" / "pyinstaller"),
        str(BACKEND / "stagepilot.spec"),
        cwd=BACKEND,
    )

    extension = ".exe" if os.name == "nt" else ""
    source = BACKEND / "dist" / f"stagepilot-backend{extension}"
    if not source.is_file():
        raise SystemExit(f"PyInstaller did not produce {source}.")

    BINARIES.mkdir(parents=True, exist_ok=True)
    destination = BINARIES / f"stagepilot-backend-{rust_host_target()}{extension}"
    shutil.copy2(source, destination)
    print(f"Staged Tauri sidecar: {destination.relative_to(ROOT)}")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        raise SystemExit(exc.returncode) from exc
