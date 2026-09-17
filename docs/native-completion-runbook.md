# Native completion runbook and PROVEN/DEFERRED ledger

This is the single authoritative source for (a) exactly what the self-hosted
Linux runner `stagepilot-ci` has actually proven, (b) what remains DEFERRED and
precisely what evidence each deferred item still needs, and (c) the exact
ordered commands that finish private beta release 1 — the only release this
beta ships — the moment a native self-hosted runner is registered. The in-app
updater, release 2, and the release broker are deferred by operator choice;
see "Deferred by operator choice" below.

Nothing in this file may be presented as validated unless it appears under
PROVEN with a CI run URL. See
[`private-beta-release-and-acceptance.md`](private-beta-release-and-acceptance.md)
for the delivery decision and
[`private-beta-enrollment-and-guardrails.md`](private-beta-enrollment-and-guardrails.md)
for the guardrail thresholds.

## Runner inventory

| Label | Machine | Status |
|---|---|---|
| `stagepilot-linux` | `stagepilot-ci` (Linux X64) | Registered and online (self-hosted, stays self-hosted) |
| `windows-latest` | GitHub-hosted | Available — public repo, unlimited free minutes on standard runners |
| `macos-15` | GitHub-hosted | Available — public repo, unlimited free minutes on standard runners |
| `macos-15-intel` | GitHub-hosted | Available — public repo, unlimited free minutes on standard runners |

`huntrw6/stagepilot-beta` is **temporarily public** so that GitHub-hosted
Windows/macOS Actions minutes are free and unlimited on standard runners.
This is what unblocks the native path below without spending any paid
allowance. The repository will be made private again later once the native
path is proven; whoever reads this after that should not be surprised that
the native jobs ran on hosted runners while the repo was public.

Linux jobs use exactly `runs-on: [self-hosted, stagepilot-linux]` and must
never move to a hosted `ubuntu-*` runner. Native Windows/macOS jobs use
GitHub-hosted `windows-*`/`macos-*` labels. Enforced by parsed YAML in
`scripts/validate_workflow_runners.py`, which runs in CI and fails if a
Linux job drifts to a hosted `ubuntu-*` label, if a native job's `runs-on`
isn't a hosted `windows-*`/`macos-*` label, or if the native job inventory
changes.

## PROVEN on self-hosted Linux

Each row is backed by a CI run on `stagepilot-ci`. Re-read state with `gh`
rather than trusting this table alone.

