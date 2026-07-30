import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");

describe("macOS repository-local setup", () => {
  it("is strict, architecture-aware, checksum-verifying, and idempotent", async () => {
    const script = await readFile(path.join(root, "scripts/setup-multitracks-cues.sh"), "utf8");
    expect(script).toContain("set -euo pipefail");
    expect(script).toMatch(/Darwin-arm64/);
    expect(script).toMatch(/Darwin-x86_64/);
    expect(script).toContain("nodejs.org/dist");
    expect(script).toContain("SHASUMS256.txt");
    expect(script).toContain('EXPECTED" = "$ACTUAL');
    expect(script).toContain("multitracks-cues-lock.sha256");
  });

  it("launches without npm link and falls back to the verified local runtime", async () => {
    const launcher = await readFile(path.join(root, "bin/stagepilot-cues"), "utf8");
    expect(launcher).not.toContain("npm link");
    expect(launcher).toContain(".tools/node/node-v22.23.1");
    expect(launcher).toContain("dist/cli/main.js");
  });
});
