# Releasing StagePilot

The tag-triggered `.github/workflows/release-macos.yml` is the coordinated
Windows x64, Intel macOS, and Apple Silicon macOS release pipeline. Its
historical filename is retained to avoid creating a competing pipeline. It
publishes `latest.json` only after every referenced updater artifact and
signature is available.

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
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo huntrw6/stagepilot < "$env:USERPROFILE\.tauri\stagepilot-updater.key"
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo huntrw6/stagepilot
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
   keeps the release draft, uploads archives and `.sig` files, generates and
   validates `latest.json`, uploads it last, then publishes the release.

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
