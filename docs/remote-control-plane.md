# Private-beta Remote control plane

## Scope and completion boundary

`control-plane/` is the minimum Cloudflare Worker control plane for explicitly
enrolled private-beta installations. It is not signup, an invite system, billing,
organization management, a relay, or a dashboard API. The Worker and its single
Durable Object are the only account-management tier; no owner's home server is in
the path.

This repository contains a locally verified implementation and manual deployment
workflow. It has not been deployed by this milestone. A real deployment requires
an approved Cloudflare account, zone, Worker route, Durable Object migration, and
secrets. Do not claim live multi-installation acceptance until the operations gate
at the end of this document has been run against two disposable enrolled installs.

## Trust boundaries

```text
Private beta administrator
  ADMIN_API_TOKEN -> authenticated enrollment/revocation endpoints

Cloudflare Worker + singleton Registry Durable Object
  server-only account/zone IDs, CLOUDFLARE_API_TOKEN,
  ADMIN_API_TOKEN, INSTALLATION_SIGNING_KEY
  -> exact named tunnel/configuration/DNS lifecycle

Enrolled StagePilot installation
  random installation ID + installation credential only
  -> authenticated provision/disable/reconcile/status
  <- stable generated hostname + that tunnel's run credential only
  -> existing remote_beta_control writes private connector.token + remote.json

cloudflared -> dedicated 127.0.0.1 Remote listener -> existing Remote auth/runtime
```

The Worker never returns its account token, admin token, or signing key. It does
not store cloudflared run tokens: it retrieves the exact tunnel token only after
route read-back and returns it to that authenticated installation. Installation
credentials are deterministic HMAC capabilities bound to random 128-bit IDs; only
the server-side signing key can derive them. Enrollment is admin-authenticated and
idempotent. There is no endpoint through which an arbitrary Internet client can
select a hostname or create an installation.

No CORS policy is emitted. CORS is not authentication, and browsers are not a
supported provisioning client. Request bodies are capped at 4 KiB, all state and
mutation responses are `no-store`, and public errors omit provider bodies and
resource details.

## Durable identity and ownership

The singleton `Registry` Durable Object serializes enrollment and resource
mutation. Its storage contains installation metadata, desired lifecycle state,
and enrollment idempotency mappings. An enrollment key of 8–128 safe characters
returns the same random ID, generated hostname, and installation credential when
replayed. Different keys produce different identities and credentials.

Hostnames are generated as:

```text
sp-<32 lowercase hex installation ID>.<REMOTE_HOST_SUFFIX>
```

Clients cannot submit a hostname. Each tunnel name includes both the installation
ID and a client-generated UUID generation. DNS ownership requires an exact CNAME,
exact generated hostname, exact tunnel target, proxied state, and exact tunnel
name in the record comment. Ambiguous, foreign, locally managed, or malformed
resources fail closed and are never adopted or deleted.

Provision first journals `desiredEnabled=true` and `enabling`, then reconciles the
exact tunnel name before any create. It writes and reads back the dedicated
loopback ingress plus deny-all catch-all, creates and reads back the exact DNS
record, and only then retrieves the tunnel run token. Lost write responses leave
the operation incomplete; a later authenticated `reconcile` discovers the exact
resource and continues without a duplicate.

Disable journals `desiredEnabled=false` and `revoking` before cloud mutation. The
installation client independently disables its local desired policy and removes
its connector token before making the request. The Worker deletes only the exact
owned DNS record, applies deny-all ingress, disconnects connectors, deletes the
tunnel, reads back absence, and then records `disabled`. A failed operation stays
`revoking`; retry `disable` or `reconcile`.

Administrative revoke follows the same cleanup but permanently marks the
installation revoked. Its credential then receives 401 for every installation
route. Re-enabling after ordinary disable requires a new generation, which causes
the existing StagePilot Remote listener/auth integration to invalidate old Remote
sessions. Viewer/Operator, CSRF, session cookies, LAN-PIN rejection, HTTPS/WSS
provenance, dedicated-loopback ingress, and production-runtime isolation remain in
the existing backend and are not reimplemented by this service.

## API

All non-health routes require `Authorization: Bearer ...`.

