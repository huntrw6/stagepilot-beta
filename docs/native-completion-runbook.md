# Native completion runbook and PROVEN/DEFERRED ledger

This is the single authoritative source for (a) exactly what the self-hosted
Linux runner `stagepilot-ci` has actually proven, (b) what remains DEFERRED and
precisely what evidence each deferred item still needs, and (c) the exact
ordered commands that finish private beta release 1 and release 2 the moment a
native self-hosted runner is registered.

Nothing in this file may be presented as validated unless it appears under
PROVEN with a CI run URL. See
[`private-beta-release-and-acceptance.md`](private-beta-release-and-acceptance.md)
for the delivery decision and
[`private-beta-enrollment-and-guardrails.md`](private-beta-enrollment-and-guardrails.md)
for the guardrail thresholds.

## Runner inventory

| Label | Machine | Status |
|---|---|---|
| `stagepilot-linux` | `stagepilot-ci` (Linux X64) | Registered and online |
| `stagepilot-windows-x64` | — | **Not registered.** Blocks release 1 and 2. |
| `stagepilot-macos-arm64` | — | **Not registered.** Blocks release 1 and 2. |
| `stagepilot-macos-x64` | — | **Not registered.** Blocks release 1 and 2. |

Every active workflow job uses exactly `runs-on: [self-hosted, stagepilot-linux]`.
Every native job is named `DEFERRED — …` and carries `if: ${{ false }}`. Enforced
by parsed YAML in `scripts/validate_workflow_runners.py`, which runs in CI and
fails on any hosted `ubuntu-*`/`windows-*`/`macos-*` label or any change to the
deferred inventory.

## PROVEN on self-hosted Linux

Each row is backed by a CI run on `stagepilot-ci`. Re-read state with `gh`
rather than trusting this table alone.

| # | Capability | Proof |
|---|---|---|
| P1 | Backend, frontend, MultiTracks CLI, and Linux desktop-shell checks (Cargo fmt/check/test) | `ci.yml` jobs `backend`, `frontend`, `multitracks-cues`, `desktop-linux-checks` |
| P2 | Runner boundary: no hosted runner label anywhere; deferred native inventory unchanged | `ci.yml:desktop-linux-checks` → `scripts/validate_workflow_runners.py` |
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

## DEFERRED — not proven, with the exact evidence still required

Never describe any of these as validated.

| # | Item | Blocked by | Evidence required to clear it |
|---|---|---|---|
| D1 | Windows x64 installer builds and is signed | `stagepilot-windows-x64` runner | `ci.yml:desktop` green with a real `*-setup.exe` and `.sig` artifact |
| D2 | macOS arm64/x64 `.app`, `.dmg`, and `.app.tar.gz` build and verify | `stagepilot-macos-*` runners | `release-macos.yml:build` green; `scripts/verify_macos_release_bundle.sh` passes `--app`, `--dmg`, `--archive` |
| D3 | Real signed `latest.json` for actual artifacts | D1 + D2 | `release-macos.yml:publish` green; manifest generated from real `.sig` files |
| D4 | Broker serves a real private release end to end | D3 + a published release | `GET /v1/releases/latest.json` returns 200 for the real tag |
| D5 | Fresh-machine install on each platform | native hardware | `beta_release_acceptance.py installer` + `check --name local_health` receipts |
| D6 | No-auth transparent enrollment from an installed build | native hardware | `check --name transparent_enrollment` and `first_operator` receipts |
| D7 | Viewer/Operator HTTPS + WSS policy from an installed build | native hardware | `check --name https_wss_roles` receipt |
| D8 | App/connector restart and real machine reboot recovery | native hardware | `check --name restart_recovery`, `reboot_recovery` receipts |
| D9 | Disable, re-enable with a new generation, exact provider cleanup | native hardware | `check --name disable_reenable_provider_cleanup` receipt |
| D10 | In-app update discovery, download, install, relaunch, version read-back | D3 + two published releases | `check --name updater_discovery`, `updater_install_relaunch`, then `verify --from-version … --to-version …` |
| D11 | Gatekeeper / SmartScreen behaviour on unsigned-publisher builds | native hardware | Recorded operator observation per platform |
| D12 | Live enrollment/guardrail acceptance against the deployed Worker | enrollment source quota (below); window observed exhausted 2026-09-16, reopens ~2026-09-17 16:40Z at the latest | `prepare-control-plane-live-acceptance.yml` green with a full `report` object and `CLEANUP_RECEIPTS` showing every installation revoked |

### D12 operational note — enrollment source quota

