import { afterEach, describe, expect, it, vi } from "vitest";

import {
  apiOrigin,
  getLightsStatus,
  getMidiInputs,
  getMidiMessages,
  getPlanningCenterServiceTypes,
  rememberServerPort,
  refreshMidiInputs,
  selectMidiInput,
  selectPlanningCenterPlan,
  simulateMidiCue,
  testLightingCue,
  testPlanningCenter,
  updatePlanningCenterSettings,
  updateLightingCueMap,
  updateLightsSettings,
} from "./api";
import type {
  MidiCueSimulationResponse,
  MidiInputSelectionResponse,
  MidiInputsResponse,
  MidiMonitorResponse,
  PlanSelectionResponse,
} from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("dashboard server port", () => {
  it("remembers a validated saved port for the next dashboard launch", () => {
    rememberServerPort(9001);

    expect(window.localStorage.getItem("stagepilot.server-port")).toBe("9001");
  });
});

describe("Planning Center onboarding API", () => {
  it("tests temporary credentials and loads saved service types", async () => {
    const tested = {
      authenticated: true as const,
      message: "Planning Center authentication succeeded.",
      service_types: [{ id: "sunday", name: "Sunday Morning" }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(tested),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(tested.service_types),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      testPlanningCenter({ app_id: "app-id", secret: "private-secret" }),
    ).resolves.toEqual(tested);
    await expect(getPlanningCenterServiceTypes()).resolves.toEqual(tested.service_types);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${apiOrigin}/api/v1/planning-center/test`,
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: "app-id", secret: "private-secret" }),
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${apiOrigin}/api/v1/planning-center/service-types`,
      { headers: { Accept: "application/json" } },
    );
  });

  it("sends the credential only to the protected settings endpoint", async () => {
    const response = { planning_center_secret_saved: true };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(response),
    });
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      app_id: "app-id",
      service_type_id: "sunday",
      plan_title_preference: null,
      preferred_service_time: "09:00",
      upcoming_lookahead_days: 30,
      request_timeout_seconds: 10,
      secret: "private-secret",
    };

    await updatePlanningCenterSettings(input);

    expect(fetchMock).toHaveBeenCalledWith(
      `${apiOrigin}/api/v1/planning-center/settings`,
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  });
});

describe("selectPlanningCenterPlan", () => {
  it("posts the selected Planning Center plan ID as JSON", async () => {
    const response: PlanSelectionResponse = {
      accepted: true,
      message: "Plan loaded.",
      state: {
        revision: 1,
        updated_at: "2026-07-13T16:00:00Z",
        application_status: "running",
        plan: null,
        current_song: null,
        next_song: null,
        current_song_index: null,
        planning_center_status: "connected",
        midi_status: "connected",
        propresenter_status: "connected",
        lights_status: "disconnected",
        service_load: {
          status: "loaded",
          target_date: "2026-07-13",
          candidates: [],
          skipped_items: [],
          message: null,
          is_stale: false,
          last_attempt_at: "2026-07-13T16:00:00Z",
        },
        timer: {
          status: "stopped",
          duration_seconds: null,
          started_at: null,
          last_error: null,
        },
        plugins: {},
        recent_events: [],
        recent_errors: [],
        last_successful_plan_reload_at: "2026-07-13T16:00:00Z",
        last_action: null,
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(response),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(selectPlanningCenterPlan("plan-evening")).resolves.toEqual(response);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      `${apiOrigin}/api/v1/planning-center/plans/select`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ plan_id: "plan-evening" }),
      },
    );
  });
});

const midi: MidiInputsResponse = {
  enabled: true,
  channel: 1,
  note: 112,
  configured_input_name: null,
  selected_input_name: null,
  inputs: [],
  mappings: {
    start_next: 100,
    restart_current: 101,
    previous: 102,
    next: 103,
    reload_plan: 104,
    stop_timer: 105,
  },
};

describe("MIDI API", () => {
  it("gets and refreshes the available inputs", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(midi),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getMidiInputs()).resolves.toEqual(midi);
    await expect(refreshMidiInputs()).resolves.toEqual(midi);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${apiOrigin}/api/v1/midi/inputs`,
      { headers: { Accept: "application/json" } },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${apiOrigin}/api/v1/midi/inputs/refresh`,
      { method: "POST", headers: { Accept: "application/json" } },
    );
  });

  it("gets recent MIDI monitor messages", async () => {
    const monitor: MidiMonitorResponse = { messages: [] };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(monitor),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getMidiMessages()).resolves.toEqual(monitor);
    expect(fetchMock).toHaveBeenCalledWith(
      `${apiOrigin}/api/v1/midi/messages`,
      { headers: { Accept: "application/json" } },
    );
  });

  it("posts input selections and cue simulations as JSON", async () => {
    const selection: MidiInputSelectionResponse = {
      accepted: true,
      message: "Input selected.",
      midi,
    };
    const simulation = {
      cue: "start_next",
      action: "start_next",
      accepted: true,
      message: "Cue accepted.",
      state: {
        revision: 2,
      },
    } as MidiCueSimulationResponse;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(selection),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(simulation),
      });
    vi.stubGlobal("fetch", fetchMock);
    const inputId = "a".repeat(64);

    await expect(selectMidiInput(inputId)).resolves.toEqual(selection);
    await expect(simulateMidiCue("start_next")).resolves.toEqual(simulation);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${apiOrigin}/api/v1/midi/input-selection`,
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ input_id: inputId }),
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${apiOrigin}/api/v1/midi/cue-simulation`,
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ cue: "start_next" }),
      },
    );
  });
});

describe("Lights API", () => {
  it("configures output and sends cue maps and test pulses as JSON", async () => {
    const lights = {
      enabled: true,
      output_name: "StagePilot to Lightkey",
      channel: 3,
      pulse_ms: 100,
      connection_status: "connected" as const,
      detail: "Connected.",
      outputs: [],
      last_cue: null,
      last_cue_at: null,
    };
    const operation = { accepted: true, message: "Saved.", lights };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(operation),
    });
    vi.stubGlobal("fetch", fetchMock);
    const outputSettings = {
      enabled: true,
      output_name: "StagePilot to Lightkey",
      channel: 3,
      pulse_ms: 100,
    };
    const cueMap = {
      song_key: "song-1",
      song_title: "Holy Forever",
      cues: [{
        id: "c17d19ab-1447-4e73-898e-468b2dfa87c7",
        at_seconds: 65,
        note: 72,
        velocity: 110,
        label: "First chorus",
      }],
    };

    await updateLightsSettings(outputSettings);
    await updateLightingCueMap(cueMap);
    await testLightingCue(72, 110);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${apiOrigin}/api/v1/lights/settings`,
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(outputSettings),
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${apiOrigin}/api/v1/lights/cue-map`,
      {
        method: "PUT",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(cueMap),
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `${apiOrigin}/api/v1/lights/test`,
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ note: 72, velocity: 110 }),
      },
    );
  });

  it("loads the current lighting connection", async () => {
    const lights = {
      enabled: false,
      output_name: null,
      channel: 1,
      pulse_ms: 100,
      connection_status: "disconnected" as const,
      detail: null,
      outputs: [],
      last_cue: null,
      last_cue_at: null,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(lights),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getLightsStatus()).resolves.toEqual(lights);
    expect(fetchMock).toHaveBeenCalledWith(
      `${apiOrigin}/api/v1/lights`,
      { headers: { Accept: "application/json" } },
    );
  });
});
