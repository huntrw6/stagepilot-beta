import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import {
  saveWindowState,
  StateFlags,
} from "@tauri-apps/plugin-window-state";

export const UPDATE_RELAUNCH_MARKER = "stagepilot.update-pending-relaunch.v1";
export const UPDATE_CHECK_TIMEOUT_MS = 15_000;

export type UpdateProgress = {
  downloadedBytes: number;
  totalBytes: number | null;
  percentage: number | null;
  stage: "preparing" | "downloading" | "verifying" | "installing";
};
export type UpdateCandidate = {
  currentVersion: string;
  availableVersion: string;
  releaseNotes: string | null;
  releaseDate: string | null;
  install: (onProgress: (progress: UpdateProgress) => void) => Promise<void>;
};

export type UpdateRelaunchResult = {
  updatedVersion: string;
  route: string | null;
} | null;

export interface UpdaterAdapter {
  isEnabled(): boolean;
  check(): Promise<UpdateCandidate | null>;
  prepareRelaunch(version: string): Promise<void>;
  clearRelaunchMarker(): void;
  relaunch(): Promise<void>;
  restoreAfterRelaunch(): Promise<UpdateRelaunchResult>;
}

type RelaunchMarker = {
  targetVersion: string;
  route: string | null;
  createdAt: string;
};

const safeReadMarker = (): RelaunchMarker | null => {
  try {
    const parsed = JSON.parse(localStorage.getItem(UPDATE_RELAUNCH_MARKER) ?? "null");
    if (
      parsed
      && typeof parsed.targetVersion === "string"
      && (parsed.route === null || typeof parsed.route === "string")
      && typeof parsed.createdAt === "string"
    ) {
      return parsed as RelaunchMarker;
    }
  } catch {
    // Invalid marker data must never block StagePilot startup.
  }
  return null;
};

const normalizeProgress = (
  event: DownloadEvent,
  downloadedBytes: number,
  totalBytes: number | null,
) => {
  if (event.event === "Started") {
    totalBytes = event.data.contentLength ?? null;
  } else if (event.event === "Progress") {
    downloadedBytes += event.data.chunkLength;
  }
  return {
    downloadedBytes,
    totalBytes,
    percentage: totalBytes && totalBytes > 0
      ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
      : null,
  };
};

const candidateFromUpdate = (update: Update): UpdateCandidate => ({
  currentVersion: update.currentVersion,
  availableVersion: update.version,
  releaseNotes: update.body?.trim() || null,
  releaseDate: update.date ?? null,
  install: async (onProgress) => {
    let downloadedBytes = 0;
    let totalBytes: number | null = null;
    onProgress({ downloadedBytes, totalBytes, percentage: null, stage: "preparing" });
    await update.downloadAndInstall((event) => {
      const normalized = normalizeProgress(event, downloadedBytes, totalBytes);
      downloadedBytes = normalized.downloadedBytes;
      totalBytes = normalized.totalBytes;
      if (event.event === "Finished") {
        onProgress({ ...normalized, stage: "verifying" });
      } else {
        onProgress({ ...normalized, stage: "downloading" });
      }
    }, { timeout: 120_000 });
    onProgress({
      downloadedBytes,
      totalBytes,
      percentage: totalBytes ? 100 : null,
      stage: "installing",
    });
  },
});

export const tauriUpdaterAdapter: UpdaterAdapter = {
  isEnabled: () => {
    if (!isTauri()) return false;
    if (import.meta.env.PROD) return true;
    return import.meta.env.VITE_STAGEPILOT_ENABLE_UPDATER === "true";
  },
  check: async () => {
    const update = await check({ timeout: UPDATE_CHECK_TIMEOUT_MS });
    return update ? candidateFromUpdate(update) : null;
  },
  prepareRelaunch: async (version) => {
    const marker: RelaunchMarker = {
      targetVersion: version,
      route: window.location.hash || null,
      createdAt: new Date().toISOString(),
    };
    localStorage.setItem(UPDATE_RELAUNCH_MARKER, JSON.stringify(marker));
    await saveWindowState(StateFlags.ALL);
  },
  clearRelaunchMarker: () => {
    localStorage.removeItem(UPDATE_RELAUNCH_MARKER);
  },
  relaunch,
  restoreAfterRelaunch: async () => {
    const marker = safeReadMarker();
    if (!marker) return null;
    const currentVersion = await getVersion();
    const createdAt = Date.parse(marker.createdAt);
    const stale = !Number.isFinite(createdAt) || Date.now() - createdAt > 24 * 60 * 60 * 1_000;
    if (stale || currentVersion !== marker.targetVersion) {
      localStorage.removeItem(UPDATE_RELAUNCH_MARKER);
      return null;
    }
    if (marker.route?.startsWith("#")) window.location.hash = marker.route;
    const mainWindow = getCurrentWindow();
    await mainWindow.unminimize();
    await mainWindow.show();
    await mainWindow.setFocus();
    localStorage.removeItem(UPDATE_RELAUNCH_MARKER);
    return { updatedVersion: currentVersion, route: marker.route };
  },
};