The live acceptance run is itself subject to the production guardrail it
verifies: **3 new installations per canonical source IPv4/IPv6-/64 per 24
hours** (`ENROLLMENTS_PER_SOURCE`). Each full run consumes 2. The self-hosted
runner presents a single source address, so **at most one full acceptance run
per 24 hours is possible from `stagepilot-ci`**, and a failed run that already
enrolled still consumes quota.

Once the window is exhausted, enrollment correctly returns `429` and the run
fails at its first assertion. That is the guardrail working, not a regression.
Either wait out the 24-hour window or run the acceptance from a different
source address. Do not raise `ENROLLMENTS_PER_SOURCE` to make a test pass.

Check the remaining budget before dispatching:

```sh
gh workflow run sweep-control-plane-residue.yml --repo huntrw6/stagepilot-beta \
  --ref main -f apply=report
```

The workflow's **Read enrollment budget counters** step prints the
aggregate-only admin metrics. Reading them consumes no quota. A rising
`enrollmentDenied` counter with a flat `enrollments` counter means the window
is exhausted.

#### Observed exhaustion, 2026-09-16

Four acceptance attempts ran between 16:06Z and 16:31Z, and the counters read
back by run `35122372776` pin the state exactly:

| Reading | `enrollments` | `enrollmentDenied` | `activeInstallations` |
|---|---|---|---|
| Baseline, 16:31:03Z | 12 | 2 | 2 |
| After the run, 16:31:16Z | 12 | 5 | 2 |

`enrollments` did not move while `enrollmentDenied` rose by exactly 3 — one per
enrollment attempt in the run (`nonceA`, its replay, `nonceB`). Every attempt
was refused at the quota gate; none reached installation creation. This is the
textbook exhausted-window signature, and it is the guardrail working.

Two independent facts confirm the refusal is the quota and not a regression:

- `activeInstallations` held at 2 across the baseline and the post-run reading,
  so the run created nothing. The 2 are pre-existing, not residue from these
  attempts.
- The provider sweep read `disposableHostnames: []` and `disposableTunnels: []`
  directly from Cloudflare at 16:41Z. Nothing was provisioned, so there is
  nothing to strand.

The quota window is keyed to each source's first enrollment in the window, not
to a wall clock the operator controls, and the admin surface is aggregate-only:
it exposes no per-source counter and no window start. So the exact reopening
time is **not readable** — it can only be bounded. The 24-hour window covering
the denials at 16:31Z started no earlier than the first enrollment in that
window, so the window reopens at roughly **2026-09-17 16:40Z at the latest**,
and possibly earlier. Do not treat that timestamp as precise. Re-read the
counters first; dispatch the acceptance run only once `enrollments` can move
again.

Do not attempt the acceptance run before then. A premature attempt is not free:
each denied attempt increments `enrollmentDenied` but leaves the window's start
untouched, so it costs a CI run and buys nothing.

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

---

# Native completion runbook

Execute top to bottom. Every command is copy-pasteable and requires no
rediscovery. Do not skip a read-back.

## Step 0 — Register the native runners (one time, per machine)

On each native machine, register a repository runner with the exact label. The
label must match exactly; a mismatch leaves the job queued forever.

```sh
# Obtain a short-lived registration token (expires in ~1 hour).
gh api -X POST repos/huntrw6/stagepilot-beta/actions/runners/registration-token --jq .token
```

Windows x64 (PowerShell, in the runner directory):

```powershell
./config.cmd --url https://github.com/huntrw6/stagepilot-beta --token <TOKEN> `
  --labels stagepilot-windows-x64 --name stagepilot-win-x64 --unattended
./run.cmd
```

macOS Apple Silicon:

```sh
./config.sh --url https://github.com/huntrw6/stagepilot-beta --token <TOKEN> \
  --labels stagepilot-macos-arm64 --name stagepilot-mac-arm64 --unattended
./run.sh
```

macOS Intel:

```sh
./config.sh --url https://github.com/huntrw6/stagepilot-beta --token <TOKEN> \
  --labels stagepilot-macos-x64 --name stagepilot-mac-x64 --unattended
./run.sh
```

Each machine needs Node 22, Python 3.12 via `uv`, and a stable Rust toolchain;
macOS additionally needs Xcode command line tools. Verify all four runners are
online and correctly labelled:

```sh
gh api repos/huntrw6/stagepilot-beta/actions/runners \
  --jq '.runners[] | "\(.name) \(.status) \(.labels | map(.name) | join(","))"'
