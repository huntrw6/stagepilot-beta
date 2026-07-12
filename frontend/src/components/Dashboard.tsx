import type { ReactNode } from "react";

import type {
  ActionName,
  ApplicationState,
  ConnectionStatus,
  HealthResponse,
  Song,
} from "../types";
import { StatusCard } from "./StatusCard";

const formatDuration = (seconds: number | null | undefined) => {
  if (seconds == null) return "—:——";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
};

const formatTime = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(value))
    : "No activity yet";

const Glyph = ({ children }: { children: ReactNode }) => (
  <span className="text-sm font-black tracking-tight">{children}</span>
);

function ActionButton({
  action,
  label,
  accent = false,
  danger = false,
  disabled,
  onAction,
}: {
  action: ActionName;
  label: string;
  accent?: boolean;
  danger?: boolean;
  disabled: boolean;
  onAction: (action: ActionName) => void;
}) {
  const color = accent
    ? "border-sky-400/40 bg-sky-400 text-slate-950 hover:bg-sky-300"
    : danger
      ? "border-rose-400/30 bg-rose-400/10 text-rose-300 hover:bg-rose-400/20"
      : "border-white/10 bg-white/5 text-slate-200 hover:border-white/20 hover:bg-white/10";
  return (
    <button
      className={`rounded-lg border px-3.5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${color}`}
      disabled={disabled}
      onClick={() => onAction(action)}
      type="button"
    >
      {label}
    </button>
  );
}

function SongRow({ song, current, next }: { song: Song; current: boolean; next: boolean }) {
  return (
    <li className={`grid grid-cols-[2rem_1fr_auto] items-center gap-3 border-t border-white/5 px-4 py-3 ${current ? "bg-sky-400/10" : ""}`}>
      <span className={`grid h-7 w-7 place-items-center rounded text-xs font-bold ${current ? "bg-sky-400 text-slate-950" : "bg-white/5 text-slate-500"}`}>
        {song.order}
      </span>
      <div className="min-w-0">
        <p className="truncate font-medium text-slate-100">{song.title}</p>
        <div className="mt-0.5 flex gap-2 text-[0.68rem] font-bold uppercase tracking-wider">
          {current && <span className="text-sky-300">Current</span>}
          {next && <span className="text-amber-300">Up next</span>}
          {song.is_generic && <span className="text-amber-300">Generic item</span>}
          {!song.duration_seconds && <span className="text-rose-300">Missing duration</span>}
        </div>
      </div>
      <span className={`font-mono text-sm font-semibold tabular-nums ${song.duration_seconds ? "text-slate-300" : "text-rose-300"}`}>
        {formatDuration(song.duration_seconds)}
      </span>
    </li>
  );
}

const connectionDetail = (status: ConnectionStatus, activity: string | null) =>
  status === "connected" ? `Demo activity ${formatTime(activity)}` : "Waiting for integration";

