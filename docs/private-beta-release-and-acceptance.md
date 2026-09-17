# Private beta release and native acceptance plan

## Delivery decision as shipped (release 1)

Two operator decisions changed the delivery shape after the analysis below was
written, and they are what release 1 actually ships:

1. **In-app update is off for the beta.** No `STAGEPILOT_RELEASE_TOKEN` is
   issued and the release broker is **not** deployed. The updater code,
   allowlisting, and `latest.json` generation all stay implemented, tested in
   CI, and promotable — they are deferred, not removed.
2. **`huntrw6/stagepilot-beta` is temporarily public**, so the release page and
   its assets are readable without any GitHub credential, and hosted
   Windows/macOS Actions minutes are free.

Therefore release 1 is distributed as a **direct GitHub Release download**:
testers open the release page and download the installer for their platform.
`latest.json` is still generated, signature-validated, and published with the
release because it is the same artifact a future promoted release depends on,
but nothing consumes it during the beta. See
[`native-completion-runbook.md`](native-completion-runbook.md) for the
authoritative PROVEN/DEFERRED ledger.

The analysis below remains accurate for the private-repository case and is what
the broker implementation is built against; it applies again the moment the
repository is made private or the updater is switched on.

## Delivery decision and evidence (private-repository analysis)

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

Linux jobs in `.github/workflows/*.yml` use exactly
`runs-on: [self-hosted, stagepilot-linux]`. This includes backend, frontend,
MultiTracks, Linux-compatible Cargo/Tauri checks, release source validation,
release manifest/publication logic, control-plane verification/deployment, live
transparent-enrollment acceptance, and revocation. The normal bootstrap actions
`actions/checkout`, `actions/setup-node`, and `astral-sh/setup-uv` remain allowed
on that runner.

Windows x64 packaging and macOS arm64/x64 packaging/lifecycle jobs now run on
GitHub-hosted `windows-latest`, `macos-15`, and `macos-15-intel` runners: the
repository is temporarily public, so hosted Actions minutes on standard
runners are free and unlimited, removing the need for native self-hosted
machines. See [`native-completion-runbook.md`](native-completion-runbook.md)
for the current PROVEN/DEFERRED status of the native build/sign/publish path.

Validate this boundary with a YAML parser before enabling repository Actions:

```sh
python3 scripts/validate_workflow_runners.py
```

The initial activation was proven by self-hosted CI run
`35029964844`: all four active Linux jobs completed on `stagepilot-ci`, while
the preserved Windows and macOS jobs skipped without acquiring a runner.

## Deterministic versions and assets

The earlier failed release attempts already occupy immutable tags
`v1.1.103-beta.1` (bootstrap failure), `v1.1.103-beta.2` (failed on a
cross-platform mypy defect and an unusable signing key), `v1.1.103-beta.3`
(failed because `backend/uv.lock` recorded a stale project version, so every
`uv sync --locked` step aborted), `v1.1.103-beta.4` (failed on five
Windows-only backend test failures that only the release job's full pytest run
exercises) and `v1.1.103-beta.5` (all three signed builds succeeded, but the
publish step called the `gh` CLI, which is not installed on the self-hosted
Linux runner), so **release 1 is `v1.1.103-beta.6`** and the next available
version is `v1.1.103-beta.7`. Never move or reuse any of these tags/versions.

Each release staging directory must contain exactly:

- `StagePilot_VERSION_aarch64.dmg`
- `StagePilot_VERSION_x64.dmg`
- `StagePilot_VERSION_aarch64.app.tar.gz` and `.sig`
- `StagePilot_VERSION_x64.app.tar.gz` and `.sig`
- `StagePilot_VERSION_x64-setup.exe` and `.sig`
- `latest.json`
- `release-notes.md`

Run `node scripts/audit_beta_release.mjs source` before release and `node scripts/audit_beta_release.mjs assets RELEASE_ASSETS VERSION` after building. Preserve the JSON output as the asset-size/SHA-256 inventory. Standalone `.sig` files are staging inputs and remain omitted from user-facing GitHub assets because their contents are embedded in `latest.json`.

## Release 1 — shipped

**`v1.1.103-beta.6` is published.**

