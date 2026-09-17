const API = "https://api.cloudflare.com/client/v4";
export const RULE_REF = "stagepilot_remote_beta_rate_limit_v1";
export const REQUESTS_PER_PERIOD = 60;
export const PERIOD_SECONDS = 10;
export const MITIGATION_SECONDS = 10;

function required(environment, name) {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing required value: ${name}`);
  return value;
}

export function hostnameExpression(suffix) {
  if (!/^[a-z0-9](?:[a-z0-9.-]{1,251}[a-z0-9])$/.test(suffix) || suffix.includes("..")) {
    throw new Error("Invalid Remote hostname suffix");
  }
  return `(http.host wildcard "sp-*.${suffix}")`;
}

export function desiredRule(suffix) {
  return {
    ref: RULE_REF,
    description: "StagePilot Remote beta per-source request ceiling (HTTPS and WSS upgrades)",
    expression: hostnameExpression(suffix),
    action: "block",
    ratelimit: {
      characteristics: ["cf.colo.id", "ip.src"],
      period: PERIOD_SECONDS,
      requests_per_period: REQUESTS_PER_PERIOD,
      mitigation_timeout: MITIGATION_SECONDS,
      requests_to_origin: false,
    },
    enabled: true,
  };
}

async function api(fetchImpl, token, path, init = {}) {
  const response = await fetchImpl(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
  });
  if (response.status === 404) return null;
  const payload = await response.json();
  if (!response.ok || payload?.success !== true || !("result" in payload)) {
    throw new Error(`Cloudflare ruleset request failed (HTTP ${response.status})`);
  }
  return payload.result;
}

function verify(ruleset, suffix) {
  const rules = ruleset?.rules;
  if (!ruleset?.id || !Array.isArray(rules) || rules.length !== 1) {
    throw new Error("Expected exactly one zone rate-limit rule");
  }
  const actual = rules[0];
  const expected = desiredRule(suffix);
  if (
    actual.ref !== expected.ref
    || actual.expression !== expected.expression
    || actual.action !== expected.action
    || actual.enabled !== true
    || actual.ratelimit?.period !== expected.ratelimit.period
    || actual.ratelimit?.requests_per_period !== expected.ratelimit.requests_per_period
    || actual.ratelimit?.mitigation_timeout !== expected.ratelimit.mitigation_timeout
    || (actual.ratelimit?.requests_to_origin ?? false) !== expected.ratelimit.requests_to_origin
    || JSON.stringify([...(actual.ratelimit?.characteristics ?? [])].sort())
      !== JSON.stringify([...expected.ratelimit.characteristics].sort())
  ) throw new Error("StagePilot rate-limit rule read-back mismatch");
  return {
    rulesetId: ruleset.id,
    ruleId: actual.id,
    expression: actual.expression,
    requestsPerPeriod: actual.ratelimit.requests_per_period,
    periodSeconds: actual.ratelimit.period,
    mitigationSeconds: actual.ratelimit.mitigation_timeout,
  };
}

export async function applyRateLimit({ zoneId, token, suffix, fetchImpl = fetch }) {
  const entrypoint = `/zones/${zoneId}/rulesets/phases/http_ratelimit/entrypoint`;
  let ruleset = await api(fetchImpl, token, entrypoint);
  const rule = desiredRule(suffix);
  if (ruleset === null) {
    ruleset = await api(fetchImpl, token, `/zones/${zoneId}/rulesets`, {
      method: "POST",
      body: JSON.stringify({
        name: "StagePilot Remote beta rate limiting",
        description: "Dedicated Remote-host-only rate limit; managed DDoS phases are unchanged",
        kind: "zone",
        phase: "http_ratelimit",
        rules: [rule],
      }),
    });
  } else {
    const existing = Array.isArray(ruleset.rules) ? ruleset.rules : [];
    if (existing.some((candidate) => candidate.ref !== RULE_REF)) {
      throw new Error("Refusing to modify an unrelated zone rate-limit rule");
    }
    ruleset = await api(fetchImpl, token, `/zones/${zoneId}/rulesets/${ruleset.id}`, {
      method: "PUT",
      body: JSON.stringify({
        description: "Dedicated Remote-host-only rate limit; managed DDoS phases are unchanged",
        rules: [rule],
      }),
    });
  }
  const readBack = await api(fetchImpl, token, `/zones/${zoneId}/rulesets/${ruleset.id}`);
  return verify(readBack, suffix);
}

export async function readRateLimit({ zoneId, token, suffix, fetchImpl = fetch }) {
  const ruleset = await api(fetchImpl, token, `/zones/${zoneId}/rulesets/phases/http_ratelimit/entrypoint`);
  if (ruleset === null) throw new Error("Zone rate-limit ruleset is absent");
  return verify(ruleset, suffix);
}

async function main() {
  const command = process.argv[2] ?? "read";
  const options = {
    zoneId: required(process.env, "CLOUDFLARE_ZONE_ID"),
    token: required(process.env, "CLOUDFLARE_API_TOKEN"),
    suffix: required(process.env, "REMOTE_HOST_SUFFIX").toLowerCase(),
  };
  const result = command === "apply"
    ? await applyRateLimit(options)
    : command === "read"
      ? await readRateLimit(options)
      : null;
  if (result === null) throw new Error("Usage: node scripts/waf-rate-limit.mjs apply|read");
  console.log(JSON.stringify(result));
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "WAF rate-limit operation failed");
    process.exitCode = 1;
  });
}
