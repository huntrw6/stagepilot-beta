import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "vitest";

import {
  RUNTIME_SECRET_NAMES,
  validateDeploymentEnvironment,
  verifyRuntimeSecrets,
} from "./deployment-config.mjs";
import {
  BOOTSTRAP_SCHEMA,
  BOOTSTRAP_VERSION,
  enrollAndWriteBundle,
  validateBootstrapBundle,
} from "./enroll-bootstrap.mjs";

const temporaryDirectories = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function deploymentEnvironment(overrides = {}) {
  return {
    CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
    CLOUDFLARE_ZONE_ID: "b".repeat(32),
    REMOTE_HOST_SUFFIX: "remote.example.com",
    REMOTE_PORT: "18766",
    CLOUDFLARE_API_TOKEN: "provider-token-with-narrow-scope",
    ADMIN_API_TOKEN: "admin-token-with-at-least-thirty-two-characters",
    INSTALLATION_SIGNING_KEY: "independent-signing-key-at-least-thirty-two-characters",
    ...overrides,
  };
}

function enrollmentResponse(id = "1".repeat(32)) {
  return {
    installationId: id,
    hostname: `sp-${id}.remote.example.com`,
    installationCredential: `spi_${id}.${"x".repeat(43)}`,
  };
}

function response(value) {
  return new Response(JSON.stringify(value), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
}

describe("deployment configuration", () => {
  it("validates protected deployment values and all independent runtime secrets", () => {
    assert.deepEqual(validateDeploymentEnvironment(deploymentEnvironment()), {
      accountId: "a".repeat(32),
      zoneId: "b".repeat(32),
      hostnameSuffix: "remote.example.com",
      remotePort: 18766,
    });
  });

  it("fails before deployment when any runtime secret is missing", () => {
    for (const name of RUNTIME_SECRET_NAMES) {
      assert.throws(
        () => validateDeploymentEnvironment(deploymentEnvironment({ [name]: "" })),
        new RegExp(`Missing required deployment value: ${name}`),
      );
    }
  });

  it("requires Wrangler read-back to contain every runtime secret name", () => {
    const complete = JSON.stringify(RUNTIME_SECRET_NAMES.map((name) => ({ name, type: "secret_text" })));
    assert.deepEqual(verifyRuntimeSecrets(complete), RUNTIME_SECRET_NAMES);
    assert.throws(() => verifyRuntimeSecrets(JSON.stringify([{ name: RUNTIME_SECRET_NAMES[0] }])), /Missing Worker runtime secret bindings/);
  });

  it("keeps deployment manual and supplies every protected value without tracked placeholders", () => {
    const repository = path.resolve(import.meta.dirname, "../..");
    const workflow = fs.readFileSync(path.join(repository, ".github/workflows/deploy-control-plane.yml"), "utf8");
    const wrangler = fs.readFileSync(path.join(repository, "control-plane/wrangler.toml"), "utf8");
    assert.match(workflow, /workflow_dispatch:/);
    assert.doesNotMatch(workflow, /\bpush:/);
    for (const name of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_ZONE_ID", "REMOTE_HOST_SUFFIX", "REMOTE_PORT"]) {
      assert.match(workflow, new RegExp(`vars\\.${name}`));
      assert.match(workflow, new RegExp(`--var ${name}:`));
    }
    for (const name of RUNTIME_SECRET_NAMES) {
      assert.match(workflow, new RegExp(`secrets\\.${name}`));
      assert.match(workflow, new RegExp(`^ {12}${name}$`, "m"));
    }
    assert.match(workflow, /secret list --format json/);
    assert.doesNotMatch(wrangler, /REPLACE_WITH_|example\.invalid/);
  });
});

describe("administrator bootstrap export", () => {
  it("writes only the strict installation-bound v1 bundle at mode 0600 without logging secrets", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stagepilot-bootstrap-"));
    temporaryDirectories.push(directory);
    const output = path.join(directory, "friend.bootstrap.json");
    const adminToken = "admin-token-that-must-never-be-logged-or-exported";
    const enrollment = enrollmentResponse();
    const logs = [];
    let authorization = "";

    const result = await enrollAndWriteBundle({
      origin: "https://control.example.com",
      idempotencyKey: "friend-2026-0001",
      label: "Friend",
      remotePort: 18766,
      output,
      adminToken,
      fetchImpl: async (_url, init) => {
        authorization = init.headers.authorization;
        return response(enrollment);
      },
      now: () => "2026-09-13T10:00:00.000Z",
      randomUUID: () => "11111111-1111-4111-8111-111111111111",
      log: (message) => logs.push(message),
    });

    assert.equal(result.status, "created");
    assert.equal(authorization, `Bearer ${adminToken}`);
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
    const bundle = JSON.parse(fs.readFileSync(output, "utf8"));
    assert.deepEqual(Object.keys(bundle).sort(), [
      "bundleId",
      "controlPlaneOrigin",
      "hostname",
      "installationCredential",
      "installationId",
      "issuedAt",
      "remotePort",
      "schema",
      "version",
    ]);
    assert.equal(bundle.schema, BOOTSTRAP_SCHEMA);
    assert.equal(bundle.version, BOOTSTRAP_VERSION);
    assert.equal(bundle.installationId, enrollment.installationId);
    assert.equal(bundle.hostname, enrollment.hostname);
    assert.equal(bundle.installationCredential, enrollment.installationCredential);
    assert.ok(!fs.readFileSync(output, "utf8").includes(adminToken));
    assert.ok(!logs.join("\n").includes(adminToken));
    assert.ok(!logs.join("\n").includes(enrollment.installationCredential));
    assert.ok(!logs.join("\n").includes(enrollment.installationId));
  });

  it("recovers idempotently without replacing an existing matching bundle", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stagepilot-bootstrap-"));
    temporaryDirectories.push(directory);
    const output = path.join(directory, "friend.bootstrap.json");
    const options = {
      origin: "https://control.example.com",
      idempotencyKey: "friend-2026-0002",
      remotePort: 18766,
      output,
      adminToken: "admin-token-with-at-least-thirty-two-characters",
      fetchImpl: async () => response(enrollmentResponse()),
      now: () => "2026-09-13T10:00:00.000Z",
      randomUUID: () => "22222222-2222-4222-8222-222222222222",
      log: () => {},
    };
    await enrollAndWriteBundle(options);
    const before = fs.readFileSync(output, "utf8");
    const recovered = await enrollAndWriteBundle({
      ...options,
      randomUUID: () => "33333333-3333-4333-8333-333333333333",
    });
    assert.equal(recovered.status, "unchanged");
    assert.equal(fs.readFileSync(output, "utf8"), before);
  });

  it("rejects cross-installation credentials and conflicting recovery", async () => {
    const firstId = "1".repeat(32);
    const secondId = "2".repeat(32);
    assert.throws(() => validateBootstrapBundle({
      schema: BOOTSTRAP_SCHEMA,
      version: BOOTSTRAP_VERSION,
      bundleId: "44444444-4444-4444-8444-444444444444",
      controlPlaneOrigin: "https://control.example.com",
      installationId: firstId,
      hostname: `sp-${firstId}.remote.example.com`,
      remotePort: 18766,
      installationCredential: `spi_${secondId}.${"x".repeat(43)}`,
      issuedAt: "2026-09-13T10:00:00.000Z",
    }), /not bound/);

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stagepilot-bootstrap-"));
    temporaryDirectories.push(directory);
    const output = path.join(directory, "friend.bootstrap.json");
    const base = {
      origin: "https://control.example.com",
      idempotencyKey: "friend-2026-0003",
      remotePort: 18766,
      output,
      adminToken: "admin-token-with-at-least-thirty-two-characters",
      now: () => "2026-09-13T10:00:00.000Z",
      randomUUID: () => "55555555-5555-4555-8555-555555555555",
      log: () => {},
    };
    await enrollAndWriteBundle({ ...base, fetchImpl: async () => response(enrollmentResponse(firstId)) });
    await assert.rejects(
      enrollAndWriteBundle({ ...base, fetchImpl: async () => response(enrollmentResponse(secondId)) }),
      /conflicts/,
    );
  });
});