| # | Capability | Proof |
|---|---|---|
| P1 | Backend, frontend, MultiTracks CLI, and Linux desktop-shell checks (Cargo fmt/check/test) | `ci.yml` jobs `backend`, `frontend`, `multitracks-cues`, `desktop-linux-checks` |
| P2 | Runner boundary: Linux jobs never move to a hosted `ubuntu-*` runner; native job inventory unchanged | `ci.yml:desktop-linux-checks` → `scripts/validate_workflow_runners.py` |
| P3 | `latest.json` generation and schema/date/version validation | `ci.yml:updater-chain` → `scripts/updater_chain_proof.mjs` |
| P4 | Signature embedding taken from the `.sig` sidecar, never invented | same |
| P5 | Missing artifact, missing signature, and empty signature each abort before publication | same |
| P6 | Tag/version agreement; non-HTTPS and query/fragment endpoints refused | same |
| P7 | Beta-vs-main channel isolation in both directions | same |
| P8 | Path-escape and dropped-platform manifests rejected by the validator | same |
| P9 | Updater public key is configured and is not a placeholder; base config keeps the main endpoint while both release overlays select the broker | same |
| P10 | Release-broker allowlisting (versions and exact filenames), foreign-asset-URL rejection, oversized/truncated asset rejection, redirect-hosting confinement, metadata/download cache headers, and independent per-source download rate limits | `ci.yml:updater-chain` → `npm --prefix control-plane test` (25 tests) |
| P11 | Release workflow ordering: signing secrets required, source audit, exact-tag source match, `latest.json` uploaded last, standalone `.sig` never published, immutable tags never clobbered | `ci.yml:updater-chain` → `npm --prefix desktop run release:test` |
| P12 | Control-plane enrollment, isolation, quota, provider-lane, and fail-closed behaviour at unit level | `ci.yml:updater-chain` → `npm --prefix control-plane test` |
| P13 | Zero Cloudflare residue: no `sp-<id>.<suffix>` DNS record and no `stagepilot-<id>-<generation>` tunnel survives an acceptance run | `sweep-control-plane-residue.yml` (report mode) |
| P14 | Release-1 dry run at `main`/`8ce2da9`: `validate_versions.mjs v1.1.103-beta.2`, `audit_beta_release.mjs source` (428 tracked files, zero leaks), `npm --prefix desktop run release:test` (15/15) pass without tagging or publishing | manual local run on this host, see "Release 1 dry run" below |
| P15 | Live enrollment/guardrail acceptance against the deployed Worker: transparent enrollment, idempotent nonce replay, isolated machine credentials, per-installation status quota with `retry-after`, two-tunnel HTTPS isolation, edge HTTPS/WSS abuse limits actually tripped and an unrelated zone host unaffected, zero disposable residue after cleanup | `prepare-control-plane-live-acceptance.yml` run [`35176046446`](https://github.com/huntrw6/stagepilot-beta/actions/runs/35176046446) on `stagepilot-ci`, commit `4dadbaa`. The developer-network enrollment exemption (`ENROLLMENT_EXEMPT_SOURCES`, see `docs/private-beta-enrollment-and-guardrails.md`) is what removed the 3-per-24h enrollment-source quota as a scheduling constraint on `stagepilot-ci`'s own address. |
| P16 | Native compile/build proof on GitHub-hosted runners, repo now public: Windows x64 unsigned CI installer builds clean (the previously failing "Run packaged Remote lifecycle on Windows" pytest step now passes — the failure was specific to the retired self-hosted Windows setup, not a code defect) and macOS Apple Silicon + macOS Intel Cargo fmt/check/test lifecycle checks pass | `ci.yml` jobs `desktop`, `desktop-macos-lifecycle` on `main`/`3deba13`, run [`35195305370`](https://github.com/huntrw6/stagepilot-beta/actions/runs/35195305370): `Desktop installer — Windows x64` on `windows-latest` success, `Desktop lifecycle — macOS Apple Silicon` on `macos-15` success, `Desktop lifecycle — macOS Intel` on `macos-15-intel` success; artifact `stagepilot-windows-installer` (54,340,679 bytes) uploaded |

## DEFERRED — not proven, required for release 1, with the exact evidence still required

Never describe any of these as validated. D1 and D2 are narrowed by P16
above (unsigned Windows build and macOS compile/lifecycle checks are now
proven green on hosted runners) but not fully cleared: `ci.yml:desktop`
builds with `tauri.ci.conf.json`, which sets `createUpdaterArtifacts: false`
and produces an **unsigned** installer, and `ci.yml:desktop-macos-lifecycle`
only compiles and runs Cargo tests — it does not invoke `tauri build` to
produce a `.dmg`/`.app.tar.gz`. Real signed artifacts only come from
`release-macos.yml:build` and `release-windows.yml:build`, both gated behind
an existing release tag (`validate` job verifies `HEAD` matches
`refs/tags/$RELEASE_TAG`) — creating that tag and publishing the release is
explicitly Milestone C's job (card `t_1807ef4f`), not this card's, so this
card does not run them. D3–D8 remain in scope for the beta but need genuine
physical hardware and cannot be proven by CI.

| # | Item | Blocked by | Evidence required to clear it |
|---|---|---|---|
| D1 | Windows x64 installer builds **signed** | Release tag required by `release-windows.yml`/`release-macos.yml:validate`; tagging is Milestone C's job | `release-windows.yml:build` or `release-macos.yml:build` (Windows leg) green at a real tag, with a `.sig`-bearing `*-setup.exe` |
| D2 | macOS arm64/x64 `.app`, `.dmg`, and `.app.tar.gz` build, sign, and verify | Release tag required by `release-macos.yml:validate`; tagging is Milestone C's job | `release-macos.yml:build` (macOS legs) green at a real tag; `scripts/verify_macos_release_bundle.sh` passes `--app`, `--dmg`, `--archive` |
| D3 | Fresh-machine install on each platform | native hardware | `beta_release_acceptance.py installer` + `check --name local_health` receipts |
| D4 | No-auth transparent enrollment from an installed build | native hardware | `check --name transparent_enrollment` and `first_operator` receipts |
| D5 | Viewer/Operator HTTPS + WSS policy from an installed build | native hardware | `check --name https_wss_roles` receipt |
| D6 | App/connector restart and real machine reboot recovery | native hardware | `check --name restart_recovery`, `reboot_recovery` receipts |
| D7 | Disable, re-enable with a new generation, exact provider cleanup | native hardware | `check --name disable_reenable_provider_cleanup` receipt |
| D8 | Gatekeeper / SmartScreen behaviour on unsigned-publisher builds | native hardware | Recorded operator observation per platform |

### Developer-network enrollment exemption (cleared the former D9 scheduling constraint)

Live acceptance runs enroll installations and are subject to the same
production guardrail they verify: **3 new installations per canonical
source IPv4/IPv6-/64 per 24 hours** (`ENROLLMENTS_PER_SOURCE`). Because
`stagepilot-ci` always presents the same one or two developer-network
source addresses, this used to allow at most one full acceptance run per
24 hours and repeatedly stalled iteration on this runbook (see run
`35122372776`, 2026-09-16, exhausted at `enrollments=12`,
`enrollmentDenied` rising).

That scheduling constraint is now removed by an explicit, narrowly scoped
exemption rather than by weakening the guardrail: the optional Worker
variable `ENROLLMENT_EXEMPT_SOURCES` (see
`docs/private-beta-enrollment-and-guardrails.md` for the full mechanism,
security properties, and refresh procedure) lists this development
network's normalized IPv4 and IPv6-/64 sources. An exempt source skips
only the per-source enrollment quota; `ENROLLMENT_ENABLED`, the global
`BETA_INSTALLATION_LIMIT`, `MAX_SOURCE_QUOTAS` pressure, nonce idempotency,
and every downstream status/mutation/provider quota still apply in full,
and exempt enrollments still count toward `enrollments`/`activeInstallations`
so capacity stays observable. `ENROLLMENTS_PER_SOURCE` itself was not
changed. This must never list a beta user's address — only trusted
developer networks.

If this network's ISP-assigned addresses change, refresh the exemption:
read `https://cloudflare.com/cdn-cgi/trace` and
`curl -4 https://cloudflare.com/cdn-cgi/trace`, normalize the IPv6 address
to its `/64`, then `gh variable set ENROLLMENT_EXEMPT_SOURCES --repo
huntrw6/stagepilot-beta --env stagepilot-control-plane` with the updated
comma-separated list, and redeploy via `deploy-control-plane.yml`.

## Recovering a stranded disposable installation

The Worker's admin surface is deliberately aggregate-only and exposes no route
that enumerates installations, so a stranded installation ID cannot be listed
after the fact. The acceptance script therefore prints
`CLEANUP_RECEIPTS [...]` and, on failure, `STRANDED_INSTALLATIONS [...]` with
exact IDs.

1. Revoke each exact ID from the run log:

   ```sh
   gh workflow run revoke-control-plane-live-installation.yml \
     --repo huntrw6/stagepilot-beta --ref main -f installation=<32-hex-id>
   ```

2. Confirm no provider residue remains (this is the residue that costs money,
   holds DNS, or stays reachable):

   ```sh
   gh workflow run sweep-control-plane-residue.yml --repo huntrw6/stagepilot-beta \
     --ref main -f apply=report
   ```

3. Only if the report lists disposable objects, delete them:

   ```sh
   gh workflow run sweep-control-plane-residue.yml --repo huntrw6/stagepilot-beta \
     --ref main -f apply=apply
   ```

The sweep touches only `sp-<32 hex>.<REMOTE_HOST_SUFFIX>` DNS records and
`stagepilot-<32 hex>-<generation>` tunnels, and reads back to confirm removal.

### Known unrecoverable registry entries — 2 stranded, zero provider residue

The first acceptance attempt of 2026-09-16 (run `35119782474`, at commit
`33a39fe`, before the `badb3a4` fix) enrolled two installations and then died
on a TLS `unrecognized name` error during hostname activation. The script at
that commit appended to `installations` only *after* its assertions, so the
`finally` block had nothing to revoke and printed no receipts. Their exact IDs
were never emitted and the Worker exposes no enumeration route, so **they
cannot be recovered or revoked**. They are the persistent
`activeInstallations: 2` in every reading since.

This is bounded and costs nothing:

- Provider residue is **zero** — confirmed by direct Cloudflare reads at 16:41Z
  (run `35123422067`) and 17:02Z (run `35125995391`), both
  `disposableHostnames: []` and `disposableTunnels: []`. No DNS record is held,
  no tunnel is reachable, nothing bills.
- Both entries are `phase: disabled` with no provisioned generation; a stranded
  entry that never completed provisioning holds no provider object.
- `BETA_INSTALLATION_LIMIT` defaults to 500, so 2 entries do not approach the
  global enrollment ceiling.

`badb3a4` fixed the cause: enrollments are now registered for cleanup the
instant they succeed, revocation is retried, and IDs are printed
unconditionally, so no future run can strand an installation invisibly. Treat
the residual 2 as a permanent, harmless baseline offset — the residue check
asserts `activeInstallations` is **not greater than** its baseline for exactly
this reason, rather than asserting zero.

## Deferred by operator choice — required only when promoting to the stable public release repo

These are **not failures and not validated** because they are **out of scope
for the private beta**, not because anything about them is broken. The
operator has decided the in-app updater is off for the beta: it ships as a
directly downloaded installer, there is no release 2, no Update-button
acceptance, and no release-broker deployment. No `STAGEPILOT_RELEASE_TOKEN`
will be issued for the beta. The implementation stays intact and promotable —
nothing here was removed, only deferred.

| Item | Why it is deferred | What clears it |
|---|---|---|
| Release-broker deployment (`deploy-control-plane.yml` with `STAGEPILOT_RELEASE_TOKEN` set) | Operator decision: no release-download token will be issued for the beta | An operator decision to promote beyond the private beta, plus the token |
| Real signed `latest.json` served end to end and `GET /v1/releases/latest.json` returning the real tag | Depends on the broker being deployed | Broker deployment above |
| Release 2 (`v1.1.103-beta.6` or later) build/sign/publish | Operator decision: beta ships exactly one release | An operator decision to publish a second release |
| In-app update discovery, download, install, relaunch, and version read-back (`updater_discovery`, `updater_install_relaunch`, `verify --from-version … --to-version …`) | Depends on the broker and release 2, both deferred above | Broker deployment + release 2 |

## Bounded packaging smoke-test finding — blocked, do not pursue further

Investigated whether `stagepilot-ci` can run
`npm --prefix desktop run build:sidecar` (frontend build + backend
PyInstaller into `desktop/src-tauri/binaries/`), the chain shared with every
native build, so packaging regressions could surface before native hardware
arrives.

**Blocked.** `npm --prefix desktop run build:sidecar` fails on `stagepilot-ci`
at the PyInstaller step:

```
ERROR: Python shared library ('libpython3.12.so.1.0') was not found! If you
are using system python on Debian/Ubuntu, you might need to install a
separate package by running `apt install libpython3.12`.
```

This is a runner-environment gap, not a StagePilot code defect: `uv run
--isolated ... pyinstaller` builds an isolated Python 3.12 environment per
the project's `--extra packaging` spec, and PyInstaller's `--onefile`
bootloader needs to link the interpreter's shared library at build time. The
isolated `uv` build environment does not expose a linkable
`libpython3.12.so.1.0` to PyInstaller, even though a system Python 3.12 is
present on the runner (confirmed by the earlier `ci.yml` jobs using it
successfully for lint/mypy/pytest). Fixing it durably needs either a runner
package install (e.g. `libpython3-dev`) or reconfiguring `uv`'s managed
Python to link dynamically — both a runner-host change beyond what a normal
CI job does. Per the card's timebox, this was not pursued further: no system
package was installed, no runner host state was changed, and no Linux bundle
target was added.

Per-command results:

| Command | Result |
|---|---|
| `npm --prefix frontend run build` (part of `build:sidecar`) | Passes |
| `uv run --isolated --project backend --extra packaging --locked pyinstaller ...` (rest of `build:sidecar`, invoked by `scripts/build_backend_sidecar.py`) | **Fails**: `libpython3.12.so.1.0` not found in the isolated build env |
| `python scripts/stage_cloudflared.py` (the other half of `build:runtime`) | Exits non-zero by design — `linux x86_64` has no entry in `ASSETS`; StagePilot does not ship a Linux bundle, so this is expected and out of scope |

No CI job was added for this chain because it does not currently pass on
`stagepilot-ci`. Re-attempt once the runner host's `uv`-managed Python 3.12
toolchain includes (or is rebuilt with) a linkable shared library — that is
an operator/runner-provisioning action, not a code change.

---

# Native completion runbook

Execute top to bottom. Every command is copy-pasteable and requires no
rediscovery. Do not skip a read-back. This is exactly the release-1 native
path: enable native jobs on GitHub-hosted runners, confirm signing secrets,
build/sign/publish release 1, native acceptance for release 1, rollback. The
release-broker deploy, release 2, and update acceptance are out of scope — see
"Deferred by operator choice" above.

## Step 1 — Enable the native jobs

The native jobs now run on GitHub-hosted `windows-latest`/`macos-15`/
`macos-15-intel` runners since the repository is public. Remove the
`if: ${{ false }}` line from each job, point `runs-on` at the hosted label,
and update the runner-policy validator's expected native-job inventory to
match:

- `.github/workflows/ci.yml` → `desktop` (`windows-latest`)
- `.github/workflows/ci.yml` → `desktop-macos-lifecycle` (`macos-15` / `macos-15-intel`)
- `.github/workflows/release-macos.yml` → `build` (`macos-15` / `macos-15-intel` / `windows-latest`)
- `.github/workflows/release-windows.yml` → `build` (`windows-latest`)

Also drop the `DEFERRED — ` name prefix on each, restoring the original job
names. Change nothing else: do not alter a signing step, a secret reference,
the source audit, the immutable-tag guard, or the `latest.json` ordering.

Validate and push:

```sh
uv run --with PyYAML==6.0.3 python scripts/validate_workflow_runners.py
git add .github/workflows scripts/validate_workflow_runners.py
git commit -m "ci: enable native jobs now that self-hosted native runners exist"
git push beta HEAD:refs/heads/main
```

## Step 2 — Confirm the release-1 signing secrets exist

```sh
gh secret list --repo huntrw6/stagepilot-beta
```

Required for release 1, and never printed:

| Name | Scope | Purpose |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | repository | Signs updater artifacts |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | repository | Unlocks the signing key |

The beta control plane (enrollment/guardrails) is already live and unrelated
to these two secrets. `STAGEPILOT_RELEASE_TOKEN` and the release broker are
**deferred by operator choice** (see above) — do not set it and do not block
release 1 on it.

Verify the release allowlist variable before tagging:

```sh
gh variable get BETA_RELEASE_VERSIONS --repo huntrw6/stagepilot-beta --env stagepilot-control-plane
```

`BETA_RELEASE_VERSIONS` must include `1.1.103-beta.6`.

## Step 3 — Release 1: `v1.1.103-beta.6` — DONE

**Completed 2026-09-17.** Release 1 is published at
https://github.com/huntrw6/stagepilot-beta/releases/tag/v1.1.103-beta.6
(release id `390773788`) from commit
`e7af35a7c2e9e0bd53cec90eacb77c0511699058`, built and signed in run
https://github.com/huntrw6/stagepilot-beta/actions/runs/35229334636 after
exact-head CI run
https://github.com/huntrw6/stagepilot-beta/actions/runs/35227555657 passed all
eight jobs. The published inventory, SHA-256 hashes and post-publication
signature verification are recorded in
[`private-beta-release-and-acceptance.md`](private-beta-release-and-acceptance.md).
The next available version is `v1.1.103-beta.7`.

The procedure below is retained for the next release.

Set every application version to `1.1.103-beta.6`, then:

```sh
node scripts/set-release-version.mjs 1.1.103-beta.6
(cd backend && uv lock --check)   # must pass; see note below
node scripts/validate_versions.mjs v1.1.103-beta.6
node scripts/audit_beta_release.mjs source
git add -A
git commit -m "chore(release): StagePilot 1.1.103-beta.6"
git push beta HEAD:refs/heads/main
git tag -a v1.1.103-beta.6 -m "StagePilot 1.1.103-beta.6"
git push beta v1.1.103-beta.6
```

> **Why `uv lock --check` is mandatory.** `uv` records the project version in
> PEP 440 normalized form (`1.1.103b4`), not the semantic-version text
> (`1.1.103-beta.6`). `v1.1.103-beta.3` was burned because the version bump
> wrote the semver string into `backend/uv.lock`, leaving the lockfile stale, so
> the `uv sync --locked` step failed in every native job *after* the expensive
> toolchain install. `scripts/set-release-version.mjs` now normalizes correctly
> and `scripts/validate_versions.mjs` fails fast on any drift, on the cheap
> Linux `validate` job rather than on three native runners.

The tag push triggers `release-macos.yml`. Watch it:

```sh
gh run watch "$(gh run list --repo huntrw6/stagepilot-beta \
  --workflow release-macos.yml --limit 1 --json databaseId -q '.[0].databaseId')"
```

Expected published assets on the release (standalone `.sig` files are staging
inputs and are deliberately **not** published):

- `StagePilot_1.1.103-beta.6_aarch64.dmg`
- `StagePilot_1.1.103-beta.6_x64.dmg`
- `StagePilot_1.1.103-beta.6_aarch64.app.tar.gz`
- `StagePilot_1.1.103-beta.6_x64.app.tar.gz`
- `StagePilot_1.1.103-beta.6_x64-setup.exe`
- `latest.json`

Read back:

```sh
gh release view v1.1.103-beta.6 --repo huntrw6/stagepilot-beta \
  --json tagName,isDraft,assets -q '{tag:.tagName,draft:.isDraft,assets:[.assets[].name]}'
```

The release must be non-draft and must carry exactly the six assets above.
`latest.json` is generated for release-integrity purposes even though the
broker is not deployed — do not skip its generation or validation, since it
is the same artifact a future promoted release depends on. There is no
broker to read it back from in the beta: distribution is the direct
GitHub Release download, so users install straight from the release page.

## Step 4 — Native acceptance for release 1

On each of Windows x64, macOS arm64, and macOS x64, with a fresh account:

```sh
python scripts/beta_release_acceptance.py --report PRIVATE_REPORT installer \
  --platform PLATFORM --version 1.1.103-beta.6 --file INSTALLER
```

Then record every check name, one command each:

```sh
python scripts/beta_release_acceptance.py --report PRIVATE_REPORT check \
  --platform PLATFORM --name local_health --evidence "short local receipt"
```

Repeat for `transparent_enrollment`, `first_operator`, `https_wss_roles`,
`restart_recovery`, `reboot_recovery`, `disable_reenable_provider_cleanup`,
then `final_cleanup`. This clears D3–D7. Record a plain operator observation
for Gatekeeper/SmartScreen behaviour to clear D8. `updater_discovery` and
`updater_install_relaunch` are **not part of release 1** — they belong to the
deferred update-acceptance path above and require a release 2 that will not
be published for this beta. Do not run `beta_release_acceptance.py verify`
for release 1: `verify` is a two-release update-acceptance gate
(`--from-version`/`--to-version`) and is itself part of the deferred scope.

Finish by revoking every disposable installation created during acceptance
and confirming zero residue using the two commands in "Recovering a
stranded disposable installation" above.

## Step 5 — Rollback

The beta ships as a direct GitHub Release download with no broker and no
in-app updater, so rollback is a distribution-side action only — there is no
broker variable to repoint or redeploy:

- Keep the bad tag and release immutable. Never delete, move, or reuse a
  version.
- Unpublish the bad Release (`gh release edit v1.1.103-beta.6 --repo
  huntrw6/stagepilot-beta --draft` marks it a draft, hiding it from the
  Releases page for download while preserving the tag and assets for audit).
- Fix the problem, bump to the next version, and publish a new release
  following Steps 3–4 again. Point any download instructions at the new tag.
