#!/usr/bin/env python3
"""Semantically validate that active Actions jobs stay on StagePilot runners."""

from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
LINUX_LABELS = ["self-hosted", "stagepilot-linux"]
DISABLED = "${{ false }}"
HOSTED_LABEL = re.compile(r"^(?:ubuntu|windows|macos)-", re.IGNORECASE)
REQUIRED_ACTIONS = {
    "actions/checkout",
    "actions/setup-node",
    "astral-sh/setup-uv",
}
EXPECTED_DEFERRED = {
    "ci.yml:desktop",
    "ci.yml:desktop-macos-lifecycle",
    "release-macos.yml:build",
    "release-windows.yml:build",
}


def labels(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return value
    raise AssertionError(f"runs-on must be a string or string list, got {value!r}")


def main() -> None:
    active: list[str] = []
    deferred: list[str] = []
    actions: set[str] = set()

    workflow_paths = sorted(WORKFLOWS.glob("*.yml"))
    assert workflow_paths, "no workflows found"

    for workflow_path in workflow_paths:
        document = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))
        assert isinstance(document, dict), f"{workflow_path.name}: workflow must be a mapping"
        jobs = document.get("jobs")
        assert isinstance(jobs, dict) and jobs, f"{workflow_path.name}: jobs must be a mapping"

        for job_id, job in jobs.items():
            assert isinstance(job, dict), f"{workflow_path.name}:{job_id}: job must be a mapping"
            key = f"{workflow_path.name}:{job_id}"
            job_labels = labels(job.get("runs-on"))
            for label in job_labels:
                assert not HOSTED_LABEL.match(label), f"{key}: hosted runner label is forbidden: {label}"

            if job.get("if") == DISABLED:
                deferred.append(key)
                assert str(job.get("name", "")).startswith("DEFERRED —"), (
                    f"{key}: disabled native job name must make deferral explicit"
                )
                assert "self-hosted" in job_labels, f"{key}: native definition must remain self-hosted"
                assert any(
                    label.startswith(("stagepilot-windows-", "stagepilot-macos-"))
                    or "matrix.runner" in label
                    for label in job_labels
                ), f"{key}: deferred job must name a future StagePilot native runner"
            else:
                active.append(key)
                assert job_labels == LINUX_LABELS, (
                    f"{key}: active job must use exactly {LINUX_LABELS}, got {job_labels}"
                )

            for step in job.get("steps", []):
                if isinstance(step, dict) and isinstance(step.get("uses"), str):
                    actions.add(step["uses"].split("@", 1)[0])

    assert set(deferred) == EXPECTED_DEFERRED, (
        f"deferred native inventory changed: expected {sorted(EXPECTED_DEFERRED)}, got {deferred}"
    )
    missing_actions = REQUIRED_ACTIONS - actions
    assert not missing_actions, f"required bootstrap actions are no longer allowed/present: {sorted(missing_actions)}"

    print(json.dumps({"active_self_hosted_jobs": active, "deferred_native_jobs": deferred}, indent=2))


if __name__ == "__main__":
    main()
