import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";
import tls from "node:tls";

const origin = process.env.CONTROL_PLANE_ORIGIN;
const cloudflared = process.env.CLOUDFLARED_BIN;
assert(origin?.startsWith("https://") && cloudflared, "acceptance configuration is required");

const report = {};
const installations = [];
const connectors = [];
const tokenFiles = [];

const call = async (path, { method = "GET", body, token } = {}) => {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "user-agent": "StagePilot-private-beta-acceptance/1.0",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // Status and headers are sufficient for edge-generated denials.
  }
  return { status: response.status, retryAfter: response.headers.get("retry-after"), payload };
};

const lifecycle = (installation, action, options = {}) => call(
  `/v1/installations/${installation.installationId}/${action}`,
  { ...options, token: installation.installationCredential },
);

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const httpsStatus = async (hostname) => {
  const response = await fetch(`https://${hostname}/health`, {
    headers: { "user-agent": "StagePilot-private-beta-acceptance/1.0" },
  });
  await response.arrayBuffer();
  return response.status;
};

const wssStatus = (hostname) => new Promise((resolve, reject) => {
  const socket = tls.connect({ host: hostname, port: 443, servername: hostname });
  const timer = setTimeout(() => {
    socket.destroy();
    reject(new Error("WSS handshake timed out"));
  }, 15_000);
  let response = "";
  socket.once("secureConnect", () => {
    socket.write([
      "GET /ws HTTP/1.1",
      `Host: ${hostname}`,
      "User-Agent: StagePilot-private-beta-acceptance/1.0",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}`,
      "Sec-WebSocket-Version: 13",
      "",
      "",
    ].join("\r\n"));
  });
  socket.on("data", (chunk) => {
    response += chunk.toString("ascii");
    if (!response.includes("\r\n")) return;
    clearTimeout(timer);
    socket.destroy();
    const match = response.match(/^HTTP\/1\.[01] (\d{3})/);
    if (!match) reject(new Error("invalid WSS handshake response"));
    else resolve(Number(match[1]));
  });
  socket.once("error", (error) => {
    clearTimeout(timer);
    reject(error);
  });
});

const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end('{"ok":true}');
});
server.on("upgrade", (request, socket) => {
  const key = request.headers["sec-websocket-key"];
  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.end([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    "",
  ].join("\r\n"));
});
await new Promise((resolve) => server.listen(18766, "127.0.0.1", resolve));

try {
  const nonceA = `live-a-${process.env.GITHUB_RUN_ID}-${crypto.randomUUID()}`;
  const nonceB = `live-b-${process.env.GITHUB_RUN_ID}-${crypto.randomUUID()}`;
  // Register every successfully enrolled installation for cleanup the instant
  // it exists. Asserting first would leak an installation whenever a later
  // enrollment is denied, because the finally block only revokes what it knows.
  const enroll = async (nonce) => {
    const response = await call("/v1/installations/enroll", { method: "POST", body: { nonce } });
    if (response.status === 201 && typeof response.payload?.installationId === "string"
      && !installations.some((item) => item.installationId === response.payload.installationId)) {
      installations.push(response.payload);
    }
    return response;
  };
  const first = await enroll(nonceA);
  const replay = await enroll(nonceA);
  const second = await enroll(nonceB);
  assert.equal(
    first.status,
    201,
    `enrollment was denied (${first.status}); this source's 3-per-24h enrollment quota may be exhausted by an earlier acceptance run`,
  );
  assert.equal(replay.status, 201);
  assert.equal(
    second.status,
    201,
    `second enrollment was denied (${second.status}); this source's 3-per-24h enrollment quota may be exhausted by an earlier acceptance run`,
  );
  assert.equal(installations.length, 2);
  assert.equal(replay.payload.installationId, first.payload.installationId);
  assert.notEqual(first.payload.installationId, second.payload.installationId);
  assert.notEqual(first.payload.installationCredential, second.payload.installationCredential);
  report.transparentEnrollment = true;
  report.idempotentNonceReplay = true;
  report.isolatedMachineCredentials = true;

  let limited;
  for (let index = 0; index < 121; index += 1) {
    const response = await lifecycle(first.payload, "status");
    if (response.status === 429) {
      limited = response;
      break;
    }
  }
  assert(limited && Number(limited.retryAfter) > 0);
  assert.equal((await lifecycle(second.payload, "status")).status, 200);
  report.statusQuotaRetryAfter = true;
  report.noisyInstallationIsolation = true;

  for (const installation of installations) {
    const provisioned = await lifecycle(installation, "provision", {
      method: "POST",
      body: { generation: crypto.randomUUID() },
    });
    assert.equal(provisioned.status, 200);
    assert.equal(provisioned.payload.phase, "provisioned");
    const tokenFile = `${process.env.RUNNER_TEMP}/stagepilot-tunnel-${installation.installationId}`;
    fs.writeFileSync(tokenFile, provisioned.payload.tunnelToken, { mode: 0o600 });
    tokenFiles.push(tokenFile);
    connectors.push(spawn(cloudflared, [
      "tunnel", "--no-autoupdate", "--loglevel", "error", "run", "--token-file", tokenFile,
    ], { stdio: "ignore" }));
  }

  // A freshly created proxied hostname is not served by every Cloudflare edge
  // colo the instant the provider confirms the route. Poll until each isolated
  // hostname actually answers, then assert, so an activation lag never reads as
  // a guardrail or isolation failure and never surfaces as a raw TLS error.
  const probe = async (hostname) => {
    try {
      return await httpsStatus(hostname);
    } catch (error) {
      return error instanceof Error ? error.message : "unreachable";
    }
  };
  const deadline = Date.now() + 240_000;
  let readiness = [];
  while (Date.now() < deadline) {
    readiness = await Promise.all(installations.map((item) => probe(item.hostname)));
    if (readiness.every((code) => code === 200)) break;
    await wait(3_000);
  }
  assert.deepEqual(
    readiness,
    installations.map(() => 200),
    `isolated hostnames did not both serve HTTPS 200 within the activation window: ${JSON.stringify(readiness)}`,
  );
  report.twoTunnelHttpsIsolation = true;

  await wait(11_000);
  assert((await Promise.all(installations.map((item) => wssStatus(item.hostname)))).every((code) => code === 101));
  report.wssBelowThreshold = true;

  await wait(11_000);
  // Fire the entire flood at once (not just in small batches): with only 60
  // requests permitted per colo per 10 seconds, any gap between batches risks
  // spreading the flood across window boundaries or letting keep-alive reuse
  // route requests to different edge colos one at a time. A single burst
  // matches how a real abusive client would actually trip this rule.
  const httpCodes = await Promise.all(
    Array.from({ length: 70 }, () => httpsStatus(installations[0].hostname)),
  );
  assert(httpCodes.slice(0, 10).includes(200));
  assert(httpCodes.includes(429));
  assert.notEqual(await httpsStatus("illuminary.studio"), 429);
  report.httpsAboveThresholdBlocked = true;
  report.unrelatedZoneHostUnaffected = true;

  await wait(11_000);
  // Fire the entire WSS flood at once, for the same reason as the HTTPS
  // flood above: sequential or lightly-batched fresh TLS handshakes can
  // spread across the 10-second rate-limit window under runner scheduling
  // jitter, letting the edge counter reset before the ceiling is reached.
  const websocketCodes = await Promise.all(
    Array.from({ length: 70 }, () => wssStatus(installations[0].hostname)),
  );
  assert(websocketCodes.slice(0, 10).includes(101));
  assert(websocketCodes.includes(429));
  report.wssUpgradesCountedAndBlocked = true;
} finally {
  for (const connector of connectors) connector.kill("SIGTERM");
  await wait(11_000);
  report.cleanup = [];
  // Retry revocation. A single transient provider failure must not strand a
  // disposable installation, because the deployed Worker exposes no route that
  // enumerates installations — an unrecorded, unrevoked ID is unrecoverable.
  for (const installation of installations) {
    let receipt = { installationId: installation.installationId, status: "failed" };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await wait(5_000);
      try {
        const revoked = await lifecycle(installation, "revoke", { method: "POST", body: {} });
        receipt = {
          installationId: installation.installationId,
          status: revoked.status,
          phase: revoked.payload.phase,
          revoked: revoked.payload.revoked,
        };
        if (revoked.status === 200 && revoked.payload.revoked === true) break;
      } catch {
        // Keep the failed receipt and retry.
      }
    }
    report.cleanup.push(receipt);
  }
  for (const tokenFile of tokenFiles) fs.rmSync(tokenFile, { force: true });
  server.close();
  // Emit the receipts unconditionally, including every enrolled installation ID.
  // A failed assertion above must still leave an operator an exact, actionable
  // record for revoke-control-plane-live-installation.yml.
  console.log(`CLEANUP_RECEIPTS ${JSON.stringify(report.cleanup)}`);
  const stranded = report.cleanup.filter((item) => item.revoked !== true).map((item) => item.installationId);
  if (stranded.length) {
    console.log(`STRANDED_INSTALLATIONS ${JSON.stringify(stranded)}`);
  }
}

assert(report.cleanup.every((item) => item.status === 200 && item.phase === "disabled" && item.revoked === true));
console.log(JSON.stringify(report));
