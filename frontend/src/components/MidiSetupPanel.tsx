import { useEffect, useMemo, useState } from "react";

import type {
  MidiCueName,
  MidiInputsResponse,
  MidiMonitorMessage,
  MidiSettingsInput,
  SettingsResponse,
} from "../types";
import { SetupPanelHeader } from "./SetupPanelHeader";

const cues: ReadonlyArray<readonly [MidiCueName, string]> = [
  ["start_next", "Start next"],
  ["restart_current", "Restart current"],
  ["previous", "Previous"],
  ["next", "Next"],
  ["reload_plan", "Reload plan"],
  ["stop_timer", "Stop timer"],
];

const midiNoteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

const midiNoteName = (note: number) =>
  `${midiNoteNames[note % midiNoteNames.length]}${Math.floor(note / 12) - 2}`;

const midiNoteOptions = Array.from({ length: 128 }, (_, note) => ({
  note,
  label: `${midiNoteName(note)} (MIDI ${note})`,
}));

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
  onClose,
  settings,
  pendingSettingsSave = false,
  settingsError = null,
  settingsMessage = null,
  onSaveSettings,
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
  onClose?: () => void;
  settings: SettingsResponse | null;
  pendingSettingsSave?: boolean;
  settingsError?: string | null;
  settingsMessage?: string | null;
  onSaveSettings: (settings: MidiSettingsInput) => void;
}) {
  const [candidateId, setCandidateId] = useState("");
  const [channel, setChannel] = useState("1");
  const [note, setNote] = useState("112");
  const [debounce, setDebounce] = useState("250");
  const [velocities, setVelocities] = useState<Record<MidiCueName, string>>({
    start_next: "100",
    restart_current: "101",
    previous: "102",
    next: "103",
    reload_plan: "104",
    stop_timer: "105",
  });

  useEffect(() => {
    setCandidateId(midi?.inputs.find((input) => input.selected)?.id ?? "");
  }, [midi]);

  useEffect(() => {
    if (!settings) return;
    const midiSettings = settings.settings.midi;
    setChannel(String(midiSettings.channel));
    setNote(String(midiSettings.note));
    setDebounce(String(midiSettings.debounce_ms));
    setVelocities(
      Object.fromEntries(
        cues.map(([cue]) => [cue, String(midiSettings.mappings[cue] ?? "")]),
      ) as Record<MidiCueName, string>,
    );
  }, [settings]);

  const parsedSettings = useMemo<MidiSettingsInput | null>(() => {
    if (!settings) return null;
    const parsedChannel = Number(channel);
    const parsedNote = Number(note);
    const parsedDebounce = Number(debounce);
    const parsedVelocities = Object.fromEntries(
      cues.map(([cue]) => [cue, Number(velocities[cue])]),
    ) as Record<MidiCueName, number>;
    if (!Number.isInteger(parsedChannel) || parsedChannel < 1 || parsedChannel > 16) return null;
    if (!Number.isInteger(parsedNote) || parsedNote < 0 || parsedNote > 127) return null;
    if (!Number.isInteger(parsedDebounce) || parsedDebounce < 0 || parsedDebounce > 2000) return null;
    if (Object.values(parsedVelocities).some((value) => !Number.isInteger(value) || value < 1 || value > 127)) return null;
    if (new Set(Object.values(parsedVelocities)).size !== cues.length) return null;
    return {
      ...settings.settings.midi,
      enabled: true,
      channel: parsedChannel,
      note: parsedNote,
      debounce_ms: parsedDebounce,
      mappings: parsedVelocities,
    };
  }, [channel, debounce, note, settings, velocities]);

  const enabled = midi?.enabled ?? false;
  const selectedInput = midi?.inputs.find((input) => input.selected) ?? null;
  const connectedInput = midi?.inputs.find((input) => input.connected) ?? null;
  const controlsPending = pendingOperation !== null;
  const connectionStatus = connectedInput ? "connected" : midi ? "disconnected" : "loading";

  return (
    <section
      aria-busy={controlsPending || pendingCue !== null}
      aria-labelledby="midi-setup-heading"
      className="setup-panel mt-5 rounded-2xl border border-white/10 bg-slate-950/70 p-5 shadow-2xl shadow-black/20"
      id="midi-configuration"
    >
      <SetupPanelHeader
        closeLabel="Close MIDI / Playback configuration"
        description="The selected source and accepted input device persist between StagePilot launches."
        headingId="midi-setup-heading"
        onClose={onClose}
        status={connectionStatus}
        title="MIDI playback input"
      />

      <div className="mt-4 rounded-lg border border-fuchsia-400/15 bg-fuchsia-400/[0.05] p-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm text-slate-300">
            <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">MIDI channel</span>
            <input className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-slate-100" disabled={pendingSettingsSave} inputMode="numeric" onChange={(event) => setChannel(event.target.value)} value={channel} />
          </label>
          <label className="text-sm text-slate-300">
            <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Fixed note</span>
            <select
              className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-slate-100"
              disabled={pendingSettingsSave}
              onChange={(event) => setNote(event.target.value)}
              value={note}
            >
              {midiNoteOptions.map((option) => (
                <option key={option.note} value={option.note}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-300">
            <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Debounce (ms)</span>
            <input className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-slate-100" disabled={pendingSettingsSave} inputMode="numeric" onChange={(event) => setDebounce(event.target.value)} value={debounce} />
          </label>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cues.map(([cue, label]) => (
            <label className="text-sm text-slate-300" key={cue}>
              <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">{label} velocity</span>
              <input
                aria-label={`${label} velocity`}
                className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-slate-100"
                disabled={pendingSettingsSave}
                inputMode="numeric"
                onChange={(event) => setVelocities((current) => ({ ...current, [cue]: event.target.value }))}
                value={velocities[cue]}
              />
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            className="rounded-lg border border-fuchsia-400/40 bg-fuchsia-500 px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-400 disabled:opacity-40"
            disabled={pendingSettingsSave || parsedSettings === null}
            onClick={() => parsedSettings && onSaveSettings(parsedSettings)}
            type="button"
          >
            {pendingSettingsSave ? "Saving…" : "Save MIDI settings"}
          </button>
          <p className="text-xs text-slate-500">Saving enables real MIDI input. Values must be unique and within the displayed MIDI ranges.</p>
        </div>
      </div>

      {(settingsError || settingsMessage) && (
        <p className={`mt-3 rounded-lg border px-3 py-2 text-sm ${settingsError ? "border-rose-400/20 bg-rose-400/10 text-rose-200" : "border-fuchsia-400/20 bg-fuchsia-400/10 text-fuchsia-200"}`}>
          {settingsError ?? settingsMessage}
        </p>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div>
          {!midi && !error && (
            <p className="rounded-lg border border-white/7 bg-white/[0.025] px-3 py-3 text-sm text-slate-400">
              Loading MIDI configuration…
            </p>
          )}

          {midi && !enabled && (
            <p className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-3 text-sm text-amber-200">
              Save the MIDI settings above, then restart StagePilot to discover and connect the input device.
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
              className="rounded-lg border border-fuchsia-400/30 bg-fuchsia-400/10 px-3.5 py-2.5 text-sm font-semibold text-fuchsia-200 transition hover:bg-fuchsia-400/20 disabled:cursor-wait disabled:opacity-40"
              disabled={controlsPending}
              onClick={onRefresh}
              type="button"
            >
              {pendingOperation === "refresh" ? "Refreshing…" : "Refresh inputs"}
            </button>
            <button
              className="rounded-lg border border-fuchsia-400/40 bg-fuchsia-500 px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!enabled || controlsPending || !candidateId || candidateId === selectedInput?.id}
              onClick={() => onSelect(candidateId)}
              type="button"
            >
              {pendingOperation === "connect" ? "Connecting…" : "Connect"}
            </button>
            <button
              className="rounded-lg border border-fuchsia-400/30 bg-fuchsia-400/10 px-3.5 py-2.5 text-sm font-semibold text-fuchsia-200 transition hover:bg-fuchsia-400/20 disabled:cursor-not-allowed disabled:opacity-40"
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
              className={`mt-3 rounded-lg border px-3 py-2 text-sm ${error ? "border-rose-400/25 bg-rose-400/10 text-rose-200" : "border-fuchsia-400/20 bg-fuchsia-400/10 text-fuchsia-200"}`}
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
              <p className="mt-1 text-xs text-slate-500">Uses the same fixed-note and velocity action path as hardware input.</p>
            </div>
            <span className="rounded-full bg-fuchsia-400/10 px-2.5 py-1 text-xs font-bold text-fuchsia-300">
              Channel {midi?.channel ?? "—"} · Note {midi ? `${midiNoteName(midi.note)} (${midi.note})` : "—"}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {cues.map(([cue, label]) => {
              const velocity = midi?.mappings[cue];
              return (
                <button
                  className="flex items-center justify-between gap-2 rounded-lg border border-fuchsia-400/20 bg-fuchsia-400/[0.06] px-3 py-2 text-left text-sm text-slate-200 transition hover:border-fuchsia-400/35 hover:bg-fuchsia-400/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!enabled || pendingCue !== null || velocity == null}
                  key={cue}
                  onClick={() => onSimulate(cue)}
                  title={velocity == null ? "No MIDI velocity is configured for this cue." : undefined}
                  type="button"
                >
                  <span>{pendingCue === cue ? "Sending…" : label}</span>
                  <span className="font-mono text-xs text-fuchsia-300">{velocity == null ? "—" : `v${velocity}`}</span>
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
