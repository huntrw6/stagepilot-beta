import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  isTauri: vi.fn(() => true),
}));

vi.mock("@tauri-apps/api/core", () => tauri);

import { backendStartupTitle, hideDesktopWindow } from "./desktop";

describe("backend startup labels", () => {
  it("distinguishes actionable packaged-backend failures", () => {
    expect(
      backendStartupTitle({
        state: "failed",
        message: "blocked",
        port: 8765,
        managed: true,
        failure_kind: "macos_code_signing",
        log_path: "/tmp/backend.log",
      }),
    ).toBe("macOS blocked the packaged backend");
    expect(
      backendStartupTitle({
        state: "failed",
        message: "occupied",
        port: 8765,
        managed: false,
        failure_kind: "port_occupied",
      }),
    ).toBe("Backend port is occupied");
  });
});

describe("desktop window controls", () => {
  beforeEach(() => {
    tauri.invoke.mockClear();
    tauri.isTauri.mockReturnValue(true);
  });

  it("hides the native window without quitting the application", async () => {
    await hideDesktopWindow();

    expect(tauri.invoke).toHaveBeenCalledWith("hide_application_window");
  });

  it("does nothing in the browser dashboard", async () => {
    tauri.isTauri.mockReturnValue(false);

    await hideDesktopWindow();

    expect(tauri.invoke).not.toHaveBeenCalled();
  });
});
