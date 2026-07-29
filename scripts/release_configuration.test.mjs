import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Tauri updater configuration preserves stable identity and trusted endpoint", () => {
  const config = JSON.parse(read("desktop/src-tauri/tauri.conf.json"));
  const macOSConfig = JSON.parse(read("desktop/src-tauri/tauri.macos.conf.json"));
  assert.equal(config.productName, "StagePilot");
  assert.equal(config.identifier, "org.stagepilot.desktop");
  assert.equal(config.app.windows[0].label, "main");
  assert.equal(config.bundle.createUpdaterArtifacts, true);
  assert.equal(config.bundle.macOS.signingIdentity, "-");
  assert.equal(macOSConfig.bundle.macOS.signingIdentity, "-");
  assert.equal(macOSConfig.bundle.macOS.hardenedRuntime, false);
  assert.equal(macOSConfig.bundle.macOS.minimumSystemVersion, "12.0");
  assert.deepEqual(macOSConfig.bundle.targets, ["app", "dmg"]);
  assert.deepEqual(config.plugins.updater.endpoints, [
    "https://github.com/huntrw6/stagepilot/releases/latest/download/latest.json",
  ]);
  assert.ok(config.plugins.updater.pubkey);
});
test("desktop capability is narrow and contains updater lifecycle permissions", () => {
  const capability = JSON.parse(read("desktop/src-tauri/capabilities/default.json"));
  assert.ok(capability.permissions.includes("updater:default"));
  assert.ok(capability.permissions.includes("process:allow-restart"));
  assert.ok(capability.permissions.includes("window-state:default"));
  for (const dangerous of ["shell:allow-execute", "shell:allow-open", "fs:default"]) {
    assert.ok(!capability.permissions.includes(dangerous));
  }
});

test("release workflow requires secrets and publishes latest.json last", () => {
  const workflow = read(".github/workflows/release-macos.yml");
  assert.match(workflow, /secrets\.TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(workflow, /secrets\.TAURI_SIGNING_PRIVATE_KEY_PASSWORD/);
  assert.match(workflow, /generate_updater_manifest\.mjs/);
  assert.match(workflow, /validate_updater_manifest\.mjs/);
  assert.match(workflow, /MACOSX_DEPLOYMENT_TARGET: "12\.0"/);
  assert.match(workflow, /verify_macos_release_bundle\.sh --app/);
  assert.match(workflow, /verify_macos_release_bundle\.sh --dmg/);
  assert.match(workflow, /verify_macos_release_bundle\.sh --archive/);
  assert.ok(
    workflow.indexOf("verify_macos_release_bundle.sh --archive") <
      workflow.indexOf("Collect macOS release assets"),
  );
  assert.doesNotMatch(workflow, /APPLE_(?:CERTIFICATE|SIGNING_IDENTITY|ID|PASSWORD)/);
  assert.doesNotMatch(workflow, /notarytool|notariz/);
  assert.match(workflow, /Copy-Item \$installer\.FullName/);
  assert.match(workflow, /Copy-Item "\$\(\$installer\.FullName\)\.sig"/);
  assert.match(
    workflow,
    /find release-assets .* ! -name '\*\.sig'/,
    "standalone updater signatures must not be published as user-facing release assets",
  );
  assert.ok(
    workflow.indexOf('! -name latest.json') < workflow.indexOf("release-assets/latest.json --clobber"),
  );
  assert.ok(
    workflow.indexOf("release-assets/latest.json --clobber") < workflow.indexOf("--draft=false --latest"),
  );
});

test("macOS final-artifact verifier rejects hardened sidecars and starts packaged backends", () => {
  const verifier = read("scripts/verify_macos_release_bundle.sh");
  assert.match(verifier, /codesign --verify --deep --strict/);
  assert.match(verifier, /flags=\.\*runtime/);
  assert.match(verifier, /TeamIdentifier/);
  assert.match(verifier, /vtool -show-build/);
  assert.match(verifier, /LC_VERSION_MIN_MACOSX/);
  assert.match(verifier, /otool -l/);
  assert.match(verifier, /api\/v1\/health/);
  assert.match(verifier, /api\/v1\/state/);
  assert.match(verifier, /hdiutil attach/);
  assert.match(verifier, /tar -xzf/);
});

test("PyInstaller uses ordinary ad-hoc signing without a custom identity or entitlements", () => {
  const specification = read("backend/stagepilot.spec");
  assert.match(specification, /codesign_identity=None/);
  assert.match(specification, /entitlements_file=None/);
  assert.doesNotMatch(specification, /Developer ID Application/);
  assert.doesNotMatch(specification, /disable-library-validation/);
});

test("manifest generator requires artifacts and signatures for every platform", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stagepilot-updater-"));
  try {
    for (const file of [
      "StagePilot_1.2.0_aarch64.app.tar.gz",
      "StagePilot_1.2.0_x64.app.tar.gz",
      "StagePilot_1.2.0_x64-setup.exe",
    ]) {
      fs.writeFileSync(path.join(directory, file), "artifact");
      fs.writeFileSync(path.join(directory, `${file}.sig`), `signature-${file}`);
    }
    execFileSync(process.execPath, [
      path.join(root, "scripts/generate_updater_manifest.mjs"),
      directory,
      "v1.2.0",
    ]);
    execFileSync(process.execPath, [
      path.join(root, "scripts/validate_updater_manifest.mjs"),
      path.join(directory, "latest.json"),
      directory,
    ]);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "latest.json"), "utf8"));
    assert.equal(manifest.version, "1.2.0");
    assert.deepEqual(Object.keys(manifest.platforms).sort(), [
      "darwin-aarch64",
      "darwin-x86_64",
      "windows-x86_64",
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("repository does not track private updater key files", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
  assert.doesNotMatch(tracked, /\.(key|pem)$/m);
});
