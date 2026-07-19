import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigurationStore, applicationDataDirectory } from "../src/config/store.js";
import { defaultConfiguration } from "../src/config/schema.js";

describe("configuration", () => {
  it("uses standard macOS and Windows application data paths", () => {
    expect(applicationDataDirectory("darwin", {}, "/Users/stagepilot")).toBe("/Users/stagepilot/Library/Application Support/StagePilot/multitracks-cues");
    expect(applicationDataDirectory("win32", { APPDATA: "C:\\Roaming" }, "C:\\Users\\stagepilot")).toBe("C:\\Roaming\\StagePilot\\multitracks-cues");
  });

  it("round-trips validated settings with no secret fields", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "stagepilot-cues-"));
    const file = path.join(directory, "config.json");
    const store = new ConfigurationStore(file);
    await store.save({ ...defaultConfiguration, midiBus: { id: "aux-1", type: "Aux" } });
    expect(await store.load()).toMatchObject({ midiBus: { id: "aux-1" }, note: 112, velocity: 100 });
    expect(await readFile(file, "utf8")).not.toMatch(/access_token|refresh_token|clientSecret/i);
  });

  it("preserves corrupt configuration for diagnosis", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "stagepilot-cues-"));
    const file = path.join(directory, "config.json");
    await writeFile(file, "not json");
    await expect(new ConfigurationStore(file).load()).rejects.toThrow(/diagnostic copy/);
  });
});
