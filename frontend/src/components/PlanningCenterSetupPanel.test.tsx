import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ApplicationState, SettingsResponse } from "../types";
import { PlanningCenterSetupPanel } from "./PlanningCenterSetupPanel";

const settings: SettingsResponse = {
  settings: {
    schema_version: 1,
    onboarding: { general_completed: false },
    integration_modes: {
      service_source: "demo",
      midi_source: "simulated",
      timer_output: "simulated",
    },
    timezone: "America/Los_Angeles",
    log_level: "INFO",
    server_port: 8765,
    planning_center: {
      app_id: "saved-app-id",
      service_type_id: "sunday",
      plan_title_preference: "Sunday Morning",
      preferred_service_time: "09:00",
      upcoming_lookahead_days: 30,
      request_timeout_seconds: 10,
    },
    midi: {
      enabled: false,
      input_name: null,
      channel: 1,
      note: 112,
      mappings: {
        start_next: 100,
        restart_current: 101,
        previous: 102,
        next: 103,
        reload_plan: 104,
        stop_timer: 105,
      },
      debounce_ms: 250,
    },
    lights: {
      enabled: false,
      output_name: null,
      channel: 1,
      pulse_ms: 100,
      cue_maps: {},
    },
    propresenter: {
      enabled: false,
      host: "127.0.0.1",
      port: 1025,
      timer_name: "Song Countdown",
      request_timeout_seconds: 3,
      reconnect_initial_seconds: 1,
      reconnect_max_seconds: 30,
      health_check_interval_seconds: 10,
    },
  },
  planning_center_secret_saved: true,
  warning: null,
  restart_required: false,
};

const state: ApplicationState = {
  revision: 1,
  updated_at: "2026-07-14T12:00:00Z",
  application_status: "running",
  plan: null,
  current_song: null,
  next_song: null,
  current_song_index: null,
  planning_center_status: "disconnected",
  midi_status: "disconnected",
  propresenter_status: "disconnected",
  lights_status: "disconnected",
  service_load: {
    status: "idle",
    target_date: null,
    candidates: [],
    skipped_items: [],
    message: null,
    is_stale: false,
    last_attempt_at: null,
  },
  timer: {
    status: "idle",
    duration_seconds: null,
    started_at: null,
    last_error: null,
  },
  plugins: {},
  recent_events: [],
  recent_errors: [],
  last_successful_plan_reload_at: null,
  last_action: null,
};

function renderPanel({ onTest = vi.fn(), onSave = vi.fn() } = {}) {
  render(
    <PlanningCenterSetupPanel
      error={null}
      message={null}
      onClose={vi.fn()}
      onLoadServiceTypes={vi.fn()}
      onReload={vi.fn()}
      onSave={onSave}
      onSelectPlan={vi.fn()}
      onTest={onTest}
      pendingAction={null}
      pendingOperation={null}
      pendingPlanId={null}
      serviceTypes={[
        { id: "sunday", name: "Sunday Morning" },
        { id: "wednesday", name: "Wednesday Service" },
      ]}
      settings={settings}
      state={state}
      status={{
        connection_status: "disconnected",
        configured: true,
        app_id: "saved-app-id",
        service_type_id: "sunday",
        planning_center_secret_saved: true,
        detail: null,
      }}
    />,
  );
}

describe("PlanningCenterSetupPanel", () => {
  it("populates saved public settings while keeping the credential masked", () => {
    renderPanel();

    expect(screen.getByLabelText("Application ID")).toHaveValue("saved-app-id");
    expect(screen.getByLabelText("Secret")).toHaveValue("");
    expect(screen.getByLabelText("Secret")).toHaveAttribute(
      "placeholder",
      "Saved securely — leave blank to keep",
    );
    expect(screen.getByLabelText("Service type")).toHaveValue("sunday");
    expect(screen.getByLabelText("Timezone")).toHaveValue("America/Los_Angeles");
  });

  it("tests temporary credentials and saves a discovered service type", async () => {
    const onTest = vi.fn();
    const onSave = vi.fn();
    const user = userEvent.setup();
    renderPanel({ onSave, onTest });

    await user.type(screen.getByLabelText("Secret"), "replacement-secret");
    await user.click(screen.getByRole("button", { name: "Test connection" }));

    expect(onTest).toHaveBeenCalledWith({
      app_id: "saved-app-id",
      secret: "replacement-secret",
    });

    expect(screen.queryByLabelText("Service source")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Service type"), "wednesday");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        app_id: "saved-app-id",
        secret: "replacement-secret",
        service_type_id: "wednesday",
        plan_title_preference: "Sunday Morning",
        preferred_service_time: "09:00",
      }),
      "America/Los_Angeles",
    );
  });
});
