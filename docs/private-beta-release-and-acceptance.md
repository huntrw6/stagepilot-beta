# Private beta release and native acceptance plan

## Delivery decision and evidence

An installed Tauri client cannot directly consume a release in the private `huntrw6/stagepilot-beta` repository without a GitHub credential. On 2026-09-15, unauthenticated GET requests to both the browser download URL for `latest.json` and `GET /repos/huntrw6/stagepilot-beta/releases/latest` returned 404. GitHub documents that only people with repository read access can view releases, and its release-asset API uses authenticated API requests for private resources. Tauri accepts a static JSON endpoint or update server and always verifies updater payload signatures; verification cannot be disabled.

References:

- https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases
- https://docs.github.com/en/rest/releases/assets
- https://v2.tauri.app/plugin/updater/

A PAT must never ship in StagePilot. Beta release builds instead use the existing beta control plane only for:

- `GET /v1/releases/latest.json`
- `GET /v1/releases/vVERSION/StagePilot_VERSION_PLATFORM-UPDATER`

The Worker holds a `GITHUB_RELEASE_TOKEN` runtime secret, populated by the
environment-scoped GitHub Actions secret `STAGEPILOT_RELEASE_TOKEN` (GitHub
reserves the `GITHUB_` prefix). That token must have read-only Contents access to
only `huntrw6/stagepilot-beta`. The broker accepts only versions in
`BETA_RELEASE_VERSIONS`, exposes `latest.json` only for
`BETA_LATEST_RELEASE_VERSION`, and permits only five exact release filenames:
two DMGs, two Tauri macOS updater archives, and the Windows installer/updater.
It rejects drafts, duplicates, foreign asset API URLs, truncated or oversized
assets, and fetches by immutable release tag and GitHub asset ID. Metadata
caches for at most five minutes; immutable payloads advertise a one-year cache.
Per canonical source address, the Durable Object allows 30 metadata requests or
6 downloads per minute and bounds retained source windows at 2,000. The broker
has no arbitrary URL, hostname, method, or Remote-traffic relay route. Tauri
still verifies the embedded signature with the existing public key.

The base Tauri configuration retains the main `huntrw6/stagepilot` endpoint. Only the Windows release and macOS release overlays select the beta broker. This prevents a normal/main build from following beta metadata and prevents a beta release build from following main releases.

## CI runner boundary

All active jobs in `.github/workflows/*.yml` use exactly
`runs-on: [self-hosted, stagepilot-linux]`. This includes backend, frontend,
MultiTracks, Linux-compatible Cargo/Tauri checks, release source validation,
release manifest/publication logic, control-plane verification/deployment, live
transparent-enrollment acceptance, and revocation. The normal bootstrap actions
`actions/checkout`, `actions/setup-node`, and `astral-sh/setup-uv` remain allowed
on that runner.

Windows x64 packaging and macOS arm64/x64 packaging/lifecycle jobs remain in the
workflows for later native self-hosted machines, but each is named `DEFERRED` and
has the unambiguous job condition `if: ${{ false }}`. Their future labels are
`stagepilot-windows-x64`, `stagepilot-macos-arm64`, and
`stagepilot-macos-x64`; none is a GitHub-hosted label. A tag push can run Linux
release source/security validation, but the deferred native build causes the
dependent publication job to skip, so a tag cannot publish an incomplete native
release. Do not remove the disabled condition or claim native validation until
matching self-hosted machines exist and the physical acceptance matrix passes.

Validate this boundary with a YAML parser before enabling repository Actions:

```sh
python3 scripts/validate_workflow_runners.py
```

The initial activation was proven by self-hosted CI run
`35029964844`: all four active Linux jobs completed on `stagepilot-ci`, while
the preserved Windows and macOS jobs skipped without acquiring a runner.

## Deterministic versions and assets

The earlier failed release attempt already occupies immutable tag
`v1.1.103-beta.1`, so release 1 is `v1.1.103-beta.2` and release 2 is
`v1.1.103-beta.3`. Never move or reuse any of these tags/versions.

Each release staging directory must contain exactly:

