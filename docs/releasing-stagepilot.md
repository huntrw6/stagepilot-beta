# Releasing StagePilot

The tag-triggered `.github/workflows/release-macos.yml` is the coordinated
Windows x64, Intel macOS, and Apple Silicon macOS release pipeline. Its
historical filename is retained to avoid creating a competing pipeline. It
publishes `latest.json` only after every referenced updater artifact and
signature is available.

The macOS community release is ad-hoc signed without Hardened Runtime; it does
not require Apple Developer ID or notarization. See
[macOS ad-hoc signing](macos-adhoc-signing.md).

## Private beta channel

The beta ships from `huntrw6/stagepilot-beta` only; never tag, push, or release
`huntrw6/stagepilot` for a beta. Four earlier attempts already burned immutable
tags — `v1.1.103-beta.1` (bootstrap failure), `v1.1.103-beta.2` (failed on a
cross-platform mypy defect and an unusable signing key), `v1.1.103-beta.3`
(failed because `backend/uv.lock` carried a stale project version, so every
`uv sync --locked` step aborted) and `v1.1.103-beta.4` (failed on five
Windows-only backend test failures) — so release 1 is
`v1.1.103-beta.5`. Follow
[the private beta release and acceptance plan](private-beta-release-and-acceptance.md)
and the authoritative
[native completion runbook](native-completion-runbook.md).

In-app update is **off for this beta by operator decision**: the release broker
is not deployed and no `STAGEPILOT_RELEASE_TOKEN` is issued. Distribution is the
direct GitHub Release download. The beta Windows/macOS release overlays still
point at the narrowly allowlisted control-plane broker endpoint and `latest.json`
is still generated and signature-validated, so the path stays promotable, but
nothing consumes it during the beta. The base/main configuration keeps the
public main release endpoint, so a main build never follows beta metadata and a
beta build never follows main releases. Never put a GitHub PAT in Tauri,
frontend code, or an artifact.

## One-time updater key setup

Generate the long-term key outside the repository. This prompts for a password:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.tauri"
npm --prefix desktop exec -- tauri signer generate -w "$env:USERPROFILE\.tauri\stagepilot-updater.key"
```

Copy the complete contents of `stagepilot-updater.key.pub`—not its path—into
`desktop/src-tauri/tauri.conf.json` as `plugins.updater.pubkey`, replacing
`STAGEPILOT_UPDATER_PUBLIC_KEY_REQUIRED`.

Keep `stagepilot-updater.key` and its password in a secure offline backup.
Never commit them. Losing the key prevents installed updater-enabled copies
from accepting future updates.

Configure GitHub without printing either secret:

```powershell
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo huntrw6/stagepilot-beta < "$env:USERPROFILE\.tauri\stagepilot-updater.key"
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo huntrw6/stagepilot-beta
```

The second command prompts securely. The release fails before building if
either secret is absent. The private key is never passed to frontend code.

## Publication

1. Update versions in Tauri config, Cargo, desktop/frontend packages, backend
   package, backend runtime settings, and backend `__version__`.
2. Update `CHANGELOG.md`.
3. Run:

   ```powershell
   node scripts/validate_versions.mjs vX.Y.Z
   uv run --project backend ruff format --check backend/src backend/tests
   uv run --project backend ruff check backend/src backend/tests
   uv run --project backend python -m mypy --config-file backend/pyproject.toml backend/src backend/tests
   uv run --project backend python -m pytest -c backend/pyproject.toml backend/tests
   npm --prefix frontend run lint
   npm --prefix frontend run typecheck
   npm --prefix frontend test -- --run
   npm --prefix frontend run build
   cargo fmt --manifest-path desktop/src-tauri/Cargo.toml --check
   cargo clippy --manifest-path desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
   cargo test --manifest-path desktop/src-tauri/Cargo.toml
   cargo check --manifest-path desktop/src-tauri/Cargo.toml
   ```

4. Commit and push reviewed source.
5. Tag the exact version and push it:

   ```powershell
   git tag -a vX.Y.Z -m "StagePilot X.Y.Z"
   git push origin main
   git push origin vX.Y.Z
   ```

6. Watch **Release StagePilot**. It validates configuration and tests, builds
   native `darwin-aarch64`, `darwin-x86_64`, and `windows-x86_64` artifacts,
   verifies the final `.app`, DMG, and updater archive by starting their packaged
   backends, keeps the release draft, generates and validates `latest.json`,
   uploads user-facing installers and updater payloads, uploads `latest.json`
   last, then publishes the release. Standalone `.sig` files remain internal
   build inputs because their contents are embedded in `latest.json`.

Never substitute a checksum for a Tauri signature. The macOS updater payload is
`.app.tar.gz`, not the `.dmg`.

## Bootstrap and two-update test

Use three new versions: bootstrap X.Y.0, then X.Y.1 and X.Y.2. Manually install
and approve X.Y.0. Confirm no button while current. Publish X.Y.1, confirm the
button is beside the logo, cancel once to prove no download starts, then accept
and observe unattended progress/relaunch. Verify version, button disappearance,
success message, visibility, focus, window geometry, maximized/fullscreen
state, and quarantine/signing output. Repeat with X.Y.2.

Record results on both Intel and Apple Silicon Macs. The workflow cannot prove
Gatekeeper behavior without this hardware test.