| Method and path | Principal | Behavior |
| --- | --- | --- |
| `GET /health` | public | Secret-free liveness only |
| `POST /v1/admin/installations` | administrator | Idempotent enrollment; body `{idempotencyKey,label}` |
| `POST /v1/admin/installations/:id/revoke` | administrator | Permanent credential and resource revocation |
| `GET /v1/installations/:id/status` | matching installation | Sanitized lifecycle state |
| `POST /v1/installations/:id/provision` | matching installation | Idempotent exact-generation provision; body `{generation}` |
| `POST /v1/installations/:id/disable` | matching installation | Fail-closed cleanup |
| `POST /v1/installations/:id/reconcile` | matching installation | Resume persisted desired lifecycle |

The raw enrollment response is accepted only by the administrator export utility;
it is not an installer input. The strict bootstrap artifact is JSON with exactly:

```json
{
  "schema": "org.stagepilot.private-beta-bootstrap",
  "version": 1,
  "bundleId": "UUIDv4",
  "controlPlaneOrigin": "https://exact-worker-origin.example",
  "installationId": "32 lowercase hex characters",
  "hostname": "sp-<same-installation-id>.<configured-suffix>",
  "remotePort": 18766,
  "installationCredential": "spi_<same-installation-id>.<signature>",
  "issuedAt": "ISO-8601 timestamp"
}
```

There are no optional or extension fields in version 1. The bundle contains no
Cloudflare account identifier/token, administrator token, signing key,
idempotency key, or tunnel run token. It is friend- and installation-specific,
not signup, an invite code, or reusable enrollment capability.

Generate it only after the Worker is live. Put the administrator token in a
private regular file readable only by its owner, choose a new non-secret
idempotency key for the friend, and select an absolute output path in a private
out-of-band transfer location:

```sh
npm --prefix control-plane run enroll:bootstrap -- \
  --origin https://exact-worker-origin.example \
  --idempotency-key friend-specific-operation-0001 \
  --label "Friend label" \
  --remote-port 18766 \
  --output /absolute/private/friend.bootstrap.json \
  --admin-token-file /absolute/private/admin-token
```

The utility calls the live admin enrollment endpoint, validates that hostname and
credential are bound to the returned installation ID, creates the selected file
exclusively at mode 0600, and prints only redacted status. Repeating the same
idempotency key and output path validates and preserves a matching file; a
different live result or binding conflict fails without replacement. If a prior
response was lost, rerun the same command. If the artifact itself was lost,
re-export deliberately to a new selected path with the same enrollment key.

## Installation-side operation

Milestone B must expose an explicit one-time import action. It must reject unknown
or missing fields, unsupported versions, non-HTTPS or non-exact origins, a
hostname or credential not bound to the declared installation ID, an origin/
installation/hostname conflicting with existing configuration, and an already
recorded bundle ID or installation import. On success it stores only the
installation credential in Windows Credential Manager or macOS Keychain and
persists only the exact origin, installation ID, hostname, port, schema version,
and consumed bundle ID as non-secret configuration. It must never copy the admin
token or any Cloudflare account capability. Import is not implemented by this
control-plane milestone.

For the current backend-only validation path, create a private
`BetaControlConfig` JSON outside the connector export with the exact HTTPS Worker
origin, enrolled ID/hostname, absolute credential/state/export paths, and the
dedicated Remote port. Store the installation credential in the configured
credential file at mode 0600. The credential and state directory must not be
under the connector export.

After successful import, warn the administrator and friend to delete every source
and transfer copy. Do not claim secure erasure: ordinary file deletion may leave
recoverable data on snapshots, backups, journaling file systems, or flash media.

Run from the installed backend environment:

```sh
python -m stagepilot.remote_beta_control enable --config /absolute/private/beta-control.json
python -m stagepilot.remote_beta_control status --config /absolute/private/beta-control.json
python -m stagepilot.remote_beta_control reconcile --config /absolute/private/beta-control.json
python -m stagepilot.remote_beta_control disable --config /absolute/private/beta-control.json
```

The client uses a local `flock` and fsynced state. Enable exports only
`remote.json` and the installation's cloudflared run token. Disable closes local
Remote and deletes that token before contacting the Worker. Never put the
installation credential in `remote.json`, `connector.token`, an argument, a log,
or the frontend.

## Deployment and secret rotation

Deployment is intentionally manual through `.github/workflows/deploy-control-plane.yml`
and the protected `stagepilot-control-plane` GitHub environment. A push does not
publish the Worker. Restrict deployment to the `main` branch and configure required
reviewers when the repository plan supports them. The current private-beta repository
plan does not support environment reviewers, so its compensating controls are a
private repository, a manual-only `workflow_dispatch`, environment-scoped secrets,
and an exact `main`-only deployment policy. Do not add a push trigger or broaden the
deployment branch while that limitation exists. Set these environment values (not
repository placeholders):

