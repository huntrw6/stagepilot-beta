import type { ReactNode } from "react";

import type {
  ActionName,
  ApplicationState,
  ConnectionStatus,
  HealthResponse,
  MidiCueName,
  MidiInputsResponse,
  MidiMonitorMessage,
  ProPresenterSettingsInput,
  ProPresenterStatusResponse,
  Song,
} from "../types";
import { MidiSetupPanel } from "./MidiSetupPanel";
import { ProPresenterSetupPanel } from "./ProPresenterSetupPanel";
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

const connectionDetail = (
  status: ConnectionStatus,
  activity: string | null,
  detail: string | null,
) => {
  if (status === "connected") {
    return activity ? `Last plan sync ${formatTime(activity)}` : detail ?? "Connected";
  }
  return detail ?? "Waiting for integration";
};

export function Dashboard({
  state,
  health,
  live,
  error,
  actionMessage,
  pendingAction,
  pendingPlanId,
  midi,
  midiMessages,
  midiError,
  midiMessage,
  pendingMidiOperation,
  pendingMidiCue,
  propresenter = null,
  propresenterError = null,
  propresenterMessage = null,
  pendingProPresenterOperation = null,
  dispatch,
  selectPlan,
  refreshMidi,
  selectMidi,
  simulateMidi,
  saveProPresenter = () => undefined,
  runProPresenterTest = () => undefined,
  refreshProPresenter = () => undefined,
}: {
  state: ApplicationState;
  health: HealthResponse | null;
  live: boolean;
  error: string | null;
  actionMessage: string | null;
  pendingAction: ActionName | null;
  pendingPlanId: string | null;
  midi: MidiInputsResponse | null;
  midiMessages: MidiMonitorMessage[];
  midiError: string | null;
  midiMessage: string | null;
  pendingMidiOperation: "refresh" | "connect" | "disconnect" | null;
  pendingMidiCue: MidiCueName | null;
  propresenter?: ProPresenterStatusResponse | null;
  propresenterError?: string | null;
  propresenterMessage?: string | null;
  pendingProPresenterOperation?: "save" | "test" | "refresh" | null;
  dispatch: (action: ActionName) => void;
  selectPlan: (planId: string) => void;
  refreshMidi: () => void;
  selectMidi: (inputId: string | null) => void;
  simulateMidi: (cue: MidiCueName) => void;
  saveProPresenter?: (settings: ProPresenterSettingsInput) => void;
  runProPresenterTest?: () => void;
  refreshProPresenter?: () => void;
}) {
  const plugin = state.plugins.demo;
  const backendStatus: ConnectionStatus = state.application_status === "running" && live
    ? "connected"
    : state.application_status === "error" ? "error" : live ? "connecting" : "disconnected";
  const plan = state.plan;
  const serviceLoad = state.service_load;
  const durationReady = Boolean(plan?.songs.length) && plan!.songs.every((song) => Boolean(song.duration_seconds));
  const servicePlanReady = Boolean(plan)
    && plan?.date === serviceLoad.target_date
    && serviceLoad.status === "loaded"
    && !serviceLoad.is_stale;
  const checks: ReadonlyArray<readonly [string, boolean]> = [
    ["Planning Center connected", state.planning_center_status === "connected"],
    ["Service plan loaded", servicePlanReady],
    ["Song durations valid", durationReady],
    ["MIDI input connected", state.midi_status === "connected"],
    ["ProPresenter connected", state.propresenter_status === "connected"],
    ...(state.plugins.propresenter
      ? [["ProPresenter timer found", Boolean(propresenter?.timer_found)]] as const
      : []),
    ...(plugin ? [["Demo integration running", plugin.status === "running"]] as const : []),
  ];
  const ready = checks.every(([, passed]) => passed) && live;
  const activity = [...state.recent_events].reverse().slice(0, 10);
  const connectedMidiInput = midi?.inputs.find((input) => input.connected);
  const midiDetail = state.last_action
    ? `Last action: ${state.last_action.replaceAll("_", " ")}`
    : plugin
      ? "Listening for demo actions"
      : !midi
        ? "Loading MIDI configuration"
        : !midi.enabled
          ? "MIDI Playback disabled"
          : connectedMidiInput
            ? `Connected to ${connectedMidiInput.name}`
            : midi.selected_input_name
              ? `Waiting for ${midi.selected_input_name}`
              : "No input selected";

  return (
    <main className="mx-auto min-h-screen max-w-[1680px] px-4 py-5 sm:px-6 lg:px-8">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-sky-300/20 bg-sky-400/10 text-lg font-black text-sky-300">SP</div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">StagePilot</h1>
            <p className="text-xs text-slate-500">Live production automation · {plugin ? "Demo mode" : "Production mode"}</p>
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

      {serviceLoad.status === "ambiguous" && (
        <section className="mb-5 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4" aria-live="polite">
          <p className="text-[0.68rem] font-black uppercase tracking-[0.18em] text-amber-300">Plan selection required</p>
          <h2 className="mt-1 text-lg font-bold text-white">Multiple plans match {serviceLoad.target_date ?? "the service date"}</h2>
          {serviceLoad.message && <p className="mt-1 text-sm font-medium text-amber-100">{serviceLoad.message}</p>}
          <p className="mt-1 text-sm text-amber-100/70">
            {serviceLoad.is_stale ? "The previous plan remains available but is marked stale. " : ""}
            Choose the service plan StagePilot should load.
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {serviceLoad.candidates.map((candidate) => (
              <div key={candidate.id} className="flex items-center justify-between gap-3 rounded-lg border border-amber-300/15 bg-slate-950/30 px-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-100">{candidate.title}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{candidate.service_type_name} · {candidate.service_times.join(", ")}</p>
                </div>
                <button
                  aria-label={pendingPlanId === candidate.id ? `Loading ${candidate.title}` : `Use ${candidate.title}`}
                  className="shrink-0 rounded-lg bg-amber-300 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-amber-200 disabled:cursor-wait disabled:opacity-50"
                  disabled={pendingPlanId !== null}
                  onClick={() => selectPlan(candidate.id)}
                  type="button"
                >
                  {pendingPlanId === candidate.id ? "Loading…" : "Use this plan"}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {serviceLoad.status !== "idle" && serviceLoad.status !== "loaded" && serviceLoad.status !== "ambiguous" && (
        <div className={`mb-5 rounded-lg border px-4 py-3 text-sm ${serviceLoad.status === "loading" ? "border-sky-400/20 bg-sky-400/10 text-sky-200" : "border-rose-400/25 bg-rose-400/10 text-rose-200"}`} aria-live="polite">
          {serviceLoad.message ?? "Planning Center plan status changed."}
          {serviceLoad.is_stale && " The last successful plan is still displayed as stale."}
        </div>
      )}

      <section aria-label="Connections" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatusCard title="Planning Center" status={state.planning_center_status} detail={connectionDetail(state.planning_center_status, state.last_successful_plan_reload_at, serviceLoad.message)} icon={<Glyph>PC</Glyph>} />
        <StatusCard title="MIDI / Playback" status={state.midi_status} detail={midiDetail} icon={<Glyph>MI</Glyph>} />
        <StatusCard title="ProPresenter" status={state.propresenter_status} detail={state.timer.status === "running" ? "Song Countdown running" : `Timer ${state.timer.status}`} icon={<Glyph>PP</Glyph>} />
        <StatusCard title="StagePilot backend" status={backendStatus} detail={health ? `v${health.version} · state revision ${state.revision}` : "Connecting to local API"} icon={<Glyph>API</Glyph>} />
      </section>

      {!plugin && (
        <MidiSetupPanel
          error={midiError}
          message={midiMessage}
          midi={midi}
          messages={midiMessages}
          onRefresh={refreshMidi}
          onSelect={selectMidi}
          onSimulate={simulateMidi}
          pendingCue={pendingMidiCue}
          pendingOperation={pendingMidiOperation}
        />
      )}

      {state.plugins.propresenter && (
        <div className="mt-5">
          <ProPresenterSetupPanel
            error={propresenterError}
            message={propresenterMessage}
            onRefreshTimers={refreshProPresenter}
            onSave={saveProPresenter}
            onTest={runProPresenterTest}
            pendingOperation={pendingProPresenterOperation}
            propresenter={propresenter}
          />
        </div>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(350px,0.8fr)]">
        <section className="overflow-hidden rounded-xl border border-white/7 bg-stage-850 shadow-panel">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-[0.68rem] font-bold uppercase tracking-[0.18em] text-slate-500">Service plan</p>
              <h2 className="mt-1 text-lg font-bold text-white">{plan?.title ?? "No service loaded"}</h2>
              <p className="mt-1 text-xs text-slate-500">
                {plan ? `${plan.service_type} · ${plan.date} · ${plan.service_times.join(", ")}` : "Waiting for a current or upcoming service plan."}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-slate-200">{plan?.songs.length ?? 0} songs</p>
              <p className="text-xs text-slate-500">{plan?.duration_source ?? "Scheduled duration source"}</p>
            </div>
          </div>
          <ol>{plan?.songs.map((song) => <SongRow key={song.id} song={song} current={song.id === state.current_song?.id} next={song.id === state.next_song?.id} />)}</ol>
          {serviceLoad.skipped_items.length > 0 && (
            <div className="border-t border-amber-400/15 bg-amber-400/[0.06] px-4 py-3 text-xs text-amber-200">
              <p className="font-bold uppercase tracking-wider">{serviceLoad.skipped_items.length} non-song {serviceLoad.skipped_items.length === 1 ? "item was" : "items were"} skipped</p>
              <p className="mt-1 text-amber-100/60">{serviceLoad.skipped_items.map((item) => `${item.title} (${item.reason.replaceAll("_", " ")})`).join(", ")}</p>
            </div>
          )}
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
