import type {
  ActionName,
  ActionResponse,
  ApplicationState,
  HealthResponse,
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
    throw new Error(`StagePilot API returned ${response.status}.`);
  }
  return (await response.json()) as T;
}

export const getHealth = () => requestJson<HealthResponse>("/api/v1/health");
export const getState = () => requestJson<ApplicationState>("/api/v1/state");

export const performAction = (action: ActionName) =>
  requestJson<ActionResponse>(`/api/v1/actions/${action}`, { method: "POST" });
