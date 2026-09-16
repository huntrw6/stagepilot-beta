import assert from "node:assert/strict";

// Recovers from an acceptance run that stranded a disposable installation.
//
// The Worker's admin surface is deliberately aggregate-only and exposes no
// route that enumerates installations, so a stranded installation ID cannot be
// recovered through the control plane. The authoritative view of residue that
// actually matters — a live DNS record or a reachable tunnel — is the
// Cloudflare zone and account.
//
// This deletes ONLY objects matching the exact disposable acceptance naming:
//   hostname  sp-<32 hex>.<REMOTE_HOST_SUFFIX>
//   tunnel    stagepilot-<32 hex>-<generation>
// Any other DNS record, tunnel, WAF rule, ruleset, or zone setting is out of
// scope and is never read for mutation. It prints no tunnel token, credential,
// raw source address, or provider response body.

const apply = process.env.SWEEP_MODE === "apply";
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const zoneId = process.env.CLOUDFLARE_ZONE_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const suffix = (process.env.REMOTE_HOST_SUFFIX ?? "").toLowerCase();
assert(accountId && zoneId && apiToken && suffix, "sweep configuration is required");

const DISPOSABLE_HOST = new RegExp(`^sp-[a-f0-9]{32}\\.${suffix.replace(/\./g, "\\.")}$`);
const DISPOSABLE_TUNNEL = /^stagepilot-[a-f0-9]{32}-/;

const cloudflare = async (method, path) => {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
  });
  const payload = await response.json();
  assert(response.ok && payload?.success === true, `provider ${method} failed: ${response.status}`);
  return payload.result;
};

const listRecords = async () => {
  const result = await cloudflare("GET", `/zones/${zoneId}/dns_records?per_page=1000`);
  return (Array.isArray(result) ? result : [])
    .filter((record) => DISPOSABLE_HOST.test(String(record.name ?? "").toLowerCase()));
};

const listTunnels = async () => {
  const result = await cloudflare("GET", `/accounts/${accountId}/cfd_tunnel?per_page=1000&is_deleted=false`);
  return (Array.isArray(result) ? result : [])
    .filter((tunnel) => DISPOSABLE_TUNNEL.test(String(tunnel.name ?? "")));
};

const records = await listRecords();
const tunnels = await listTunnels();

console.log(JSON.stringify({
  mode: apply ? "apply" : "report",
  disposableHostnames: records.map((record) => String(record.name)),
  disposableTunnels: tunnels.map((tunnel) => String(tunnel.name)),
}, null, 2));

if (!apply) {
  console.log("Report only. Re-run with apply=apply to delete the listed residue.");
  process.exit(0);
}

// Remove the DNS route before the tunnel so a hostname is never left pointing
// at a deleted tunnel.
for (const record of records) {
  await cloudflare("DELETE", `/zones/${zoneId}/dns_records/${String(record.id)}`);
}
for (const tunnel of tunnels) {
  await cloudflare("DELETE", `/accounts/${accountId}/cfd_tunnel/${String(tunnel.id)}/connections`);
  await cloudflare("DELETE", `/accounts/${accountId}/cfd_tunnel/${String(tunnel.id)}`);
}

const remainingRecords = await listRecords();
const remainingTunnels = await listTunnels();
console.log(JSON.stringify({
  deletedHostnames: records.length,
  deletedTunnels: tunnels.length,
  remainingHostnames: remainingRecords.map((record) => String(record.name)),
  remainingTunnels: remainingTunnels.map((tunnel) => String(tunnel.name)),
}, null, 2));

assert.deepEqual(remainingRecords.map((record) => String(record.name)), [], "disposable hostnames survived the sweep");
assert.deepEqual(remainingTunnels.map((tunnel) => String(tunnel.name)), [], "disposable tunnels survived the sweep");
