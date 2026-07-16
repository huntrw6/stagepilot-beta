import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const windowActions = vi.hoisted(() => ({
  close: vi.fn().mockResolvedValue(undefined),
  minimize: vi.fn().mockResolvedValue(undefined),
  toggleMaximize: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../desktop", () => ({
  closeDesktopWindow: windowActions.close,
  isDesktopShell: () => true,
  minimizeDesktopWindow: windowActions.minimize,
  toggleMaximizeDesktopWindow: windowActions.toggleMaximize,
}));

import { DesktopTitleBar } from "./DesktopTitleBar";

describe("DesktopTitleBar", () => {
  it("provides draggable desktop window controls", async () => {
    const user = userEvent.setup();
    render(<DesktopTitleBar />);

    const titleBar = screen.getByLabelText("Window controls");
    expect(titleBar).toHaveAttribute("data-tauri-drag-region");

    await user.click(screen.getByRole("button", { name: "Minimize window" }));
    await user.click(screen.getByRole("button", { name: "Maximize or restore window" }));
    await user.click(screen.getByRole("button", { name: "Close window" }));

    expect(windowActions.minimize).toHaveBeenCalledOnce();
    expect(windowActions.toggleMaximize).toHaveBeenCalledOnce();
    expect(windowActions.close).toHaveBeenCalledOnce();
  });
});
