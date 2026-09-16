import assert from "node:assert/strict";

// Proves an acceptance run left no residue. Two independent readings:
//
//   1. Provider sweep (authoritative). Reads the Cloudflare zone and account
//      directly and asserts no disposable acceptance hostname or tunnel
//      survives. This is the residue that actually costs money, holds DNS, or
//      keeps a tunnel reachable.
//   2. Registry counters. Reads the administrator metrics route, which exposes
//      only aggregates, and asserts the run was net-neutral against a baseline
//      captured before the acceptance step.
//
// Nothing here records a raw IP, keyed source hash, installation credential,
// tunnel token, or provider response body.

const mode = process.argv[2];
assert(["baseline", "verify"].includes(mode), "Usage: node scripts/residue-check.mjs baseline|verify");

const origin = process.env.CONTROL_PLANE_ORIGIN;
const adminToken = process.env.ADMIN_API_TOKEN;
assert(origin?.startsWith("https://") && adminToken, "residue configuration is required");

const counters = async () => {
  const response = await fetch(`${origin}/v1/admin/metrics`, {
    headers: {
      authorization: `Bearer ${adminToken}`,
      "user-agent": "StagePilot-private-beta-acceptance/1.0",
    },
  });
  assert.equal(response.status, 200, `admin metrics unavailable: ${response.status}`);
  const metrics = await response.json();
  const aggregate = {
    activeInstallations: metrics.activeInstallations,
    enrollments: metrics.enrollments,
    enrollmentDenied: metrics.enrollmentDenied,
    statusDenied: metrics.statusDenied,
    mutationDenied: metrics.mutationDenied,
    providerDenied: metrics.providerDenied,
  };
  assert(
    Object.values(aggregate).every((value) => Number.isInteger(value) && value >= 0),
    `admin metrics are not aggregate integer counters: ${JSON.stringify(aggregate)}`,
  );
  return aggregate;
};

if (mode === "baseline") {
  console.log(JSON.stringify(await counters()));
  process.exit(0);
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const zoneId = process.env.CLOUDFLARE_ZONE_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const suffix = (process.env.REMOTE_HOST_SUFFIX ?? "").toLowerCase();
assert(accountId && zoneId && apiToken && suffix, "provider sweep configuration is required");

const cloudflare = async (path) => {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
  });
  const payload = await response.json();
  // Never surface the provider response body; it can echo request detail.
  assert(response.ok && payload?.success === true, `provider read failed: ${response.status}`);
  return Array.isArray(payload.result) ? payload.result : [];
};

const records = await cloudflare(`/zones/${zoneId}/dns_records?per_page=1000`);
const strayHostnames = records
  .map((record) => String(record.name ?? "").toLowerCase())
  .filter((name) => name.startsWith("sp-") && name.endsWith(`.${suffix}`));

const tunnels = await cloudflare(`/accounts/${accountId}/cfd_tunnel?per_page=1000&is_deleted=false`);
const strayTunnels = tunnels
  .map((tunnel) => String(tunnel.name ?? ""))
  // tunnelName() is `stagepilot-<32 hex installation id>-<generation uuid>`.
  .filter((name) => /^stagepilot-[a-f0-9]{32}-/.test(name));

const baseline = JSON.parse(process.env.RESIDUE_BASELINE ?? "null");
const current = await counters();

console.log(JSON.stringify({
  strayHostnames: strayHostnames.length,
  strayTunnels: strayTunnels.length,
  baseline,
  current,
}));

assert.deepEqual(strayHostnames, [], `disposable Remote hostnames survived: ${JSON.stringify(strayHostnames)}`);
assert.deepEqual(strayTunnels, [], `disposable acceptance tunnels survived: ${JSON.stringify(strayTunnels)}`);

if (baseline) {
  assert(
    current.activeInstallations <= baseline.activeInstallations,
    `acceptance run was not net-neutral: activeInstallations ${baseline.activeInstallations} -> ${current.activeInstallations}`,
  );
}
