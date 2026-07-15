import type {
  ActionName,
  ActionResponse,
  ApplicationState,
  HealthResponse,
  MidiCueName,
  MidiCueSimulationResponse,
  MidiInputSelectionResponse,
  MidiInputsResponse,
  MidiMonitorResponse,
  PlanSelectionResponse,
} from "./types";

const configuredOrigin = import.meta.env.VITE_STAGEPILOT_API_URL as string | undefined;
export const apiOrigin = (configuredOrigin ?? "http://127.0.0.1:8765").replace(/\/$/, "");
export const websocketUrl = `${apiOrigin.replace(/^http/, "ws")}/ws`;

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiOrigin}${path}`, {
    ...init,
    headers: { Accept: "application/json", ...init?.headers },
  });
  if (!response.ok) {
    let detail: string | null = null;
    try {
      const payload = (await response.json()) as { detail?: unknown };
      if (typeof payload.detail === "string") detail = payload.detail;
    } catch {
      // Fall back to the status-only message when the server did not return JSON.
    }
    throw new Error(detail ?? `StagePilot API returned ${response.status}.`);
  }
  return (await response.json()) as T;
}

export const getHealth = () => requestJson<HealthResponse>("/api/v1/health");
export const getState = () => requestJson<ApplicationState>("/api/v1/state");

export const performAction = (action: ActionName) =>
  requestJson<ActionResponse>(`/api/v1/actions/${action}`, { method: "POST" });

export const selectPlanningCenterPlan = (planId: string) =>
  requestJson<PlanSelectionResponse>("/api/v1/planning-center/plan-selection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan_id: planId }),
  });

export const getMidiInputs = () =>
  requestJson<MidiInputsResponse>("/api/v1/midi/inputs");

export const getMidiMessages = () =>
  requestJson<MidiMonitorResponse>("/api/v1/midi/messages");

export const refreshMidiInputs = () =>
  requestJson<MidiInputsResponse>("/api/v1/midi/inputs/refresh", { method: "POST" });

export const selectMidiInput = (inputId: string | null) =>
  requestJson<MidiInputSelectionResponse>("/api/v1/midi/input-selection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input_id: inputId }),
  });

export const simulateMidiCue = (cue: MidiCueName) =>
  requestJson<MidiCueSimulationResponse>("/api/v1/midi/cue-simulation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cue }),
  });