| | |
|---|---|
| Release URL | https://github.com/huntrw6/stagepilot-beta/releases/tag/v1.1.103-beta.6 |
| Release ID | `390773788` |
| Tag commit | `e7af35a7c2e9e0bd53cec90eacb77c0511699058` |
| Published | 2026-09-17T14:09:10Z |
| Build/publish run | https://github.com/huntrw6/stagepilot-beta/actions/runs/35229334636 |
| Exact-head CI | https://github.com/huntrw6/stagepilot-beta/actions/runs/35227555657 (8/8 green) |
| Updater key id | `9DAF99548D6D7D77` |

Published asset inventory, SHA-256 (standalone `.sig` files are intentionally
absent; their contents are embedded in `latest.json`):

| Asset | Bytes | SHA-256 |
|---|---|---|
| `StagePilot_1.1.103-beta.6_x64-setup.exe` | 54,334,610 | `49253fe72f5180a5ddf4072c3dc7396ee04c3ec3f4a42ea4d5a0e6f574a92fc1` |
| `StagePilot_1.1.103-beta.6_aarch64.dmg` | 61,582,282 | `6ada3997ccafce0e16e3379747767363fc16a8679dc5801fd8b79355a4faadba` |
| `StagePilot_1.1.103-beta.6_x64.dmg` | 64,718,555 | `b7ce0ecaf75ceb0fed302a9dcf87a740dac13a3300417d3f6e76dac17d83643a` |
| `StagePilot_1.1.103-beta.6_aarch64.app.tar.gz` | 61,504,698 | `855926c9aa08cb1aea6931defe13966aed76f497fe0964dde1e73b07db45e949` |
| `StagePilot_1.1.103-beta.6_x64.app.tar.gz` | 64,527,503 | `c760790e2e92fd2ce84b187d2b41f1b5953e02bafeb577b669c773fb4c9412e3` |
| `latest.json` | 3,623 | `9d05519d8e5346cba38b1b543ca4f0f57d20fcdd5541a01cc963d8b941585dad` |

Verified after publication by unauthenticated download (no token, exactly as a
tester or an installed client would fetch): every asset returned HTTP 200, and
each of the three updater signatures in `latest.json` verifies against the
public key embedded in `desktop/src-tauri/tauri.conf.json`, while a tampered
artifact is rejected. `huntrw6/stagepilot` was confirmed unchanged at
`f58f91ee320e13d956ff97473e83df4c23199653`, still on v1.1.102.

## Friend download instructions

While `huntrw6/stagepilot-beta` is public, a tester needs no invitation and no
GitHub account: send them the exact immutable release URL and tell them to
download only the installer matching their platform.

- Windows x64: `StagePilot_1.1.103-beta.6_x64-setup.exe`
- macOS Apple Silicon: `StagePilot_1.1.103-beta.6_aarch64.dmg`
- macOS Intel: `StagePilot_1.1.103-beta.6_x64.dmg`

The `.app.tar.gz` archives are updater payloads, not downloads — testers should
ignore them. In-app update is off for this beta, so a newer build is delivered
as a new release and a fresh installer download.

If the repository is made private again, first invite each tester with read
access; the same release URL then requires them to sign in to GitHub.

Send the matching SHA-256 value from the preserved asset inventory alongside the
release URL, and have the tester compare the download hash before installing.
Never send a PAT, updater signing material, machine evidence, or a control-plane
credential.

There is **no in-app update in this beta**: the Update button has no deployed
broker to talk to, so a later build is delivered the same way — a new immutable
tag, a new release, and a fresh download. Testers never need GitHub credentials
inside StagePilot.

## Signing recovery and rollback

The updater signing key was regenerated **twice** on 2026-09-17, both times
before any release published an asset, so no installed client ever trusted a
retired public key.

1. The original `TAURI_SIGNING_PRIVATE_KEY` was an RSA PEM keypair, not a
   Tauri/minisign key, so `tauri build` could never sign with it (`failed to
   decode base64 secret key`). That material is retained, unused, under
   `~/.tauri/legacy-rsa-unusable/`.
2. Its minisign replacement (key id `ED8D8193966AB83F`) was **exposed and is
   permanently retired**. `tauri signer --help` prints the resolved value of
   every option that has an `env:` binding, so invoking it while
   `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` were
   exported echoed both the encrypted private key and its password into the
   terminal transcript. The material is archived, unused, under
   `~/.tauri/exposed-2026-09-17/`.

