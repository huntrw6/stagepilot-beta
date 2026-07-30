import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  isDesktop: vi.fn(),
  login: vi.fn(),
}));

vi.mock("../api", () => ({
  getDashboardAuthStatus: mocks.getStatus,
  loginDashboard: mocks.login,
}));
vi.mock("../desktop", () => ({
  isDesktopShell: mocks.isDesktop,
}));

import { WebDashboardPinGate } from "./WebDashboardPinGate";

describe("WebDashboardPinGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDesktop.mockReturnValue(false);
    mocks.getStatus.mockResolvedValue({ required: true, authenticated: false });
  });

  it("shows the PIN step before rendering the web dashboard", async () => {
    const user = userEvent.setup();
    mocks.login.mockResolvedValue({ required: true, authenticated: true });
    render(
      <WebDashboardPinGate>
        <div>StagePilot loading screen</div>
      </WebDashboardPinGate>,
    );

    expect(screen.queryByText("StagePilot loading screen")).not.toBeInTheDocument();
    const input = await screen.findByLabelText("Dashboard PIN");
    await user.type(input, "1234");
    await user.click(screen.getByRole("button", { name: "Open dashboard" }));

    expect(mocks.login).toHaveBeenCalledWith("1234");
    expect(await screen.findByText("StagePilot loading screen")).toBeInTheDocument();
  });

  it("skips the PIN UI when protection is disabled", async () => {
    mocks.getStatus.mockResolvedValue({ required: false, authenticated: true });
    render(
      <WebDashboardPinGate>
        <div>StagePilot loading screen</div>
      </WebDashboardPinGate>,
    );

    expect(await screen.findByText("StagePilot loading screen")).toBeInTheDocument();
  });

  it("does not perform a web access check in the desktop shell", async () => {
    mocks.isDesktop.mockReturnValue(true);
    render(
      <WebDashboardPinGate>
        <div>Desktop loading screen</div>
      </WebDashboardPinGate>,
    );

    expect(screen.getByText("Desktop loading screen")).toBeInTheDocument();
    await waitFor(() => expect(mocks.getStatus).not.toHaveBeenCalled());
  });
});
