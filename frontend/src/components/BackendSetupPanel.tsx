import { useEffect, useMemo, useState } from "react";

import { apiOrigin, websocketUrl } from "../api";
import type {
  ApplicationState,
  GeneralSettingsInput,
  HealthResponse,
  SettingsResponse,
} from "../types";
import { SetupPanelHeader } from "./SetupPanelHeader";

export function BackendSetupPanel({
  state,
  health,
  live,
  onClose,
  settings,
  error,
  message,
  pending,
  onSave,
}: {
  state: ApplicationState;
  health: HealthResponse | null;
  live: boolean;
  onClose: () => void;
  settings: SettingsResponse | null;
  error: string | null;
  message: string | null;
  pending: boolean;
  onSave: (settings: GeneralSettingsInput) => void;
}) {
  const [timezone, setTimezone] = useState("America/Los_Angeles");
  const [logLevel, setLogLevel] = useState<GeneralSettingsInput["log_level"]>("INFO");
  const [serverPort, setServerPort] = useState("8765");
  const [lanAccess, setLanAccess] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setTimezone(settings.settings.timezone);
    setLogLevel(settings.settings.log_level);
    setServerPort(String(settings.settings.server_port));
    setLanAccess(settings.settings.lan_access ?? false);
  }, [settings]);

  const parsedSettings = useMemo<GeneralSettingsInput | null>(() => {
    const parsedPort = Number(serverPort);
    if (!timezone.trim()) return null;
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) return null;
    return {
      timezone: timezone.trim(),
      log_level: logLevel,
      server_port: parsedPort,
      lan_access: lanAccess,
    };
  }, [lanAccess, logLevel, serverPort, timezone]);
  const connectionStatus = live
    ? "connected"
    : state.application_status === "error" ? "error" : "disconnected";

  return (
    <section
      aria-labelledby="backend-setup-heading"
      className="setup-panel mt-5 rounded-2xl border border-white/10 bg-slate-950/70 p-5 shadow-2xl shadow-black/20"
      id="backend-configuration"
    >
      <SetupPanelHeader
        closeLabel="Close StagePilot backend configuration"
        description="Runtime identity, local API endpoints, WebSocket state, and plugin health for this session."
        headingId="backend-setup-heading"
        onClose={onClose}
        status={connectionStatus}
        title="StagePilot backend"
      />

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <label className="text-sm text-slate-300">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Timezone</span>
          <input
            className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-slate-100 outline-none focus:border-rose-400/50"
            disabled={pending}
            onChange={(event) => setTimezone(event.target.value)}
            placeholder="America/Los_Angeles"
            value={timezone}
          />
        </label>
        <label className="text-sm text-slate-300">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Log level</span>
          <select
            className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-slate-100"
            disabled={pending}
            onChange={(event) => setLogLevel(event.target.value as GeneralSettingsInput["log_level"])}
            value={logLevel}
          >
            {(["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] as const).map((level) => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-300">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Server port</span>
          <input
            className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-slate-100 outline-none focus:border-rose-400/50"
            disabled={pending}
            inputMode="numeric"
            onChange={(event) => setServerPort(event.target.value)}
            value={serverPort}
          />
        </label>
      </div>

      <label className="mt-4 flex max-w-2xl items-start gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-300">
        <input
          checked={lanAccess}
          className="mt-0.5 size-4 accent-rose-500"
          disabled={pending}
          onChange={(event) => setLanAccess(event.target.checked)}
          type="checkbox"
        />
        <span>
          <span className="block font-semibold text-slate-200">
            Allow dashboard access from this local network
          </span>
          <span className="mt-1 block text-xs text-slate-400">
            Other devices can open http://&lt;this-computer&apos;s-IP&gt;:{serverPort}. Use only on a trusted production network; remote controls do not require a separate login.
          </span>
        </span>
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          className="rounded-lg border border-rose-400/40 bg-rose-500 px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-400 disabled:opacity-40"
          disabled={pending || parsedSettings === null}
          onClick={() => parsedSettings && onSave(parsedSettings)}
          type="button"
        >
          {pending ? "Saving…" : "Save general settings"}
        </button>
        <p className="text-xs text-slate-500">
          Timezone, logging, port, and network-access changes take effect after a backend restart.
        </p>
      </div>

      {(error || message) && (
        <p className={`mt-3 rounded-lg border px-3 py-2 text-sm ${error ? "border-rose-400/20 bg-rose-400/10 text-rose-200" : "border-sky-400/20 bg-sky-400/10 text-sky-200"}`}>
          {error ?? message}
        </p>
      )}

      <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-3">
          <p className="text-xs uppercase tracking-wider text-slate-500">API endpoint</p>
          <p className="mt-1 break-all font-mono text-xs text-slate-200">{apiOrigin}</p>
        </div>
        <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-3">
          <p className="text-xs uppercase tracking-wider text-slate-500">WebSocket</p>
          <p className={`mt-1 font-semibold ${live ? "text-emerald-300" : "text-rose-300"}`}>
            {live ? "Connected" : "Disconnected"}
          </p>
          <p className="mt-1 break-all font-mono text-[0.68rem] text-slate-500">{websocketUrl}</p>
        </div>
        <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-3">
          <p className="text-xs uppercase tracking-wider text-slate-500">Backend version</p>
          <p className="mt-1 text-slate-200">{health ? `v${health.version}` : "Loading"}</p>
        </div>
        <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-3">
          <p className="text-xs uppercase tracking-wider text-slate-500">State revision</p>
          <p className="mt-1 text-slate-200">{state.revision}</p>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-white/7 bg-black/20">
        <div className="border-b border-white/7 px-3 py-2.5">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-300">Plugin health</p>
        </div>
        <div className="grid gap-px bg-white/5 sm:grid-cols-2 xl:grid-cols-3">
          {(health?.plugins ?? Object.values(state.plugins)).map((plugin) => (
            <div className="bg-stage-850 px-3 py-3" key={plugin.name}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-slate-200">{plugin.name}</p>
                <span className="text-xs capitalize text-slate-400">{plugin.status}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">v{plugin.version}{plugin.last_error ? ` · ${plugin.last_error}` : ""}</p>
            </div>
          ))}
          {!health?.plugins.length && !Object.keys(state.plugins).length && (
            <p className="bg-stage-850 px-3 py-3 text-sm text-slate-500">No plugins reported.</p>
          )}
        </div>
      </div>

      <p className="mt-4 text-xs text-slate-500">
        The dashboard remembers the saved server port for its next launch. Environment variables may still override these values for development.
      </p>
    </section>
  );
}