export function Dashboard({
  state,
  health,
  live,
  error,
  actionMessage,
  pendingAction,
  dispatch,
}: {
  state: ApplicationState;
  health: HealthResponse | null;
  live: boolean;
  error: string | null;
  actionMessage: string | null;
  pendingAction: ActionName | null;
  dispatch: (action: ActionName) => void;
}) {
  const plugin = state.plugins.demo;
  const backendStatus: ConnectionStatus = state.application_status === "running" && live
    ? "connected"
    : state.application_status === "error" ? "error" : live ? "connecting" : "disconnected";
  const plan = state.plan;
  const durationReady = Boolean(plan?.songs.length) && plan!.songs.every((song) => Boolean(song.duration_seconds));
  const timerReady = plugin?.status === "running";
  const checks = [
    ["Planning Center connected", state.planning_center_status === "connected"],
    ["Today’s plan loaded", Boolean(plan)],
    ["Song durations valid", durationReady],
    ["MIDI input connected", state.midi_status === "connected"],
    ["ProPresenter connected", state.propresenter_status === "connected"],
    ["Demo timer available", timerReady],
  ] as const;
  const ready = checks.every(([, passed]) => passed) && live;
  const activity = [...state.recent_events].reverse().slice(0, 10);

  return (
    <main className="mx-auto min-h-screen max-w-[1680px] px-4 py-5 sm:px-6 lg:px-8">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-sky-300/20 bg-sky-400/10 text-lg font-black text-sky-300">SP</div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">StagePilot</h1>
            <p className="text-xs text-slate-500">Live production automation · Demo mode</p>
          </div>
        </div>
        <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${ready ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-amber-400/30 bg-amber-400/10 text-amber-300"}`}>
          <span className={`h-2 w-2 rounded-full ${ready ? "bg-emerald-400" : "bg-amber-400"}`} />
          {ready ? "Ready" : "Check system"}
        </div>
      </header>

      {(error || actionMessage) && (
        <div aria-live="polite" className={`mb-5 rounded-lg border px-4 py-3 text-sm ${error ? "border-rose-400/25 bg-rose-400/10 text-rose-200" : "border-sky-400/20 bg-sky-400/10 text-sky-200"}`}>
          {error ?? actionMessage}
        </div>
      )}

      <section aria-label="Connections" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatusCard title="Planning Center" status={state.planning_center_status} detail={connectionDetail(state.planning_center_status, state.last_successful_plan_reload_at)} icon={<Glyph>PC</Glyph>} />
        <StatusCard title="MIDI / Playback" status={state.midi_status} detail={state.last_action ? `Last action: ${state.last_action.replaceAll("_", " ")}` : "Listening for demo actions"} icon={<Glyph>MI</Glyph>} />
        <StatusCard title="ProPresenter" status={state.propresenter_status} detail={state.timer.status === "running" ? "Song Countdown running" : `Timer ${state.timer.status}`} icon={<Glyph>PP</Glyph>} />
        <StatusCard title="StagePilot backend" status={backendStatus} detail={health ? `v${health.version} · state revision ${state.revision}` : "Connecting to local API"} icon={<Glyph>API</Glyph>} />
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(350px,0.8fr)]">
        <section className="overflow-hidden rounded-xl border border-white/7 bg-stage-850 shadow-panel">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-[0.68rem] font-bold uppercase tracking-[0.18em] text-slate-500">Today’s service</p>
              <h2 className="mt-1 text-lg font-bold text-white">{plan?.title ?? "No service loaded"}</h2>
              <p className="mt-1 text-xs text-slate-500">
                {plan ? `${plan.service_type} · ${plan.date} · ${plan.service_times.join(", ")}` : "Start the backend in demo mode to load a plan."}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-slate-200">{plan?.songs.length ?? 0} songs</p>
              <p className="text-xs text-slate-500">{plan?.duration_source ?? "Scheduled duration source"}</p>
            </div>
          </div>
          <ol>{plan?.songs.map((song) => <SongRow key={song.id} song={song} current={song.id === state.current_song?.id} next={song.id === state.next_song?.id} />)}</ol>
        </section>

        <div className="grid content-start gap-5">
          <section className="rounded-xl border border-sky-400/15 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.12),transparent_48%),#111923] p-5 shadow-panel">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[0.68rem] font-black uppercase tracking-[0.2em] text-sky-300">Now playing</p>
              <span className={`rounded-full px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-wider ${state.timer.status === "running" ? "bg-emerald-400/15 text-emerald-300" : state.timer.status === "error" ? "bg-rose-400/15 text-rose-300" : "bg-white/5 text-slate-400"}`}>Timer {state.timer.status}</span>
            </div>
            <h2 className="mt-7 min-h-9 text-3xl font-bold tracking-tight text-white">{state.current_song?.title ?? "Waiting for first cue"}</h2>
            <p className="mt-2 text-sm text-slate-500">Scheduled duration</p>
            <p className="mt-1 font-mono text-5xl font-light tabular-nums tracking-tight text-slate-100">{formatDuration(state.current_song?.duration_seconds)}</p>
            <div className="mt-7 grid grid-cols-2 gap-4 border-t border-white/7 pt-4 text-sm">
              <div><p className="text-xs text-slate-500">Position</p><p className="mt-1 font-semibold text-slate-200">{state.current_song_index == null ? "Not started" : `${state.current_song_index + 1} of ${plan?.songs.length ?? 0}`}</p></div>
              <div><p className="text-xs text-slate-500">Up next</p><p className="mt-1 truncate font-semibold text-slate-200">{state.next_song?.title ?? "End of service"}</p></div>
              <div><p className="text-xs text-slate-500">Countdown started</p><p className="mt-1 font-semibold text-slate-200">{formatTime(state.timer.started_at)}</p></div>
              <div><p className="text-xs text-slate-500">Last action</p><p className="mt-1 font-semibold capitalize text-slate-200">{state.last_action?.replaceAll("_", " ") ?? "None"}</p></div>
            </div>
          </section>

          <section className="rounded-xl border border-white/7 bg-stage-850 p-4 shadow-panel">
            <p className="text-[0.68rem] font-bold uppercase tracking-[0.18em] text-slate-500">Manual controls</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2">
              <ActionButton action="start_next" label="Start next" accent disabled={pendingAction !== null} onAction={dispatch} />
              <ActionButton action="restart_current" label="Restart current" disabled={pendingAction !== null || !state.current_song} onAction={dispatch} />
              <ActionButton action="previous" label="Previous" disabled={pendingAction !== null} onAction={dispatch} />
              <ActionButton action="next" label="Next" disabled={pendingAction !== null} onAction={dispatch} />
              <ActionButton action="stop_timer" label="Stop timer" danger disabled={pendingAction !== null} onAction={dispatch} />
              <ActionButton action="reload_plan" label="Reload plan" disabled={pendingAction !== null} onAction={dispatch} />
              <ActionButton action="reset_position" label="Reset position" disabled={pendingAction !== null} onAction={dispatch} />
            </div>
          </section>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-white/7 bg-stage-850 p-4 shadow-panel">
          <div className="flex items-center justify-between"><p className="text-[0.68rem] font-bold uppercase tracking-[0.18em] text-slate-500">Readiness check</p><span className={ready ? "text-emerald-300" : "text-amber-300"}>{ready ? "All systems ready" : "Attention required"}</span></div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {checks.map(([label, passed]) => <li key={label} className="flex items-center gap-2 rounded-lg bg-white/[0.025] px-3 py-2 text-sm"><span className={`grid h-5 w-5 place-items-center rounded-full text-[0.65rem] font-black ${passed ? "bg-emerald-400/15 text-emerald-300" : "bg-rose-400/15 text-rose-300"}`}>{passed ? "✓" : "!"}</span><span className={passed ? "text-slate-300" : "text-rose-200"}>{label}</span></li>)}
          </ul>
        </section>

        <section className="overflow-hidden rounded-xl border border-white/7 bg-stage-850 shadow-panel">
          <div className="flex items-center justify-between p-4"><p className="text-[0.68rem] font-bold uppercase tracking-[0.18em] text-slate-500">Recent event stream</p><span className="text-xs text-slate-600">Latest {activity.length}</span></div>
          <div className="max-h-64 overflow-auto border-t border-white/5">
            {state.recent_errors.slice(-2).reverse().map((item) => <div key={`${item.timestamp}-${item.message}`} className="grid grid-cols-[4.5rem_1fr] gap-3 border-b border-white/5 bg-rose-400/[0.04] px-4 py-2.5 text-xs"><time className="font-mono text-slate-600">{formatTime(item.timestamp)}</time><p className="text-rose-200"><span className="font-bold uppercase">{item.component}</span> · {item.message}</p></div>)}
            {activity.map((event) => <div key={event.id} className="grid grid-cols-[4.5rem_1fr] gap-3 border-b border-white/5 px-4 py-2.5 text-xs"><time className="font-mono text-slate-600">{formatTime(event.timestamp)}</time><p className="truncate text-slate-300"><span className="font-semibold text-sky-300">{event.type}</span> · {event.source}</p></div>)}
            {!activity.length && <p className="p-4 text-sm text-slate-500">Waiting for demo events…</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
