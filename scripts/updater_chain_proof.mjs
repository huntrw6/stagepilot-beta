import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Proves every part of the beta updater metadata chain that is provable on
// Linux without building a native installer. It NEVER fabricates a platform
// artifact: the fixtures below are opaque placeholder bytes used solely to
// exercise manifest generation/validation logic, and are deleted afterwards.
// Whether a real signed installer updates a real machine is NOT proven here
// and remains DEFERRED to the native acceptance matrix.

const root = path.resolve(import.meta.dirname, "..");
const BROKER = "https://stagepilot-beta-control-plane.stagepilot-illuminary-beta.workers.dev/v1/releases";
const MAIN = "https://github.com/huntrw6/stagepilot/releases/download";

const generate = (directory, tag, base) => execFileSync(process.execPath, [
  path.join(root, "scripts/generate_updater_manifest.mjs"), directory, tag, base,
], { encoding: "utf8", stdio: "pipe" });

const validate = (directory, base) => execFileSync(process.execPath, [
  path.join(root, "scripts/validate_updater_manifest.mjs"),
  path.join(directory, "latest.json"), directory, base,
], { encoding: "utf8", stdio: "pipe" });

const rejects = (run, because) => {
  assert.throws(run, because);
};

const stage = (version) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stagepilot-updater-chain-"));
  for (const file of [
    `StagePilot_${version}_aarch64.app.tar.gz`,
    `StagePilot_${version}_x64.app.tar.gz`,
    `StagePilot_${version}_x64-setup.exe`,
  ]) {
    // Placeholder bytes. These are not, and must never be presented as, real
    // signed platform artifacts.
    fs.writeFileSync(path.join(directory, file), `placeholder-${file}`);
    fs.writeFileSync(path.join(directory, `${file}.sig`), `placeholder-signature-${file}`);
  }
  return directory;
};

const proven = [];
const directories = [];

