import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  ApplicationState,
  LightsStatusResponse,
  SettingsResponse,
  Song,
} from "../types";
import { LightsSetupPanel } from "./LightsSetupPanel";

const song: Song = {
  id: "item-1",
  source_song_id: "song-1",
  title: "Holy Forever",
  duration_seconds: 336,
  order: 1,
  is_generic: false,
};

const lights: LightsStatusResponse = {
  enabled: true,
  output_name: "StagePilot to Lightkey",
  channel: 3,
  pulse_ms: 100,
  connection_status: "connected",
  detail: "Connected to lighting MIDI output StagePilot to Lightkey.",
  outputs: [{
    name: "StagePilot to Lightkey",
    ambiguous: false,
    selected: true,
    connected: true,
  }],
  last_cue: null,
  last_cue_at: null,
};

const settings: SettingsResponse = {
  planning_center_secret_saved: true,
  warning: null,
  restart_required: false,
  settings: {
    schema_version: 1,
    onboarding: { general_completed: true },
    integration_modes: {
      service_source: "planning_center",
      midi_source: "real",
      timer_output: "propresenter",
    },
    timezone: "America/Los_Angeles",
    log_level: "INFO",
    server_port: 8765,
    planning_center: {
      app_id: "app-id",
      service_type_id: "service-type",
      plan_title_preference: null,
      preferred_service_time: null,
      upcoming_lookahead_days: 30,
      request_timeout_seconds: 10,
    },
    midi: {
      enabled: true,
      input_name: "Playback",
      channel: 1,
      note: 112,
      mappings: {},
      debounce_ms: 250,
    },
    lights: {
      enabled: true,
      output_name: "StagePilot to Lightkey",
      channel: 3,
      pulse_ms: 100,
      cue_maps: {
        "song-1": {
          song_key: "song-1",
          song_title: "Holy Forever",
          cues: [{
            id: "c17d19ab-1447-4e73-898e-468b2dfa87c7",
            at_seconds: 65,
            note: 72,
            velocity: 110,
            label: "First chorus",
          }],
        },
      },
    },
    propresenter: {
      enabled: true,
      host: "127.0.0.1",
      port: 1025,
      timer_name: "Song Countdown",
      request_timeout_seconds: 3,
      reconnect_initial_seconds: 1,
      reconnect_max_seconds: 30,
      health_check_interval_seconds: 10,
    },
  },
};

const state: ApplicationState = {
  revision: 1,
  updated_at: "2026-07-15T19:00:00Z",
  application_status: "running",
  plan: {
    id: "plan-1",
    title: "Sunday",
    date: "2026-07-19",
    service_type: "Weekend",
    service_type_id: "service-type",
    service_times: ["09:00"],
    duration_source: "Planning Center",
    songs: [song],
  },
  current_song: song,
  next_song: null,
  current_song_index: 0,
  planning_center_status: "connected",
  midi_status: "connected",
  propresenter_status: "connected",
  lights_status: "connected",
  service_load: {
    status: "loaded",
    target_date: "2026-07-19",
    candidates: [],
    skipped_items: [],
    message: null,
    is_stale: false,
    last_attempt_at: "2026-07-15T19:00:00Z",
  },
  timer: { status: "running", duration_seconds: 336, started_at: "2026-07-15T19:00:00Z", last_error: null },
  plugins: {},
  recent_events: [],
  recent_errors: [],
  last_successful_plan_reload_at: "2026-07-15T19:00:00Z",
  last_action: "start_next",
};

describe("LightsSetupPanel", () => {
  it("loads and saves a per-song elapsed-time cue map", async () => {
    const user = userEvent.setup();
    const onSaveCues = vi.fn();
    render(
      <LightsSetupPanel
        error={null}
        lights={lights}
        message={null}
        onRefresh={vi.fn()}
        onSaveCues={onSaveCues}
        onSaveSettings={vi.fn()}
        onTest={vi.fn()}
        pendingOperation={null}
        settings={settings}
        state={state}
      />,
    );

    expect(screen.getByDisplayValue("01:05")).toBeInTheDocument();
    expect(screen.getByDisplayValue("First chorus")).toBeInTheDocument();
    expect(screen.getAllByRole("option", { name: "C4 (MIDI 72)" })).toHaveLength(2);

    const label = screen.getByLabelText("Lighting cue label");
    await user.clear(label);
    await user.type(label, "Chorus wash");
    await user.click(screen.getByRole("button", { name: "Save song lighting cues" }));

    expect(onSaveCues).toHaveBeenCalledOnce();
    expect(onSaveCues).toHaveBeenCalledWith(
      song,
      [expect.objectContaining({ at_seconds: 65, note: 72, velocity: 110, label: "Chorus wash" })],
    );
  });

  it("sends an explicit Note On/Off compatibility test", async () => {
    const user = userEvent.setup();
    const onTest = vi.fn();
    render(
      <LightsSetupPanel
        error={null}
        lights={lights}
        message={null}
        onRefresh={vi.fn()}
        onSaveCues={vi.fn()}
        onSaveSettings={vi.fn()}
        onTest={onTest}
        pendingOperation={null}
        settings={settings}
        state={state}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Test lighting note"), "76");
    await user.clear(screen.getByLabelText("Test lighting velocity"));
    await user.type(screen.getByLabelText("Test lighting velocity"), "115");
    await user.click(screen.getByRole("button", { name: "Send test cue" }));

    expect(onTest).toHaveBeenCalledWith(76, 115);
  });
});
