import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getVersion: vi.fn().mockResolvedValue("1.2.0"),
  isTauri: vi.fn(() => true),
  unminimize: vi.fn().mockResolvedValue(undefined),
  show: vi.fn().mockResolvedValue(undefined),
  setFocus: vi.fn().mockResolvedValue(undefined),
  saveWindowState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: mocks.getVersion }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    unminimize: mocks.unminimize,
    show: mocks.show,
    setFocus: mocks.setFocus,
  }),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-window-state", () => ({
  saveWindowState: mocks.saveWindowState,
  StateFlags: { ALL: 63 },
}));

import {
  tauriUpdaterAdapter,
  UPDATE_RELAUNCH_MARKER,
} from "./updater";

describe("Tauri updater adapter relaunch state", () => {
  beforeEach(() => {
    localStorage.clear();
    location.hash = "";
    vi.clearAllMocks();
    mocks.isTauri.mockReturnValue(true);
    mocks.getVersion.mockResolvedValue("1.2.0");
  });

  it("is disabled in the browser runtime", () => {
    mocks.isTauri.mockReturnValue(false);
    expect(tauriUpdaterAdapter.isEnabled()).toBe(false);
  });

  it("saves window state and a version-bound marker before installation", async () => {
    location.hash = "#dashboard";

    await tauriUpdaterAdapter.prepareRelaunch("1.2.0");

    expect(mocks.saveWindowState).toHaveBeenCalledWith(63);
    expect(JSON.parse(localStorage.getItem(UPDATE_RELAUNCH_MARKER)!)).toMatchObject({
      targetVersion: "1.2.0",
      route: "#dashboard",
    });
  });

  it("restores, unminimizes, shows, and focuses only after a matching update", async () => {
    localStorage.setItem(UPDATE_RELAUNCH_MARKER, JSON.stringify({
      targetVersion: "1.2.0",
      route: "#dashboard",
      createdAt: new Date().toISOString(),
    }));

    const result = await tauriUpdaterAdapter.restoreAfterRelaunch();

    expect(result).toEqual({ updatedVersion: "1.2.0", route: "#dashboard" });
    expect(mocks.unminimize).toHaveBeenCalledBefore(mocks.show);
    expect(mocks.show).toHaveBeenCalledBefore(mocks.setFocus);
    expect(localStorage.getItem(UPDATE_RELAUNCH_MARKER)).toBeNull();
  });

  it("does not claim success for an ordinary or mismatched launch", async () => {
    expect(await tauriUpdaterAdapter.restoreAfterRelaunch()).toBeNull();

    localStorage.setItem(UPDATE_RELAUNCH_MARKER, JSON.stringify({
      targetVersion: "1.3.0",
      route: null,
      createdAt: new Date().toISOString(),
    }));
    expect(await tauriUpdaterAdapter.restoreAfterRelaunch()).toBeNull();
    expect(mocks.show).not.toHaveBeenCalled();
  });
});
