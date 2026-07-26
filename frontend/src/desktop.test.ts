import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  isTauri: vi.fn(() => true),
}));

vi.mock("@tauri-apps/api/core", () => tauri);

import { hideDesktopWindow } from "./desktop";

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
