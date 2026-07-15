import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ProPresenterStatusResponse } from "../types";
import { ProPresenterSetupPanel } from "./ProPresenterSetupPanel";

const status: ProPresenterStatusResponse = {
  enabled: true,
  host: "127.0.0.1",
  port: 1025,
  timer_name: "Song Countdown",
  request_timeout_seconds: 3,
  connection_status: "connected",
  detail: 'Connected; countdown timer "Song Countdown" is ready.',
  timers: [
    {
      id: "timer-uuid",
      name: "Song Countdown",
      index: 0,
      is_countdown: true,
      state: "stopped",
    },
  ],
  selected_timer_id: "timer-uuid",
  timer_found: true,
  last_checked_at: "2026-07-14T12:00:00Z",
};

describe("ProPresenterSetupPanel", () => {
  it("saves validated session settings and exposes connection tools", async () => {
    const onSave = vi.fn();
    const onTest = vi.fn();
    const onRefreshTimers = vi.fn();
    const user = userEvent.setup();

    render(
      <ProPresenterSetupPanel
        error={null}
        message={null}
        onRefreshTimers={onRefreshTimers}
        onSave={onSave}
        onTest={onTest}
        pendingOperation={null}
        propresenter={status}
      />,
    );

    await user.clear(screen.getByLabelText("Host"));
    await user.type(screen.getByLabelText("Host"), "192.168.4.40");
    await user.click(screen.getByRole("button", { name: "Save and reconnect" }));
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    await user.click(screen.getByRole("button", { name: "Refresh timers" }));

    expect(onSave).toHaveBeenCalledWith({
      host: "192.168.4.40",
      port: 1025,
      timer_name: "Song Countdown",
      request_timeout_seconds: 3,
    });
    expect(onTest).toHaveBeenCalledOnce();
    expect(onRefreshTimers).toHaveBeenCalledOnce();
    expect(screen.getAllByText("Song Countdown").length).toBeGreaterThan(0);
  });

  it("distinguishes an API connection from a missing timer", () => {
    render(
      <ProPresenterSetupPanel
        error={null}
        message={null}
        onRefreshTimers={vi.fn()}
        onSave={vi.fn()}
        onTest={vi.fn()}
        pendingOperation={null}
        propresenter={{
          ...status,
          timer_found: false,
          selected_timer_id: null,
          detail: 'API connected, but timer "Song Countdown" was not found.',
        }}
      />,
    );

    expect(screen.getAllByText("connected")).toHaveLength(2);
    expect(screen.getByText("Not found")).toBeInTheDocument();
    expect(screen.getByText(/API connected, but timer/i)).toBeInTheDocument();
  });

  it("saves output mode and connection settings before the plugin is running", async () => {
    const onOutputChange = vi.fn();
    const onSave = vi.fn();
    const user = userEvent.setup();

    render(
      <ProPresenterSetupPanel
        error={null}
        message={null}
        onOutputChange={onOutputChange}
        onRefreshTimers={vi.fn()}
        onSave={onSave}
        onTest={vi.fn()}
        output="simulated"
        pendingOperation={null}
        propresenter={{ ...status, enabled: false, connection_status: "disconnected" }}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Timer output"), "propresenter");
    await user.click(screen.getByRole("button", { name: "Save timer mode" }));
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(onOutputChange).toHaveBeenCalledWith("propresenter");
    expect(onSave).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: 1025,
      timer_name: "Song Countdown",
      request_timeout_seconds: 3,
    });
  });
});
