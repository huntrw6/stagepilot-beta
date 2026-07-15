import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getHealth,
  getMidiInputs,
  getMidiMessages,
  getState,
  performAction,
  refreshMidiInputs,
  selectMidiInput,
  selectPlanningCenterPlan,
  simulateMidiCue,
} from "../api";
import type {
  ApplicationState,
  HealthResponse,
  MidiInputsResponse,
  PlanSelectionResponse,
} from "../types";
import { useStagePilot } from "./useStagePilot";

vi.mock("../api", () => ({
  getHealth: vi.fn(),
  getMidiInputs: vi.fn(),
  getMidiMessages: vi.fn(),
  getState: vi.fn(),
  performAction: vi.fn(),
  refreshMidiInputs: vi.fn(),
  selectMidiInput: vi.fn(),
  selectPlanningCenterPlan: vi.fn(),
  simulateMidiCue: vi.fn(),
  websocketUrl: "ws://127.0.0.1:8765/ws",
}));

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((message: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  close = vi.fn();

  sendState(state: ApplicationState) {
    this.onmessage?.({
      data: JSON.stringify({ type: "state.snapshot", data: state }),
    });
  }
}

const health: HealthResponse = {
  status: "healthy",
  version: "0.1.0",
  application_status: "running",
  plugins: [],
};

const midi: MidiInputsResponse = {
  enabled: true,
  channel: 1,
  note: 112,
  configured_input_name: null,
  selected_input_name: null,
  inputs: [
    {
      id: "a".repeat(64),
      name: "Playback Controller",
      ambiguous: false,
      selected: false,
      connected: false,
    },
  ],
  mappings: {
    start_next: 100,
    restart_current: 101,
    previous: 102,
    next: 103,
    reload_plan: 104,
    stop_timer: 105,
  },
};

function applicationState(revision: number): ApplicationState {
  return {
    revision,
    updated_at: `2026-07-13T16:00:${String(revision).padStart(2, "0")}Z`,
    application_status: "running",
    plan: null,
    current_song: null,
    next_song: null,
    current_song_index: null,
    planning_center_status: "connected",
    midi_status: "connected",
    propresenter_status: "connected",
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
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const mockedGetHealth = vi.mocked(getHealth);
const mockedGetMidiInputs = vi.mocked(getMidiInputs);
const mockedGetMidiMessages = vi.mocked(getMidiMessages);
const mockedGetState = vi.mocked(getState);
const mockedPerformAction = vi.mocked(performAction);
const mockedRefreshMidiInputs = vi.mocked(refreshMidiInputs);
const mockedSelectMidiInput = vi.mocked(selectMidiInput);
const mockedSelectPlanningCenterPlan = vi.mocked(selectPlanningCenterPlan);
const mockedSimulateMidiCue = vi.mocked(simulateMidiCue);

beforeEach(() => {
  vi.clearAllMocks();
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  mockedGetHealth.mockResolvedValue(health);
  mockedGetMidiInputs.mockResolvedValue(midi);
  mockedGetMidiMessages.mockResolvedValue({ messages: [] });
  mockedGetState.mockResolvedValue(applicationState(1));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useStagePilot", () => {
  it("keeps the newest state when an older REST snapshot arrives after WebSocket state", async () => {
    const initialState = deferred<ApplicationState>();
    mockedGetState.mockReturnValueOnce(initialState.promise);
    const { result } = renderHook(() => useStagePilot());
    const socket = MockWebSocket.instances[0];
    expect(socket).toBeDefined();

    act(() => socket!.sendState(applicationState(5)));
    expect(result.current.state?.revision).toBe(5);

    initialState.resolve(applicationState(2));

    await waitFor(() => expect(result.current.health).toEqual(health));
    expect(result.current.state?.revision).toBe(5);
  });

  it("tracks a pending selection and applies its successful response", async () => {
    const selection = deferred<PlanSelectionResponse>();
    mockedSelectPlanningCenterPlan.mockReturnValueOnce(selection.promise);
    const { result } = renderHook(() => useStagePilot());
    await waitFor(() => expect(result.current.state?.revision).toBe(1));

    act(() => {
      void result.current.selectPlan("plan-evening");
    });

    expect(mockedSelectPlanningCenterPlan).toHaveBeenCalledWith("plan-evening");
    expect(result.current.pendingPlanId).toBe("plan-evening");

    selection.resolve({
      accepted: true,
      message: "Evening plan loaded.",
      state: applicationState(3),
    });

    await waitFor(() => expect(result.current.pendingPlanId).toBeNull());
    expect(result.current.state?.revision).toBe(3);
    expect(result.current.actionMessage).toBe("Evening plan loaded.");
    expect(result.current.error).toBeNull();
  });

  it("reports selection errors and clears the pending selection", async () => {
    const selection = deferred<PlanSelectionResponse>();
    mockedSelectPlanningCenterPlan.mockReturnValueOnce(selection.promise);
    const { result } = renderHook(() => useStagePilot());
    await waitFor(() => expect(result.current.state?.revision).toBe(1));

    act(() => {
      void result.current.selectPlan("plan-evening");
    });
    expect(result.current.pendingPlanId).toBe("plan-evening");

    selection.reject(new Error("Selection endpoint unavailable."));

    await waitFor(() => expect(result.current.pendingPlanId).toBeNull());
    expect(result.current.error).toBe("Selection endpoint unavailable.");
    expect(result.current.state?.revision).toBe(1);
  });

  it("does not let a stale action response roll back newer live state", async () => {
    mockedPerformAction.mockResolvedValueOnce({
      action: "reload_plan",
      accepted: true,
      message: "Reloaded.",
      state: applicationState(3),
    });
    const { result } = renderHook(() => useStagePilot());
    await waitFor(() => expect(result.current.state?.revision).toBe(1));
    const socket = MockWebSocket.instances[0];

    act(() => socket!.sendState(applicationState(5)));
    await act(async () => result.current.dispatch("reload_plan"));

    expect(result.current.state?.revision).toBe(5);
    expect(result.current.actionMessage).toBe("Reloaded.");
  });

  it("loads MIDI inputs and exposes refresh and session selection actions", async () => {
    mockedRefreshMidiInputs.mockResolvedValueOnce({ ...midi, channel: 2 });
    mockedSelectMidiInput.mockResolvedValueOnce({
      accepted: true,
      message: "Playback Controller selected for this session.",
      midi: {
        ...midi,
        selected_input_name: "Playback Controller",
        inputs: [{ ...midi.inputs[0]!, selected: true }],
      },
    });
    const { result } = renderHook(() => useStagePilot());

    await waitFor(() => expect(result.current.midi).toEqual(midi));
    await act(async () => result.current.refreshMidi());
    expect(result.current.midi?.channel).toBe(2);

    await act(async () => result.current.selectMidi("a".repeat(64)));
    expect(mockedSelectMidiInput).toHaveBeenCalledWith("a".repeat(64));
    expect(result.current.midi?.selected_input_name).toBe("Playback Controller");
    expect(result.current.midiMessage).toMatch(/selected for this session/i);
    expect(result.current.midiError).toBeNull();
  });

  it("applies only the state returned by cue simulation and keeps MIDI setup", async () => {
    mockedSimulateMidiCue.mockResolvedValueOnce({
      cue: "start_next",
      action: "start_next",
      accepted: true,
      message: "Started next song.",
      state: applicationState(4),
    });
    const { result } = renderHook(() => useStagePilot());
    await waitFor(() => expect(result.current.midi).toEqual(midi));

    await act(async () => result.current.simulateMidi("start_next"));

    expect(result.current.state?.revision).toBe(4);
    expect(result.current.midi).toEqual(midi);
    expect(result.current.midiMessage).toBe("Started next song.");
  });

  it("refreshes MIDI input details when live MIDI connection status changes", async () => {
    const disconnectedState = {
      ...applicationState(2),
      midi_status: "disconnected" as const,
    };
    mockedGetMidiInputs
      .mockResolvedValueOnce(midi)
      .mockResolvedValueOnce({ ...midi, selected_input_name: "Playback Controller" });
    const { result } = renderHook(() => useStagePilot());
    await waitFor(() => expect(result.current.midi).toEqual(midi));
    const socket = MockWebSocket.instances[0];

    act(() => socket!.sendState(disconnectedState));

    await waitFor(() => expect(mockedGetMidiInputs).toHaveBeenCalledTimes(2));
    expect(result.current.midi?.selected_input_name).toBe("Playback Controller");
  });
});