```

Expect `stagepilot-ci`, `stagepilot-win-x64`, `stagepilot-mac-arm64`, and
`stagepilot-mac-x64`, all `online`.

## Step 1 — Enable the native jobs

The four deferred jobs stay unschedulable until the runners exist. Once
Step 0 reads back all four runners online, remove **only** the
`if: ${{ false }}` line from each of these jobs, and update
`EXPECTED_DEFERRED` in `scripts/validate_workflow_runners.py` to match:

- `.github/workflows/ci.yml` → `desktop`
- `.github/workflows/ci.yml` → `desktop-macos-lifecycle`
- `.github/workflows/release-macos.yml` → `build`
- `.github/workflows/release-windows.yml` → `build`

Also drop the `DEFERRED — ` name prefix on each. Change nothing else: do not
alter a `runs-on` list, a signing step, a secret reference, the source audit,
the immutable-tag guard, or the `latest.json` ordering.

Validate and push:

```sh
uv run --with PyYAML==6.0.3 python scripts/validate_workflow_runners.py
git add .github/workflows scripts/validate_workflow_runners.py
git commit -m "ci: enable native jobs now that self-hosted native runners exist"
git push beta HEAD:refs/heads/main
```

## Step 2 — Confirm the required secrets exist

```sh
gh secret list --repo huntrw6/stagepilot-beta
gh secret list --repo huntrw6/stagepilot-beta --env stagepilot-control-plane
gh variable list --repo huntrw6/stagepilot-beta --env stagepilot-control-plane
```

Required, and never printed:

| Name | Scope | Purpose |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | repository | Signs updater artifacts |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | repository | Unlocks the signing key |
| `ADMIN_API_TOKEN` | `stagepilot-control-plane` | Admin metrics and revoke |
| `CLOUDFLARE_API_TOKEN` | `stagepilot-control-plane` | Worker deploy and residue sweep |
| `INSTALLATION_SIGNING_KEY` | `stagepilot-control-plane` | Per-installation credentials |
| `STAGEPILOT_RELEASE_TOKEN` | `stagepilot-control-plane` | Read-only Contents on `huntrw6/stagepilot-beta`, mapped to the Worker's `GITHUB_RELEASE_TOKEN` |

`STAGEPILOT_RELEASE_TOKEN` is the operator-supplied secret that gates the
release-broker deploy. Without it the broker cannot serve `latest.json`, so
D4 and D10 cannot clear. Set it with:

```sh
gh secret set STAGEPILOT_RELEASE_TOKEN --repo huntrw6/stagepilot-beta \
  --env stagepilot-control-plane
```

Verify the release allowlist variables before tagging:

```sh
gh variable get BETA_RELEASE_VERSIONS --repo huntrw6/stagepilot-beta --env stagepilot-control-plane
gh variable get BETA_LATEST_RELEASE_VERSION --repo huntrw6/stagepilot-beta --env stagepilot-control-plane
```

`BETA_RELEASE_VERSIONS` must be `1.1.103-beta.2,1.1.103-beta.3`.
`BETA_LATEST_RELEASE_VERSION` must be `1.1.103-beta.2` for release 1.

## Step 3 — Deploy the control plane with the release broker

```sh
gh workflow run deploy-control-plane.yml --repo huntrw6/stagepilot-beta --ref main
gh run watch "$(gh run list --repo huntrw6/stagepilot-beta \
  --workflow deploy-control-plane.yml --limit 1 --json databaseId -q '.[0].databaseId')"
```

The final step reads back every Worker runtime secret name and fails if any is
missing. Do not proceed on a failure.

## Step 4 — Release 1: `v1.1.103-beta.2`

Set every application version to `1.1.103-beta.2`, then:

```sh
node scripts/validate_versions.mjs v1.1.103-beta.2
node scripts/audit_beta_release.mjs source
git add -A
git commit -m "chore(release): StagePilot 1.1.103-beta.2"
git push beta HEAD:refs/heads/main
git tag -a v1.1.103-beta.2 -m "StagePilot 1.1.103-beta.2"
git push beta v1.1.103-beta.2
```

The tag push triggers `release-macos.yml`. Watch it:

```sh
gh run watch "$(gh run list --repo huntrw6/stagepilot-beta \
  --workflow release-macos.yml --limit 1 --json databaseId -q '.[0].databaseId')"
```

Expected published assets on the release (standalone `.sig` files are staging
inputs and are deliberately **not** published):

- `StagePilot_1.1.103-beta.2_aarch64.dmg`
- `StagePilot_1.1.103-beta.2_x64.dmg`
- `StagePilot_1.1.103-beta.2_aarch64.app.tar.gz`
- `StagePilot_1.1.103-beta.2_x64.app.tar.gz`
- `StagePilot_1.1.103-beta.2_x64-setup.exe`
- `latest.json`

Read back:

```sh
gh release view v1.1.103-beta.2 --repo huntrw6/stagepilot-beta \
  --json tagName,isDraft,assets -q '{tag:.tagName,draft:.isDraft,assets:[.assets[].name]}'
