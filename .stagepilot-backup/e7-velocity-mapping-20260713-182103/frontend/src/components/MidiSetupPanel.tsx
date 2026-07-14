import { useEffect, useState } from "react";

import type { MidiCueName, MidiInputsResponse, MidiMonitorMessage } from "../types";

const cues: ReadonlyArray<readonly [MidiCueName, string]> = [
  ["start_next", "Start next"],
  ["restart_current", "Restart current"],
  ["previous", "Previous"],
  ["next", "Next"],
  ["reload_plan", "Reload plan"],
  ["stop_timer", "Stop timer"],
];

const monitorTone = (message: MidiMonitorMessage) => {
  if (message.disposition === "dispatched") return "text-emerald-300";
  if (message.disposition === "note_release") return "text-slate-400";
  return "text-amber-300";
};

export function MidiSetupPanel({
  midi,
  messages,
  error,
  message,
  pendingOperation,
  pendingCue,
  onRefresh,
  onSelect,
  onSimulate,
}: {
  midi: MidiInputsResponse | null;
  messages: MidiMonitorMessage[];
  error: string | null;
  message: string | null;
  pendingOperation: "refresh" | "connect" | "disconnect" | null;
  pendingCue: MidiCueName | null;
  onRefresh: () => void;
  onSelect: (inputId: string | null) => void;
  onSimulate: (cue: MidiCueName) => void;
}) {
  const [candidateId, setCandidateId] = useState("");

  useEffect(() => {
    setCandidateId(midi?.inputs.find((input) => input.selected)?.id ?? "");
  }, [midi]);

  const enabled = midi?.enabled ?? false;
  const selectedInput = midi?.inputs.find((input) => input.selected) ?? null;
  const connectedInput = midi?.inputs.find((input) => input.connected) ?? null;
  const controlsPending = pendingOperation !== null;

  return (
    <section
      aria-busy={controlsPending || pendingCue !== null}
      aria-labelledby="midi-setup-heading"
      className="mt-5 rounded-xl border border-violet-400/15 bg-[radial-gradient(circle_at_top_right,rgba(167,139,250,0.09),transparent_45%),#111923] p-4 shadow-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[0.68rem] font-black uppercase tracking-[0.18em] text-violet-300">
            Production setup
          </p>
          <h2 id="midi-setup-heading" className="mt-1 text-lg font-bold text-white">
            MIDI playback input
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Input changes apply only to this StagePilot session and reset when the backend restarts.
          </p>
        </div>
        <button
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/10 disabled:cursor-wait disabled:opacity-40"
          disabled={controlsPending}
          onClick={onRefresh}
          type="button"
        >
          {pendingOperation === "refresh" ? "Refreshing…" : "Refresh inputs"}
        </button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div>
          {!midi && !error && (
            <p className="rounded-lg border border-white/7 bg-white/[0.025] px-3 py-3 text-sm text-slate-400">
              Loading MIDI configuration…
            </p>
          )}

          {midi && !enabled && (
            <p className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-3 text-sm text-amber-200">
              The MIDI Playback plugin is disabled. Enable it in the backend configuration, then restart StagePilot.
            </p>
          )}

          <label className="mt-3 block text-xs font-bold uppercase tracking-wider text-slate-400" htmlFor="midi-input">
            Available input
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <select
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!enabled || controlsPending || !midi?.inputs.length}
              id="midi-input"
              onChange={(event) => setCandidateId(event.target.value)}
              value={candidateId}
            >
              <option value="">Choose a MIDI input</option>
              {midi?.inputs.map((input) => (
                <option disabled={input.ambiguous} key={input.id} value={input.id}>
                  {input.name}{input.ambiguous ? " (duplicate name)" : input.connected ? " (connected)" : ""}
                </option>
              ))}
            </select>
            <button
              className="rounded-lg border border-violet-400/30 bg-violet-400/15 px-3.5 py-2.5 text-sm font-semibold text-violet-200 transition hover:bg-violet-400/25 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!enabled || controlsPending || !candidateId || candidateId === selectedInput?.id}
              onClick={() => onSelect(candidateId)}
              type="button"
            >
              {pendingOperation === "connect" ? "Connecting…" : "Connect"}
            </button>
            <button
              className="rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!enabled || controlsPending || !midi?.selected_input_name}
              onClick={() => onSelect(null)}
              type="button"
            >
              {pendingOperation === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className={`rounded-full px-2.5 py-1 font-bold ${connectedInput ? "bg-emerald-400/15 text-emerald-300" : "bg-white/5 text-slate-400"}`}>
              {connectedInput ? `Connected: ${connectedInput.name}` : "No input connected"}
            </span>
            {midi?.selected_input_name && !connectedInput && (
              <span className="rounded-full bg-amber-400/10 px-2.5 py-1 font-bold text-amber-300">
                Waiting for {midi.selected_input_name}
              </span>
            )}
            {midi?.configured_input_name && (
              <span className="rounded-full bg-white/5 px-2.5 py-1 text-slate-400">
                Startup default: {midi.configured_input_name}
              </span>
            )}
          </div>

          {(error || message) && (
            <p
              aria-live="polite"
              className={`mt-3 rounded-lg border px-3 py-2 text-sm ${error ? "border-rose-400/25 bg-rose-400/10 text-rose-200" : "border-violet-400/20 bg-violet-400/10 text-violet-200"}`}
              role={error ? "alert" : "status"}
            >
              {error ?? message}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-white/7 bg-slate-950/30 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Cue test</p>
              <p className="mt-1 text-xs text-slate-500">Uses the same action path as hardware notes.</p>
            </div>
            <span className="rounded-full bg-violet-400/10 px-2.5 py-1 text-xs font-bold text-violet-300">
              Channel {midi?.channel ?? "—"}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {cues.map(([cue, label]) => {
              const note = midi?.mappings[cue];
              return (
                <button
                  className="flex items-center justify-between gap-2 rounded-lg border border-white/7 bg-white/[0.035] px-3 py-2 text-left text-sm text-slate-200 transition hover:border-violet-400/25 hover:bg-violet-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!enabled || pendingCue !== null || note == null}
                  key={cue}
                  onClick={() => onSimulate(cue)}
                  title={note == null ? "No MIDI note is configured for this cue." : undefined}
                  type="button"
                >
                  <span>{pendingCue === cue ? "Sending…" : label}</span>
                  <span className="font-mono text-xs text-violet-300">{note ?? "—"}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Cue tests remain available while the selected hardware input is disconnected.
          </p>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-white/7 bg-slate-950/30">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/7 px-3 py-2.5">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Live MIDI note monitor
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              Shows note-on and note-off messages received from the selected input.
            </p>
          </div>
          <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-slate-400">
            {messages.length} recent
          </span>
        </div>
        {messages.length === 0 ? (
          <p className="px-3 py-4 text-sm text-slate-500">
            No MIDI notes received yet. Send a cue from Playback; an empty monitor points to port or routing configuration.
          </p>
        ) : (
          <div className="max-h-64 overflow-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="sticky top-0 bg-slate-950 text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Time</th>
                  <th className="px-3 py-2 font-semibold">Input</th>
                  <th className="px-3 py-2 font-semibold">Message</th>
                  <th className="px-3 py-2 font-semibold">Channel</th>
                  <th className="px-3 py-2 font-semibold">Note</th>
                  <th className="px-3 py-2 font-semibold">Velocity</th>
                  <th className="px-3 py-2 font-semibold">Result</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((item, index) => (
                  <tr
                    className="border-t border-white/5 text-slate-300"
                    key={`${item.timestamp}-${item.channel}-${item.note}-${index}`}
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-500">
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="max-w-52 truncate px-3 py-2">
                      {item.input_name ?? "Unknown input"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono">
                      {item.message_type}
                    </td>
                    <td className="px-3 py-2 font-mono">{item.channel}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono">
                      {item.note_name} ({item.note})
                    </td>
                    <td className="px-3 py-2 font-mono">{item.velocity}</td>
                    <td className={`px-3 py-2 ${monitorTone(item)}`} title={item.detail}>
                      {item.disposition.replaceAll("_", " ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
