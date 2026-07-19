import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type BackendSupervisorStatus = {
  state: "starting" | "ready" | "external" | "failed" | "stopped";
  message: string;
  port: number;
  managed: boolean;
};

export const desktopBackendStatus = async (): Promise<BackendSupervisorStatus | null> => {
  if (!isTauri()) return null;
  return invoke<BackendSupervisorStatus>("backend_supervisor_status");
};

export const listenForDesktopBackend = async (
  onStatus: (status: BackendSupervisorStatus) => void,
): Promise<UnlistenFn | null> => {
  if (!isTauri()) return null;
  return listen<BackendSupervisorStatus>("stagepilot://backend-status", (event) => {
    onStatus(event.payload);
  });
};

export const isDesktopShell = () => isTauri();

export const minimizeDesktopWindow = async () => {
  if (!isTauri()) return;
  await getCurrentWindow().minimize();
};

export const toggleMaximizeDesktopWindow = async () => {
  if (!isTauri()) return;
  await getCurrentWindow().toggleMaximize();
};

export const closeDesktopWindow = async () => {
  if (!isTauri()) return;
  await invoke("quit_application");
};

export const restartDesktopBackend = async (): Promise<boolean> => {
  if (!isTauri()) return false;
  await invoke<BackendSupervisorStatus>("restart_managed_backend");
  return true;
};
