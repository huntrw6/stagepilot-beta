import { useEffect, useMemo, useState } from "react";

import type {
  ProPresenterSettingsInput,
  ProPresenterStatusResponse,
} from "../types";

const statusTone = (status: ProPresenterStatusResponse["connection_status"]) => {
  if (status === "connected") return "text-emerald-300";
  if (status === "connecting") return "text-amber-300";
  return "text-rose-300";
};

export function ProPresenterSetupPanel({
  propresenter,
  error,
  message,
  pendingOperation,
  onSave,
  onTest,
  onRefreshTimers,
  onClose,
}: {
  propresenter: ProPresenterStatusResponse | null;
  error: string | null;
  message: string | null;
  pendingOperation: "save" | "test" | "refresh" | null;
  onSave: (settings: ProPresenterSettingsInput) => void;
  onTest: () => void;
  onRefreshTimers: () => void;
  onClose?: () => void;
}) {
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("1025");
  const [timerName, setTimerName] = useState("Song Countdown");
  const [timeout, setTimeout] = useState("3");
  const configuredHost = propresenter?.host;
  const configuredPort = propresenter?.port;
  const configuredTimerName = propresenter?.timer_name;
  const configuredTimeout = propresenter?.request_timeout_seconds;

  useEffect(() => {
    if (
      configuredHost === undefined
      || configuredPort === undefined
      || configuredTimerName === undefined
      || configuredTimeout === undefined
    ) return;
    setHost(configuredHost);
    setPort(String(configuredPort));
    setTimerName(configuredTimerName);
    setTimeout(String(configuredTimeout));
  }, [configuredHost, configuredPort, configuredTimeout, configuredTimerName]);

  const parsedSettings = useMemo<ProPresenterSettingsInput | null>(() => {
    const parsedPort = Number(port);
    const parsedTimeout = Number(timeout);
    if (!host.trim() || !timerName.trim()) return null;
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) return null;
    if (!Number.isFinite(parsedTimeout) || parsedTimeout <= 0 || parsedTimeout > 60) return null;
    return {
      host: host.trim(),
      port: parsedPort,
      timer_name: timerName.trim(),
      request_timeout_seconds: parsedTimeout,
    };
  }, [host, port, timeout, timerName]);

  const disabled = !propresenter?.enabled;
  const busy = pendingOperation !== null;

  return (
    <section className="mt-5 rounded-2xl border border-white/10 bg-slate-950/50 p-5 shadow-2xl shadow-black/20" id="propresenter-configuration">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">Production setup</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-100">ProPresenter countdown</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            Settings apply to this StagePilot backend session. Environment defaults return after a restart.
          </p>
        </div>
        <div className="flex items-start gap-3">
          <div className="text-right text-sm">
            <p className={`font-semibold ${statusTone(propresenter?.connection_status ?? "disconnected")}`}>
              {propresenter?.connection_status ?? "loading"}
            </p>
            <p className="mt-1 max-w-md text-xs text-slate-500">
              {propresenter?.detail ?? "Loading ProPresenter configuration…"}
            </p>
          </div>
          {onClose && (
            <button
              aria-label="Close ProPresenter configuration"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-lg text-slate-400 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
              onClick={onClose}
              title="Close"
              type="button"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {!propresenter && !error && (
        <p className="mt-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-400">
          Loading ProPresenter configuration…
        </p>
      )}

      {propresenter && disabled && (
        <p className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
          The ProPresenter plugin is disabled. Enable it in the backend startup configuration, then restart StagePilot.
        </p>
      )}

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm text-slate-300">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Host</span>
          <input
            className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-sky-400/50"
            disabled={disabled || busy}
            onChange={(event) => setHost(event.target.value)}
            value={host}
          />
        </label>
        <label className="text-sm text-slate-300">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Port</span>
          <input
            className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-sky-400/50"
            disabled={disabled || busy}
            inputMode="numeric"
            onChange={(event) => setPort(event.target.value)}
            value={port}
          />
        </label>
        <label className="text-sm text-slate-300">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Timer</span>
          <input
            className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-sky-400/50"
            disabled={disabled || busy}
            onChange={(event) => setTimerName(event.target.value)}
            value={timerName}
          />
        </label>
        <label className="text-sm text-slate-300">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Timeout (seconds)</span>
          <input
            className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-sky-400/50"
            disabled={disabled || busy}
            inputMode="decimal"
            onChange={(event) => setTimeout(event.target.value)}
            value={timeout}
          />
        </label>
      </div>

      {propresenter?.timers.length ? (
        <label className="mt-4 block text-sm text-slate-300">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Detected timers</span>
          <select
            className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-sky-400/50"
            disabled={disabled || busy}
            onChange={(event) => setTimerName(event.target.value)}
            value={propresenter.timers.some((timer) => timer.name === timerName) ? timerName : ""}
          >
            <option value="">Choose a detected timer</option>
            {propresenter.timers.map((timer) => (
              <option disabled={!timer.is_countdown} key={timer.id} value={timer.name}>
                {timer.name}{timer.is_countdown ? "" : " (not a countdown)"}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          className="rounded-lg border border-sky-400/40 bg-sky-400 px-3.5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={disabled || busy || parsedSettings === null}
          onClick={() => parsedSettings && onSave(parsedSettings)}
          type="button"
        >
          {pendingOperation === "save" ? "Saving…" : "Save and reconnect"}
        </button>
        <button
          className="rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={disabled || busy}
          onClick={onTest}
          type="button"
        >
          {pendingOperation === "test" ? "Testing…" : "Test connection"}
        </button>
        <button
          className="rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={disabled || busy}
          onClick={onRefreshTimers}
          type="button"
        >
          {pendingOperation === "refresh" ? "Refreshing…" : "Refresh timers"}
        </button>
      </div>

      {(error || message) && (
        <p className={`mt-4 rounded-lg border px-3 py-2 text-sm ${error ? "border-rose-400/20 bg-rose-400/10 text-rose-200" : "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"}`}>
          {error ?? message}
        </p>
      )}

      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
          <p className="text-xs uppercase tracking-wider text-slate-500">API</p>
          <p className="mt-1 text-slate-200">{propresenter?.connection_status ?? "Unknown"}</p>
        </div>
        <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
          <p className="text-xs uppercase tracking-wider text-slate-500">Configured timer</p>
          <p className={`mt-1 ${propresenter?.timer_found ? "text-emerald-300" : "text-amber-300"}`}>
            {propresenter?.timer_found ? propresenter.timer_name : "Not found"}
          </p>
        </div>
        <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
          <p className="text-xs uppercase tracking-wider text-slate-500">Last checked</p>
          <p className="mt-1 text-slate-200">
            {propresenter?.last_checked_at ? new Date(propresenter.last_checked_at).toLocaleTimeString() : "Not checked"}
          </p>
        </div>
      </div>
    </section>
  );
}
