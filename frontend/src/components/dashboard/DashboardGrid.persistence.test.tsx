import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDefaultDashboardLayout } from "./dashboardLayout";
import { DASHBOARD_LAYOUT_KEY, loadDashboardLayout } from "./dashboardLayoutStorage";
import { DashboardGrid } from "./DashboardGrid";

const widgets = {
  "service-plan": <div>Service Plan content</div>,
  "now-playing": <div>Now Playing content</div>,
  "manual-controls": <div>Manual Controls content</div>,
  events: <div>Events content</div>,
};

// jsdom does not provide a working `localStorage` under this test runner's
// flags, so this stands in for the durable storage the real desktop app
// writes to (its webview's persistent origin storage). It behaves exactly
// like the real localStorage API the component code calls.
class MemoryLocalStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.get(key) ?? null; }
  key(index: number) { return [...this.map.keys()][index] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, value); }
}

describe("dashboard layout persists across a simulated app restart", () => {
  let durableStorage: MemoryLocalStorage;

  beforeEach(() => {
    durableStorage = new MemoryLocalStorage();
    Object.defineProperty(window, "localStorage", {
      value: durableStorage,
      configurable: true,
    });
  });
  afterEach(() => {
    durableStorage.clear();
  });

  it("survives unmount -> fresh mount (app restart) with the moved item still in place", async () => {
    // First "launch": mount, enter edit mode, and reorder a widget via the
    // accessible keyboard controls (equivalent to a drag reorder).
    const first = render(<DashboardGrid widgets={widgets} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit layout" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Now Playing earlier" }));

    const persistedAfterMove = loadDashboardLayout(durableStorage);
    const defaultLayout = createDefaultDashboardLayout();
    expect(persistedAfterMove.desktop).not.toEqual(defaultLayout.desktop);

    // Simulate a full app restart: unmount the component tree entirely
    // (as happens when the desktop shell's webview is torn down) and
    // mount a brand-new instance reading from the same durable storage --
    // never touching React state carried over from the first mount.
    first.unmount();

    const second = render(<DashboardGrid widgets={widgets} />);
    const rehydrated = loadDashboardLayout(durableStorage);
    expect(rehydrated.desktop).toEqual(persistedAfterMove.desktop);
    expect(rehydrated.desktop).not.toEqual(defaultLayout.desktop);
    second.unmount();
  });

  it("falls back to the reset layout when nothing was ever saved", () => {
    expect(durableStorage.getItem(DASHBOARD_LAYOUT_KEY)).toBeNull();
    render(<DashboardGrid widgets={widgets} />);
    const stored = loadDashboardLayout(durableStorage);
    expect(stored).toEqual(createDefaultDashboardLayout());
  });
});