curl -sS https://stagepilot-beta-control-plane.stagepilot-illuminary-beta.workers.dev/v1/releases/latest.json
```

The release must be non-draft, must carry exactly the six assets above, and the
broker must return the manifest with `"version": "1.1.103-beta.2"` and every
`url` pointing at the broker.

## Step 5 — Native acceptance for release 1

On each of Windows x64, macOS arm64, and macOS x64, with a fresh account:

```sh
python scripts/beta_release_acceptance.py --report PRIVATE_REPORT installer \
  --platform PLATFORM --version 1.1.103-beta.2 --file INSTALLER
```

Then record every check name, one command each:

```sh
python scripts/beta_release_acceptance.py --report PRIVATE_REPORT check \
  --platform PLATFORM --name local_health --evidence "short local receipt"
```

Repeat for `transparent_enrollment`, `first_operator`, `https_wss_roles`,
`restart_recovery`, `reboot_recovery`, `disable_reenable_provider_cleanup`.
This clears D5–D9 and D11. `updater_discovery` and `updater_install_relaunch`
wait for release 2.

## Step 6 — Release 2: `v1.1.103-beta.3`

Bump every application version to `1.1.103-beta.3`. **Do not rotate the updater
key** — installed release-1 clients trust only the embedded public key.

```sh
node scripts/validate_versions.mjs v1.1.103-beta.3
node scripts/audit_beta_release.mjs source
git add -A
git commit -m "chore(release): StagePilot 1.1.103-beta.3"
git push beta HEAD:refs/heads/main
git tag -a v1.1.103-beta.3 -m "StagePilot 1.1.103-beta.3"
git push beta v1.1.103-beta.3
gh run watch "$(gh run list --repo huntrw6/stagepilot-beta \
  --workflow release-macos.yml --limit 1 --json databaseId -q '.[0].databaseId')"
```

Point the broker at release 2 and redeploy so installed release-1 clients can
discover it:

```sh
gh variable set BETA_LATEST_RELEASE_VERSION --repo huntrw6/stagepilot-beta \
  --env stagepilot-control-plane --body 1.1.103-beta.3
gh workflow run deploy-control-plane.yml --repo huntrw6/stagepilot-beta --ref main
```

Read back:

```sh
curl -sS https://stagepilot-beta-control-plane.stagepilot-illuminary-beta.workers.dev/v1/releases/latest.json
```

It must now report `"version": "1.1.103-beta.3"`.

## Step 7 — Update acceptance, clearing D10

On each platform, with release 1 still installed, observe discovery, cancel
once to prove no download starts, then accept and observe the unattended
install and relaunch. Record:

```sh
python scripts/beta_release_acceptance.py --report PRIVATE_REPORT check \
  --platform PLATFORM --name updater_discovery --evidence "short local receipt"
python scripts/beta_release_acceptance.py --report PRIVATE_REPORT check \
  --platform PLATFORM --name updater_install_relaunch --evidence "short local receipt"
```

Record the release-2 installer for every platform as well, because `verify`
requires exactly both update versions per platform:

```sh
python scripts/beta_release_acceptance.py --report PRIVATE_REPORT installer \
  --platform PLATFORM --version 1.1.103-beta.3 --file INSTALLER
```

Finish with cleanup on every platform:

```sh
python scripts/beta_release_acceptance.py --report PRIVATE_REPORT check \
  --platform PLATFORM --name final_cleanup --evidence "short local receipt"
```

`verify` passes only once all ten checks and both installers are recorded for
all three platforms, so run it last:

```sh
python scripts/beta_release_acceptance.py --report PRIVATE_REPORT verify \
  --from-version 1.1.103-beta.2 --to-version 1.1.103-beta.3
```

It prints `{"passed": true, "failures": []}` and exits non-zero on any gap.
Then revoke every disposable installation created during acceptance and confirm
zero residue using the two commands in "Recovering a stranded disposable
installation" above.

## Rollback

If a release is bad, immediately point the broker back at the last known-good
version and redeploy:

```sh
gh variable set BETA_LATEST_RELEASE_VERSION --repo huntrw6/stagepilot-beta \
  --env stagepilot-control-plane --body 1.1.103-beta.2
gh workflow run deploy-control-plane.yml --repo huntrw6/stagepilot-beta --ref main
```

Keep the bad tag immutable. Never replace a signed artifact, move a tag, or
reuse a version — publish a higher one.