- variables: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`,
  `REMOTE_HOST_SUFFIX`, `REMOTE_PORT`;
- secrets: `CLOUDFLARE_API_TOKEN`, `ADMIN_API_TOKEN`,
  `INSTALLATION_SIGNING_KEY`.

The account and zone IDs are 32 lowercase hexadecimal characters. The suffix is
the DNS suffix under which generated installation hostnames may be created. The
dedicated port is 1024-65535 and must not be local port 8765. The provider token
must have Worker Scripts deployment for the target account plus Account
Cloudflare Tunnel Edit and Zone DNS Edit for only the chosen zone. The admin token
and signing key are independent random values of at least 32 bytes.

Dispatch the workflow manually and approve the protected environment when an
environment reviewer is configured. It runs
tests and TypeScript build, validates every value without printing secrets, builds
a Wrangler dry-run preview, supplies all four vars on the command line, installs
all three Worker runtime secrets through Wrangler, deploys the tracked Durable
Object migration/binding, then reads `wrangler secret list --format json` and
fails unless all three secret names are present. No secret value is printed. Read
back the deployed Worker version, `REGISTRY` binding, four vars, secret names,
custom HTTPS origin, and `/health` before enrollment. Configure the custom Worker
hostname narrowly in Cloudflare if it is not already attached; do not alter
unrelated DNS records.

For provider/admin rotation, replace the matching protected environment secret,
manually rerun and approve the workflow, verify the secret-name read-back and live
health, and only then retire the old value. Update the administrator token file
out of band after admin rotation. Provider rotation does not invalidate
installation credentials or current connectors, but reconciliation fails until a
working runtime token is restored. Administrative revoke is the normal
single-site response to compromise.

Rotating `INSTALLATION_SIGNING_KEY` immediately invalidates every installation
credential. Inventory and disable/revoke affected installations first, preserve
the old key only in the approved recovery vault, deploy the new key, re-enroll
each friend, privately deliver a new bundle, and verify each new import before
retiring the old key. Never put either key in a bundle.

For code rollback, select the last known-good Cloudflare Worker version and keep
the current Durable Object binding and schema; migrations are forward-only and a
code rollback is not a storage rollback. Reapply/read back the four environment
vars and three secret names, then verify `/health` and one authenticated redacted
status request. Restore an old runtime secret only when it is known not to be
compromised. If schema compatibility is uncertain, stop enrollment and resource
mutation rather than running two registry writers or guessing at stored state.

Back up Durable Object storage through an approved Cloudflare export/backup
procedure before migration. Do not copy its state into a second active writer.
Provider resources remain recoverable by exact generated names, but loss of the
registry or signing key is an administrative incident, not permission to adopt or
delete ambiguous resources.

## Verification evidence and remaining live gate

Local control-plane validation passes 13 tests: six Worker tests cover
unauthenticated allocation rejection, missing-runtime-secret failure, idempotent
enrollment, distinct identities/credentials, two simultaneously provisioned
isolated tunnels and DNS routes, cross-credential denial, independent
disable/revoke, restart reconciliation after a lost create response, and
foreign-route rejection; seven operations tests cover deployment wiring and
validation, secret-name read-back, strict bundle schema and permissions, redacted
output, idempotent recovery, and per-installation binding. TypeScript strict
checking and `npm audit` pass. Backend targeted validation passes the installation
client plus existing Remote control/lifecycle tests, Ruff, and strict mypy.

Before declaring the Cloudflare milestone live, enroll two disposable
installations and verify all of the following by exact API read-back and the
existing browser proof:

- distinct installation IDs, credentials, hostnames, tunnel IDs, DNS ownership,
  connector tokens, identity databases, and Remote sessions;
- each stable hostname passes HTTPS, authenticated WSS/reconnect,
  Viewer/Operator authorization, CSRF, anonymous/LAN-PIN rejection, and logout;
- connector-only restart preserves the installation and active generation;
- disabling installation A closes its local listener first, removes only A's DNS
  and tunnel, rejects A's old sessions/token, and leaves B fully connected;
- permanent revoke leaves A unauthorized and restart-safe while B remains intact;
- provider outage/lost response stays fail-closed and authenticated reconciliation
  finishes without duplicate or cross-owned resources.

Record redacted resource IDs and timestamps in `remote-provisioning.md`. Never
record any account, admin, signing, installation, session, or tunnel token.
