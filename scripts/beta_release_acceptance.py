"""Record and verify the signed private-beta native acceptance matrix."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from pathlib import Path

PLATFORMS = ("windows-x86_64", "darwin-aarch64", "darwin-x86_64")
CHECKS = (
    "local_health",
    "transparent_enrollment",
    "first_operator",
    "https_wss_roles",
    "restart_recovery",
    "reboot_recovery",
    "disable_reenable_provider_cleanup",
    "updater_discovery",
    "updater_install_relaunch",
    "final_cleanup",
)
VERSION = re.compile(r"^\d+\.\d+\.\d+-beta\.\d+$")
SENSITIVE = re.compile(r"bearer|credential|password|secret|token=|[?&](?:key|sig|token)=", re.I)
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def installer_name(platform: str, version: str) -> str:
    names = {
        "windows-x86_64": f"StagePilot_{version}_x64-setup.exe",
        "darwin-aarch64": f"StagePilot_{version}_aarch64.dmg",
        "darwin-x86_64": f"StagePilot_{version}_x64.dmg",
    }
    return names[platform]


def load(path: Path) -> dict:
    return json.loads(path.read_text()) if path.exists() else {"schema": 1, "platforms": {}}


def save(path: Path, report: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def record_installer(report: dict, platform: str, version: str, installer: Path) -> None:
    if platform not in PLATFORMS or not VERSION.fullmatch(version):
        raise ValueError("invalid platform or beta version")
    if not installer.is_file() or installer.stat().st_size < 1:
        raise ValueError("installer must be a non-empty file")
    if installer.name != installer_name(platform, version):
        raise ValueError("installer filename does not match platform and version")
    row = {"version": version, "filename": installer.name, "size": installer.stat().st_size, "sha256": digest(installer)}
    target = report["platforms"].setdefault(platform, {"installers": [], "checks": {}})
    target["installers"] = [item for item in target["installers"] if item["version"] != version] + [row]


def record_check(report: dict, platform: str, check: str, evidence: str) -> None:
    if platform not in PLATFORMS or check not in CHECKS:
        raise ValueError("invalid platform or check")
    if not evidence or len(evidence) > 256 or SENSITIVE.search(evidence):
        raise ValueError("evidence must be a short secret-free receipt")
    target = report["platforms"].setdefault(platform, {"installers": [], "checks": {}})
    target["checks"][check] = {"passed": True, "evidence": evidence}


def verify(report: dict, from_version: str, to_version: str) -> list[str]:
    failures = []
    if not isinstance(report, dict):
        return ["report must be an object"]
    if report.get("schema") != 1:
        failures.append("unsupported report schema")
    if not VERSION.fullmatch(from_version) or not VERSION.fullmatch(to_version) or from_version == to_version:
        failures.append("invalid update version pair")
    platforms = report.get("platforms")
    if not isinstance(platforms, dict):
        return failures + ["platforms must be an object"]
    unexpected_platforms = set(platforms) - set(PLATFORMS)
    if unexpected_platforms:
        failures.append(f"unexpected platforms: {','.join(sorted(unexpected_platforms))}")
    for platform in PLATFORMS:
        target = platforms.get(platform, {})
        if not isinstance(target, dict):
            failures.append(f"{platform}: invalid platform record")
            continue
        installers = target.get("installers", [])
        if not isinstance(installers, list):
            failures.append(f"{platform}: installers must be an array")
            installers = []
        versions = []
        for item in installers:
            if not isinstance(item, dict):
                failures.append(f"{platform}: invalid installer record")
                continue
            version = item.get("version")
            versions.append(version)
            if version in (from_version, to_version):
                if item.get("filename") != installer_name(platform, version):
                    failures.append(f"{platform}: invalid installer filename {version}")
                if type(item.get("size")) is not int or item["size"] < 1:
                    failures.append(f"{platform}: invalid installer size {version}")
                if not isinstance(item.get("sha256"), str) or not SHA256.fullmatch(item["sha256"]):
                    failures.append(f"{platform}: invalid installer hash {version}")
        expected_versions = (from_version, to_version)
        if len(versions) != 2 or any(versions.count(version) != 1 for version in expected_versions) \
                or any(version not in expected_versions for version in versions):
            failures.append(f"{platform}: installer inventory must contain exactly both update versions")
        for version in (from_version, to_version):
            if version not in versions:
                failures.append(f"{platform}: missing installer {version}")
        checks = target.get("checks", {})
        if not isinstance(checks, dict):
            failures.append(f"{platform}: checks must be an object")
            checks = {}
        unexpected_checks = set(checks) - set(CHECKS)
        if unexpected_checks:
            failures.append(f"{platform}: unexpected checks: {','.join(sorted(unexpected_checks))}")
        for check in CHECKS:
            receipt = checks.get(check, {})
            evidence = receipt.get("evidence") if isinstance(receipt, dict) else None
            if not isinstance(receipt, dict) or receipt.get("passed") is not True:
                failures.append(f"{platform}: missing {check}")
            elif not isinstance(evidence, str) or not evidence or len(evidence) > 256 or SENSITIVE.search(evidence):
                failures.append(f"{platform}: invalid evidence for {check}")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    subparsers = parser.add_subparsers(dest="command", required=True)
    installer = subparsers.add_parser("installer")
    installer.add_argument("--platform", choices=PLATFORMS, required=True)
    installer.add_argument("--version", required=True)
    installer.add_argument("--file", type=Path, required=True)
    check = subparsers.add_parser("check")
    check.add_argument("--platform", choices=PLATFORMS, required=True)
    check.add_argument("--name", choices=CHECKS, required=True)
    check.add_argument("--evidence", required=True)
    validate = subparsers.add_parser("verify")
    validate.add_argument("--from-version", required=True)
    validate.add_argument("--to-version", required=True)
    args = parser.parse_args()
    report = load(args.report)
    if args.command == "installer":
        record_installer(report, args.platform, args.version, args.file)
        save(args.report, report)
    elif args.command == "check":
        record_check(report, args.platform, args.name, args.evidence)
        save(args.report, report)
    else:
        failures = verify(report, args.from_version, args.to_version)
        print(json.dumps({"passed": not failures, "failures": failures}))
        return 1 if failures else 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