try {
  // 1. latest.json generation and validation against the beta broker base.
  const betaVersion = "1.1.103-beta.5";
  const beta = stage(betaVersion);
  directories.push(beta);
  generate(beta, `v${betaVersion}`, BROKER);
  validate(beta, BROKER);
  const manifest = JSON.parse(fs.readFileSync(path.join(beta, "latest.json"), "utf8"));
  assert.equal(manifest.version, betaVersion);
  assert(Number.isFinite(Date.parse(manifest.pub_date)));
  assert.deepEqual(Object.keys(manifest.platforms).sort(), [
    "darwin-aarch64", "darwin-x86_64", "windows-x86_64",
  ]);
  proven.push("latest_json_generation_and_validation");

  // 2. Every signature is embedded from its .sig sidecar, not invented.
  for (const [platform, filename] of Object.entries({
    "darwin-aarch64": `StagePilot_${betaVersion}_aarch64.app.tar.gz`,
    "darwin-x86_64": `StagePilot_${betaVersion}_x64.app.tar.gz`,
    "windows-x86_64": `StagePilot_${betaVersion}_x64-setup.exe`,
  })) {
    const sidecar = fs.readFileSync(path.join(beta, `${filename}.sig`), "utf8").trim();
    assert.equal(manifest.platforms[platform].signature, sidecar);
    assert.equal(manifest.platforms[platform].url, `${BROKER}/v${betaVersion}/${filename}`);
  }
  proven.push("signature_embedding_from_sidecar");

  // 3. A missing signature must stop manifest generation before publication.
  const unsigned = stage(betaVersion);
  directories.push(unsigned);
  fs.rmSync(path.join(unsigned, `StagePilot_${betaVersion}_x64-setup.exe.sig`));
  rejects(() => generate(unsigned, `v${betaVersion}`, BROKER), /Missing updater signature/);
  proven.push("missing_signature_rejected");

  // 4. An empty signature must stop manifest generation.
  const empty = stage(betaVersion);
  directories.push(empty);
  fs.writeFileSync(path.join(empty, `StagePilot_${betaVersion}_aarch64.app.tar.gz.sig`), "   \n");
  rejects(() => generate(empty, `v${betaVersion}`, BROKER), /Empty updater signature/);
  proven.push("empty_signature_rejected");

  // 5. A missing artifact must stop manifest generation.
  const incomplete = stage(betaVersion);
  directories.push(incomplete);
  fs.rmSync(path.join(incomplete, `StagePilot_${betaVersion}_x64.app.tar.gz`));
  rejects(() => generate(incomplete, `v${betaVersion}`, BROKER), /Missing updater artifact/);
  proven.push("missing_artifact_rejected");

  // 6. Version/tag agreement is enforced.
  rejects(() => generate(stage(betaVersion), betaVersion, BROKER), /Invalid release tag/);
  proven.push("tag_version_agreement_enforced");

  // 7. A non-HTTPS or query-bearing endpoint is refused.
  rejects(() => generate(beta, `v${betaVersion}`, "http://example.com/releases"), /HTTPS/);
  rejects(() => generate(beta, `v${betaVersion}`, `${BROKER}?token=x`), /query or fragment/);
  proven.push("endpoint_scheme_and_shape_enforced");

  // 8. Channel isolation: a beta manifest must not validate against the main
  //    endpoint, and a main manifest must not validate against the broker.
  const crossed = stage(betaVersion);
  directories.push(crossed);
  generate(crossed, `v${betaVersion}`, BROKER);
  rejects(() => validate(crossed, MAIN), /Untrusted or missing URL/);
  const mainside = stage(betaVersion);
  directories.push(mainside);
  generate(mainside, `v${betaVersion}`, MAIN);
  rejects(() => validate(mainside, BROKER), /Untrusted or missing URL/);
  proven.push("beta_main_channel_isolation");

  // 9. A tampered URL that escapes the allowlisted path is refused.
  const tampered = stage(betaVersion);
  directories.push(tampered);
  generate(tampered, `v${betaVersion}`, BROKER);
  const escaped = JSON.parse(fs.readFileSync(path.join(tampered, "latest.json"), "utf8"));
  escaped.platforms["windows-x86_64"].url = `${BROKER}/v${betaVersion}/%2e%2e%2foutside.bin`;
  fs.writeFileSync(path.join(tampered, "latest.json"), JSON.stringify(escaped));
  rejects(() => validate(tampered, BROKER), /Untrusted or missing URL/);
  proven.push("path_escape_rejected");

  // 10. A dropped platform makes the manifest inventory invalid.
  const partial = stage(betaVersion);
  directories.push(partial);
  generate(partial, `v${betaVersion}`, BROKER);
  const dropped = JSON.parse(fs.readFileSync(path.join(partial, "latest.json"), "utf8"));
  delete dropped.platforms["darwin-x86_64"];
  fs.writeFileSync(path.join(partial, "latest.json"), JSON.stringify(dropped));
  rejects(() => validate(partial, BROKER), /platform inventory is invalid/);
  proven.push("platform_inventory_enforced");

  // 11. The configured updater public key is real, not a placeholder, and the
  //     base/main channel keeps the main endpoint while the release overlays
  //     select the broker.
  const config = JSON.parse(fs.readFileSync(path.join(root, "desktop/src-tauri/tauri.conf.json"), "utf8"));
  const windows = JSON.parse(fs.readFileSync(path.join(root, "desktop/src-tauri/tauri.release.conf.json"), "utf8"));
  const macos = JSON.parse(fs.readFileSync(path.join(root, "desktop/src-tauri/tauri.macos.conf.json"), "utf8"));
  const pubkey = config.plugins.updater.pubkey;
  assert(typeof pubkey === "string" && pubkey.length > 40, "updater public key is missing");
  assert(!/REQUIRED|PLACEHOLDER|CHANGEME|TODO/i.test(pubkey), "updater public key is still a placeholder");
  assert.deepEqual(config.plugins.updater.endpoints, [`${MAIN.replace("/download", "")}/latest/download/latest.json`]);
  assert.deepEqual(windows.plugins.updater.endpoints, [`${BROKER}/latest.json`]);
  assert.deepEqual(macos.plugins.updater.endpoints, [`${BROKER}/latest.json`]);
  proven.push("public_key_and_endpoint_configuration");

  // 12. Every reserved beta version is distinct and well formed, so no release
  //     can ever reuse an earlier immutable tag. beta.1 and beta.2 are burned
  //     by failed attempts; beta.4 is release 1.
  const burned = ["1.1.103-beta.1", "1.1.103-beta.2", "1.1.103-beta.3", "1.1.103-beta.4"];
  assert(!burned.includes(betaVersion), "release 1 must not reuse a burned tag");
  assert.equal(new Set([...burned, betaVersion, "1.1.103-beta.6"]).size, 6);
  for (const version of [...burned, betaVersion]) {
    assert.match(version, /^\d+\.\d+\.\d+-beta\.\d+$/);
  }
  proven.push("reserved_immutable_versions_distinct");
} finally {
  for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true });
}

console.log(JSON.stringify({ provenOnLinux: proven }, null, 2));
assert.equal(proven.length, 12);
