import { apiOrigin, websocketUrl } from "../api";
import type { ApplicationState, HealthResponse } from "../types";

export function BackendSetupPanel({
  state,
  health,
  live,
  onClose,
}: {
  state: ApplicationState;
  health: HealthResponse | null;
  live: boolean;
  onClose: () => void;
}) {
  return (
    <section
      aria-labelledby="backend-setup-heading"
      className="mt-5 rounded-xl border border-sky-400/15 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.09),transparent_45%),#111923] p-5 shadow-panel"
      id="backend-configuration"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-sky-300">Application setup</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-100" id="backend-setup-heading">
            StagePilot backend
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            Runtime identity, local API endpoints, WebSocket state, and plugin health for this session.
          </p>
        </div>
        <button
          aria-label="Close StagePilot backend configuration"
          className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/5 text-lg text-slate-400 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
          onClick={onClose}
          title="Close"
          type="button"
        >
          ×
        </button>
      </div>

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
        Backend host and startup defaults are set before launch through environment configuration.
      </p>
    </section>
  );
}