The current key (id `9DAF99548D6D7D77`) is a real `rsign`/minisign Ed25519
keypair generated with the password read from disk and never placed in the
environment. Its public half is embedded in
`desktop/src-tauri/tauri.conf.json`, and it was proven to sign a disposable
payload, verify against that embedded public key, and reject a tampered payload
before the repository secrets were rotated to match.

> **Never run `tauri signer --help` (or any `tauri signer` subcommand with
> `--help`) while the signing environment variables are exported.** The CLI
> renders secret values inline in its help text. Pass the key by path with `-f`
> and the password by `-p "$(cat …)"`, and keep the variables out of the
> environment entirely.

Before each release, verify without printing values that GitHub contains `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, the configured updater public key is not a placeholder, and two independently recoverable encrypted offline copies of the private key/password exist. On an isolated local copy, sign a disposable file with the recovered key and verify it with the configured public key using the pinned Tauri CLI. Delete the disposable file. Never rotate the updater key between beta releases; installed clients trust only the embedded public key.

> **Outstanding operator action:** the current private key and its password live
> only at `~/.tauri/stagepilot-updater.key` and
> `~/.tauri/stagepilot-updater.password` on the release host. Take two
> independently recoverable encrypted offline backups before distributing
> release 1 widely.

If the signing key is lost, no future build can be accepted by an installed
updater-enabled copy. Recovery is then a new key plus a fresh installer
download by every tester — which is why two independently recoverable offline
copies are required before release 1, not after.

Rollback for this beta is distribution-side only, because the broker is not
deployed and no client polls for updates:

- Keep the bad tag and release immutable. Never delete, move, or reuse a version.
- Unpublish the bad release with `gh release edit TAG --repo huntrw6/stagepilot-beta --draft`, which hides it from the Releases page while preserving the tag and assets for audit.
- Fix the problem, bump to the next version, publish a new release, and point all download instructions at the new tag.

Only if the broker is later deployed does the variable-based rollback apply: set `BETA_LATEST_RELEASE_VERSION` back to the last known-good allowlisted version, redeploy, and read the Worker back; keep the broken tag immutable but remove it from `BETA_RELEASE_VERSIONS` once affected clients have a newer recovery path. The beta broker does not alter Remote installation state.

## Native acceptance matrix

Use fresh isolated accounts/machines for:

- Windows x64
- macOS arm64 12+
- macOS x64 12+

For each platform, record the release-1 installer:

```text
python scripts/beta_release_acceptance.py --report PRIVATE_REPORT installer --platform PLATFORM --version 1.1.103-beta.6 --file INSTALLER
```

Install beta 1 and record secret-free receipts for every release-1 check name: `local_health`, `transparent_enrollment`, `first_operator`, `https_wss_roles`, `restart_recovery`, `reboot_recovery`, `disable_reenable_provider_cleanup`, and `final_cleanup`. Use:

```text
python scripts/beta_release_acceptance.py --report PRIVATE_REPORT check --platform PLATFORM --name CHECK --evidence "short local receipt"
```

`updater_discovery`, `updater_install_relaunch`, and the two-release `verify --from-version … --to-version …` gate are **not part of release 1** — they belong to the deferred update-acceptance path and need a second release that this beta does not publish.

The operator must observe: installer hash/version; loopback local health; no-auth transparent enrollment; exactly one first Operator; Viewer/Operator HTTPS and WSS policy; app/connector restart; actual machine reboot; disable, re-enable with a new generation, and exact provider cleanup; then revocation/removal of disposable DNS, tunnel, sessions, credentials, test users, installers, and private evidence as policy requires. The harness rejects obvious credential-bearing evidence strings but the operator must still inspect the report before sharing it.

No local mock, CI build, service restart, or prior Linux/LXC proof substitutes for this physical matrix.

## Native completion runbook and status ledger

The exact, ordered, copy-pasteable commands that finish release 1 and release 2
the moment a native self-hosted runner is registered — including runner labels,
required secrets, tag names, expected assets, and read-back checks — plus the
authoritative PROVEN-on-Linux versus DEFERRED ledger, live in
[`native-completion-runbook.md`](native-completion-runbook.md). Treat that file
as the single source of truth for what has actually been validated; never
present a DEFERRED item there as proven.
