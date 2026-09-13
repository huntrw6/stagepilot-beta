const ID = /^[a-f0-9]{32}$/;
const HOSTNAME = /^[a-z0-9](?:[a-z0-9.-]{1,251}[a-z0-9])$/;

export const RUNTIME_SECRET_NAMES = Object.freeze([
  "CLOUDFLARE_API_TOKEN",
  "ADMIN_API_TOKEN",
  "INSTALLATION_SIGNING_KEY",
]);

function required(environment, name) {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required deployment value: ${name}`);
  }
  return value;
}

export function validateDeploymentEnvironment(environment) {
  const accountId = required(environment, "CLOUDFLARE_ACCOUNT_ID");
  const zoneId = required(environment, "CLOUDFLARE_ZONE_ID");
  const hostnameSuffix = required(environment, "REMOTE_HOST_SUFFIX").toLowerCase();
  const remotePortText = required(environment, "REMOTE_PORT");
  const providerToken = required(environment, "CLOUDFLARE_API_TOKEN");
  const adminToken = required(environment, "ADMIN_API_TOKEN");
  const signingKey = required(environment, "INSTALLATION_SIGNING_KEY");

  if (!ID.test(accountId)) throw new Error("CLOUDFLARE_ACCOUNT_ID must be 32 lowercase hexadecimal characters");
  if (!ID.test(zoneId)) throw new Error("CLOUDFLARE_ZONE_ID must be 32 lowercase hexadecimal characters");
  if (!HOSTNAME.test(hostnameSuffix) || hostnameSuffix.includes("..") || hostnameSuffix.endsWith(".invalid")) {
    throw new Error("REMOTE_HOST_SUFFIX must be a deployable lowercase DNS suffix");
  }
  const remotePort = Number(remotePortText);
  if (!Number.isInteger(remotePort) || remotePort < 1024 || remotePort > 65535 || remotePort === 8765) {
    throw new Error("REMOTE_PORT must be an integer from 1024 through 65535 other than 8765");
  }
  if (providerToken.length < 20) throw new Error("CLOUDFLARE_API_TOKEN is too short");
  if (adminToken.length < 32) throw new Error("ADMIN_API_TOKEN must contain at least 32 characters");
  if (signingKey.length < 32) throw new Error("INSTALLATION_SIGNING_KEY must contain at least 32 characters");
  if (adminToken === signingKey) throw new Error("ADMIN_API_TOKEN and INSTALLATION_SIGNING_KEY must be independent");

  return { accountId, zoneId, hostnameSuffix, remotePort };
}

export function installedSecretNames(output) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("Wrangler secret list did not return a JSON array");
  const rows = JSON.parse(output.slice(start, end + 1));
  if (!Array.isArray(rows)) throw new Error("Wrangler secret list did not return a JSON array");
  return new Set(rows.map((row) => row?.name).filter((name) => typeof name === "string"));
}

export function verifyRuntimeSecrets(output) {
  const installed = installedSecretNames(output);
  const missing = RUNTIME_SECRET_NAMES.filter((name) => !installed.has(name));
  if (missing.length > 0) throw new Error(`Missing Worker runtime secret bindings: ${missing.join(", ")}`);
  return RUNTIME_SECRET_NAMES;
}

function main() {
  const command = process.argv[2];
  if (command === "validate") {
    const config = validateDeploymentEnvironment(process.env);
    console.log(
      `Deployment configuration valid: account/zone IDs present, suffix=${config.hostnameSuffix}, Remote port=${config.remotePort}; 3 runtime secrets present.`,
    );
    return;
  }
  if (command === "verify-secrets") {
    const names = verifyRuntimeSecrets(required(process.env, "WRANGLER_SECRET_LIST"));
    console.log(`Verified Worker runtime secret bindings: ${names.join(", ")}. Values were not read.`);
    return;
  }
  throw new Error("Usage: node scripts/deployment-config.mjs validate|verify-secrets");
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Deployment validation failed");
    process.exitCode = 1;
  }
}