- `StagePilot_VERSION_aarch64.dmg`
- `StagePilot_VERSION_x64.dmg`
- `StagePilot_VERSION_aarch64.app.tar.gz` and `.sig`
- `StagePilot_VERSION_x64.app.tar.gz` and `.sig`
- `StagePilot_VERSION_x64-setup.exe` and `.sig`
- `latest.json`
- `release-notes.md`

Run `node scripts/audit_beta_release.mjs source` before release and `node scripts/audit_beta_release.mjs assets RELEASE_ASSETS VERSION` after building. Preserve the JSON output as the asset-size/SHA-256 inventory. Standalone `.sig` files are staging inputs and remain omitted from user-facing GitHub assets because their contents are embedded in `latest.json`.

## Friend download instructions

Invite each tester to the private `huntrw6/stagepilot-beta` repository with read
access. The tester must sign in to GitHub, open the exact immutable beta release,
and download only the installer matching their platform:

- Windows x64: `StagePilot_VERSION_x64-setup.exe`
- macOS Apple Silicon: `StagePilot_VERSION_aarch64.dmg`
- macOS Intel: `StagePilot_VERSION_x64.dmg`

Send the release URL and the matching SHA-256 value from the preserved asset
inventory through the approved private channel. The tester must compare the
download hash before installation and must not forward the private asset URL or
installer. Never send a PAT, updater signing material, machine evidence, or a
control-plane credential. Installed beta builds obtain later signed updates from
the beta broker; testers do not need GitHub credentials inside StagePilot.

## Signing recovery and rollback

Before release 1, verify without printing values that GitHub contains `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, the configured updater public key is not a placeholder, and two independently recoverable encrypted offline copies of the private key/password exist. On an isolated local copy, sign a disposable file with the recovered key and verify it with the configured public key using the pinned Tauri CLI. Delete the disposable file. Do not rotate the updater key for release 2; existing clients trust only the embedded public key.

If a release is bad, immediately set `BETA_LATEST_RELEASE_VERSION` back to the last known-good allowlisted version and redeploy/read back the Worker. Keep the broken tag immutable but remove it from `BETA_RELEASE_VERSIONS` after affected clients have a newer recovery path. Publish a higher version; never replace signed artifacts or reuse a version. The beta broker does not alter Remote installation state.

## Native acceptance matrix

Use fresh isolated accounts/machines for:

- Windows x64
- macOS arm64 12+
- macOS x64 12+

For each platform, record both release installers first:

```text
python scripts/beta_release_acceptance.py --report PRIVATE_REPORT installer --platform PLATFORM --version 1.1.103-beta.2 --file INSTALLER
python scripts/beta_release_acceptance.py --report PRIVATE_REPORT installer --platform PLATFORM --version 1.1.103-beta.3 --file INSTALLER
```

Install beta 1 and record secret-free receipts for every check name: `local_health`, `transparent_enrollment`, `first_operator`, `https_wss_roles`, `restart_recovery`, `reboot_recovery`, `disable_reenable_provider_cleanup`, `updater_discovery`, `updater_install_relaunch`, and `final_cleanup`. Use:

```text
python scripts/beta_release_acceptance.py --report PRIVATE_REPORT check --platform PLATFORM --name CHECK --evidence "short local receipt"
python scripts/beta_release_acceptance.py --report PRIVATE_REPORT verify --from-version 1.1.103-beta.2 --to-version 1.1.103-beta.3
```

The operator must observe: installer hash/version; loopback local health; no-auth transparent enrollment; exactly one first Operator; Viewer/Operator HTTPS and WSS policy; app/connector restart; actual machine reboot; disable, re-enable with a new generation, and exact provider cleanup; beta 2 discovery; signed download/install/relaunch with version read-back; then revocation/removal of disposable DNS, tunnel, sessions, credentials, test users, installers, and private evidence as policy requires. The harness rejects obvious credential-bearing evidence strings but the operator must still inspect the report before sharing it.

No local mock, CI build, service restart, or prior Linux/LXC proof substitutes for this physical matrix.
