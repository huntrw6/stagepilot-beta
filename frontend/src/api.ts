import type {
  ActionName,
  ActionResponse,
  ApplicationState,
  HealthResponse,
  LightsOperationResponse,
  LightsSettingsInput,
  LightsStatusResponse,
  MidiCueName,
  MidiCueSimulationResponse,
  MidiInputSelectionResponse,
  MidiInputsResponse,
  MidiMonitorResponse,
  PersistentSettings,
  PlanningCenterServiceType,
  PlanningCenterSettingsInput,
  PlanningCenterStatusResponse,
  PlanningCenterTestInput,
  PlanningCenterTestResponse,
  PlanSelectionResponse,
  ProPresenterOperationResponse,
  ProPresenterSettingsInput,
  ProPresenterStatusResponse,
  SettingsResponse,
  SongLightingCueMap,
} from "./types";

const SERVER_PORT_KEY = "stagepilot.server-port";
const configuredOrigin = import.meta.env.VITE_STAGEPILOT_API_URL as string | undefined;

const savedServerPort = () => {
  try {
    const value = Number(window.localStorage.getItem(SERVER_PORT_KEY));
    return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : 8765;
  } catch {
    return 8765;
  }
};

export const rememberServerPort = (port: number) => {
  try {
    window.localStorage.setItem(SERVER_PORT_KEY, String(port));
  } catch {
    // A restricted browser storage policy should not prevent settings persistence.
  }
};

const browserHostedOrigin =
  ["http:", "https:"].includes(window.location.protocol) &&
  Number(window.location.port) === savedServerPort()
    ? window.location.origin
    : undefined;

export const apiOrigin = (
  configuredOrigin ?? browserHostedOrigin ?? `http://127.0.0.1:${savedServerPort()}`
).replace(/\/$/, "");
export const websocketUrl = `${apiOrigin.replace(/^http/, "ws")}/ws`;

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiOrigin}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...init?.headers,
    },
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
  requestJson<PlanSelectionResponse>("/api/v1/planning-center/plans/select", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan_id: planId }),
  });
export const getSettings = () => requestJson<SettingsResponse>("/api/v1/settings");
export const updateSettings = (settings: PersistentSettings) =>
  requestJson<SettingsResponse>("/api/v1/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
export const getPlanningCenterStatus = () =>
  requestJson<PlanningCenterStatusResponse>("/api/v1/planning-center/status");
export const testPlanningCenter = (settings: PlanningCenterTestInput) =>
  requestJson<PlanningCenterTestResponse>("/api/v1/planning-center/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
export const getPlanningCenterServiceTypes = () =>
  requestJson<PlanningCenterServiceType[]>("/api/v1/planning-center/service-types");
export const updatePlanningCenterSettings = (settings: PlanningCenterSettingsInput) =>
  requestJson<SettingsResponse>("/api/v1/planning-center/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });

export const getMidiInputs = () => requestJson<MidiInputsResponse>("/api/v1/midi/inputs");
export const getMidiMessages = () => requestJson<MidiMonitorResponse>("/api/v1/midi/messages");
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

export const getProPresenterStatus = () =>
  requestJson<ProPresenterStatusResponse>("/api/v1/propresenter");
export const testProPresenter = () =>
  requestJson<ProPresenterOperationResponse>("/api/v1/propresenter/test", {
    method: "POST",
  });
export const refreshProPresenterTimers = () =>
  requestJson<ProPresenterOperationResponse>("/api/v1/propresenter/timers/refresh", {
    method: "POST",
  });
export const updateProPresenterSettings = (settings: ProPresenterSettingsInput) =>
  requestJson<ProPresenterOperationResponse>("/api/v1/propresenter/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });

export const getLightsStatus = () =>
  requestJson<LightsStatusResponse>("/api/v1/lights");
export const refreshLightingOutputs = () =>
  requestJson<LightsStatusResponse>("/api/v1/lights/outputs/refresh", {
    method: "POST",
  });
export const updateLightsSettings = (settings: LightsSettingsInput) =>
  requestJson<LightsOperationResponse>("/api/v1/lights/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
export const updateLightingCueMap = (cueMap: SongLightingCueMap) =>
  requestJson<LightsOperationResponse>("/api/v1/lights/cue-map", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cueMap),
  });
export const testLightingCue = (note: number, velocity: number) =>
  requestJson<LightsOperationResponse>("/api/v1/lights/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note, velocity }),
  });
