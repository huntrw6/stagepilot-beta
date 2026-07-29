import { useEffect, useMemo, useState } from "react";

import type {
  ApplicationState,
  LightingCue,
  LightsSettingsInput,
  LightsStatusResponse,
  SettingsResponse,
  Song,
} from "../types";
import {
  confirmClearAllLightingCues,
  confirmClearSelectedLightingCues,
} from "./lightingCueConfirmations";
import { SetupPanelHeader } from "./SetupPanelHeader";

const midiNoteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const midiNoteName = (note: number) =>
  `${midiNoteNames[note % midiNoteNames.length]}${Math.floor(note / 12) - 2}`;

type NoteDisplayMode = "music" | "numeric";

const midiNoteOptions = (mode: NoteDisplayMode) =>
  Array.from({ length: 128 }, (_, note) => ({
    note,
    label: mode === "music" ? midiNoteName(note) : String(note),
  }));

const formatElapsed = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

const parseElapsed = (value: string) => {
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

const newCueId = () => {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (value) => {
    const random = Math.floor(Math.random() * 16);
    const nibble = value === "x" ? random : (random & 0x3) | 0x8;
    return nibble.toString(16);
  });
};

const songKey = (song: Song) => song.source_song_id ?? song.id;

export function LightsSetupPanel({
  lights,
  settings,
  state,
  error,
  message,
  pendingOperation,
  onClose,
  onRefresh,
  onSaveSettings,
  onTest,
  onSaveCues,
  onClearAllCues,
}: {
  lights: LightsStatusResponse | null;
  settings: SettingsResponse | null;
  state: ApplicationState;
  error: string | null;
  message: string | null;
  pendingOperation: "save" | "refresh" | "test" | "save-cues" | null;
  onClose?: () => void;
  onRefresh: () => void;
  onSaveSettings: (settings: LightsSettingsInput) => void;
  onTest: (note: number, velocity: number) => void;
  onSaveCues: (song: Song, cues: LightingCue[]) => void;
  onClearAllCues?: (songs: Song[]) => void;
}) {
  const songs = useMemo(() => state.plan?.songs ?? [], [state.plan?.songs]);
  const preferredSongKey = state.current_song ? songKey(state.current_song) : songs[0] ? songKey(songs[0]) : "";
  const [outputName, setOutputName] = useState("");
  const [channel, setChannel] = useState("1");
  const [pulseMs, setPulseMs] = useState("100");
  const [testNote, setTestNote] = useState("60");
  const [testVelocity, setTestVelocity] = useState("127");
  const [selectedSongKey, setSelectedSongKey] = useState(preferredSongKey);
  const [cues, setCues] = useState<LightingCue[]>([]);
  const [noteDisplayMode, setNoteDisplayMode] = useState<NoteDisplayMode>("music");
  const displayedNoteOptions = useMemo(
    () => midiNoteOptions(noteDisplayMode),
    [noteDisplayMode],
  );

  useEffect(() => {
    const source = settings?.settings.lights ?? lights;
    if (!source) return;
    setOutputName(source.output_name ?? "");
    setChannel(String(source.channel));
    setPulseMs(String(source.pulse_ms));
  }, [lights, settings]);

  useEffect(() => {
    if (!songs.some((song) => songKey(song) === selectedSongKey)) {
      setSelectedSongKey(preferredSongKey);
    }
  }, [preferredSongKey, selectedSongKey, songs]);

  const selectedSong = songs.find((song) => songKey(song) === selectedSongKey) ?? null;
  const savedCueMap = selectedSongKey
    ? settings?.settings.lights.cue_maps[selectedSongKey]
    : undefined;

  useEffect(() => {
    setCues(savedCueMap?.cues.map((cue) => ({ ...cue })) ?? []);
  }, [savedCueMap, selectedSongKey]);

  const parsedSettings = useMemo<LightsSettingsInput | null>(() => {
    const parsedChannel = Number(channel);
    const parsedPulse = Number(pulseMs);
    if (!outputName) return null;
    if (!Number.isInteger(parsedChannel) || parsedChannel < 1 || parsedChannel > 15) return null;
    if (!Number.isInteger(parsedPulse) || parsedPulse < 10 || parsedPulse > 2_000) return null;
    return {
      enabled: true,
      output_name: outputName,
      channel: parsedChannel,
      pulse_ms: parsedPulse,
    };
  }, [channel, outputName, pulseMs]);

  const persistCues = (nextCues: LightingCue[]) => {
    const sortedCues = [...nextCues].sort((left, right) => left.at_seconds - right.at_seconds);
    setCues(sortedCues);
    if (selectedSong) onSaveCues(selectedSong, sortedCues);
  };

  const updateCue = (id: string, update: Partial<LightingCue>, save = false) => {
    const nextCues = cues.map((cue) => cue.id === id ? { ...cue, ...update } : cue);
    if (save) persistCues(nextCues);
    else setCues(nextCues);
  };

  const addCue = () => {
    persistCues([
      ...cues,
      {
        id: newCueId(),
        at_seconds: 0,
        note: 60,
        velocity: 127,
        label: "",
      },
    ]);
  };

  const clearSelectedSongCues = () => {
    if (!selectedSong || !cues.length) return;
    if (confirmClearSelectedLightingCues(selectedSong.title)) {
      persistCues([]);
    }
  };

  const clearEverySongCues = () => {
    if (!songs.length) return;
    if (confirmClearAllLightingCues(songs.map((song) => song.title), state.plan?.title ?? null)) {
      setCues([]);
      if (onClearAllCues) onClearAllCues(songs);
      else songs.forEach((song) => onSaveCues(song, []));
    }
  };

  const currentOutputMissing = outputName
    && !lights?.outputs.some((output) => output.name === outputName);

  return (
    <section className="setup-panel mt-5 rounded-2xl border border-white/10 bg-slate-950/70 p-5 shadow-2xl shadow-black/20" id="lights-configuration">
      <SetupPanelHeader
        closeLabel="Close Lights configuration"
        description="Send elapsed-time MIDI Note On/Off pulses to Lightkey or another lighting application."
        onClose={onClose}
        status={lights?.connection_status ?? "loading"}
        title="Lighting configuration"
      />

      {(error || message) && (
        <p aria-live="polite" className={`mt-4 rounded-lg border px-3 py-2 text-sm ${error ? "border-rose-400/25 bg-rose-400/10 text-rose-200" : "border-sky-400/20 bg-sky-400/10 text-sky-200"}`}>
          {error ?? message}
        </p>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-4">
        <label className="text-sm text-slate-300 lg:col-span-2">
          MIDI output to the Lightkey Mac
          <select className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-slate-100" onChange={(event) => setOutputName(event.target.value)} value={outputName}>
            <option value="">Choose an output</option>
            {currentOutputMissing && <option value={outputName}>{outputName} (currently unavailable)</option>}
            {lights?.outputs.map((output, index) => (
              <option disabled={output.ambiguous} key={`${output.name}-${index}`} value={output.name}>
                {output.name}{output.connected ? " (connected)" : output.ambiguous ? " (ambiguous)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-300">
          MIDI channel
          <select className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-slate-100" onChange={(event) => setChannel(event.target.value)} value={channel}>
            {Array.from({ length: 15 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="text-sm text-slate-300">
          Note pulse (ms)
          <input className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-slate-100" max={2000} min={10} onChange={(event) => setPulseMs(event.target.value)} type="number" value={pulseMs} />
        </label>
      </div>
      <p className="mt-2 text-xs text-slate-500">On the Lightkey Mac, choose this network session under Settings → External Control → Input. Channels 1–15 are supported here.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="rounded-lg border border-sky-300/30 bg-sky-300/10 px-3 py-2 text-sm font-semibold text-sky-200 transition hover:bg-sky-300/20 disabled:opacity-40" disabled={pendingOperation !== null} onClick={onRefresh} type="button">{pendingOperation === "refresh" ? "Refreshing…" : "Refresh outputs"}</button>
        <button className="rounded-lg bg-sky-300 px-3 py-2 text-sm font-bold text-slate-950 transition hover:bg-sky-200 disabled:opacity-40" disabled={!parsedSettings || pendingOperation !== null} onClick={() => parsedSettings && onSaveSettings(parsedSettings)} type="button">{pendingOperation === "save" ? "Connecting…" : "Save and connect"}</button>
      </div>

      <div className="mt-6 border-t border-white/7 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold text-slate-100">Test MIDI pulse</h3>
          <div className="flex items-center gap-2" aria-label="MIDI note display">
            <span aria-hidden="true" className={noteDisplayMode === "music" ? "text-sky-200" : "text-slate-500"}>♪</span>
            <button
              aria-checked={noteDisplayMode === "numeric"}
              aria-label={`MIDI note display: ${noteDisplayMode === "music" ? "music notation" : "numeric value"}`}
              className="relative h-7 w-12 cursor-pointer rounded-full border border-sky-300/30 bg-slate-900 transition-colors duration-200 hover:border-sky-300/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
              onClick={() => setNoteDisplayMode((current) => current === "music" ? "numeric" : "music")}
              role="switch"
              type="button"
            >
              <span
                aria-hidden="true"
                className={`absolute top-1 h-4 w-4 rounded-full bg-sky-300 shadow-sm shadow-sky-300/30 transition-transform duration-200 ${noteDisplayMode === "numeric" ? "translate-x-6" : "translate-x-1"}`}
              />
            </button>
            <span aria-hidden="true" className={noteDisplayMode === "numeric" ? "text-sky-200" : "text-slate-500"}>#</span>
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
          <select aria-label="Test lighting note" className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-slate-100" onChange={(event) => setTestNote(event.target.value)} value={testNote}>
            {displayedNoteOptions.map((option) => <option key={option.note} value={option.note}>{option.label}</option>)}
          </select>
          <input aria-label="Test lighting velocity" className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-slate-100" max={127} min={1} onChange={(event) => setTestVelocity(event.target.value)} type="number" value={testVelocity} />
          <button className="rounded-lg border border-sky-300/30 bg-sky-300/10 px-3 py-2 text-sm font-semibold text-sky-200 transition hover:bg-sky-300/20 disabled:opacity-40" disabled={lights?.connection_status !== "connected" || pendingOperation !== null} onClick={() => onTest(Number(testNote), Number(testVelocity))} type="button">{pendingOperation === "test" ? "Sending…" : "Send test cue"}</button>
        </div>
      </div>

      <div className="mt-6 border-t border-white/7 pt-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="min-w-64 text-sm text-slate-300">
            Song lighting timeline
            <select className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-slate-100" onChange={(event) => setSelectedSongKey(event.target.value)} value={selectedSongKey}>
              {!songs.length && <option value="">Load a service plan first</option>}
              {songs.map((song) => <option key={songKey(song)} value={songKey(song)}>{song.order}. {song.title}</option>)}
            </select>
          </label>
          <button className="rounded-lg border border-sky-300/30 bg-sky-300/10 px-3 py-2 text-sm font-semibold text-sky-200 transition hover:bg-sky-300/20 disabled:opacity-40" disabled={!selectedSong || pendingOperation !== null} onClick={addCue} type="button">Add lighting cue</button>
        </div>
        <p className="mt-2 text-xs text-slate-500">Cue times are elapsed from song start. Changes save automatically. The timeline begins only after the ProPresenter countdown confirms it started.</p>

        <div className="mt-3 grid gap-2">
          {cues.map((cue) => (
            <div className="grid gap-2 rounded-lg border border-white/7 bg-white/[0.025] p-3 md:grid-cols-[7rem_minmax(11rem,1fr)_7rem_minmax(9rem,1fr)_auto_auto]" key={cue.id}>
              <input aria-label="Cue elapsed time" className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 font-mono text-slate-100 disabled:opacity-50" defaultValue={formatElapsed(cue.at_seconds)} disabled={pendingOperation !== null} onBlur={(event) => { const parsed = parseElapsed(event.target.value); if (parsed !== null && (selectedSong?.duration_seconds == null || parsed <= selectedSong.duration_seconds)) updateCue(cue.id, { at_seconds: parsed }, true); else event.target.value = formatElapsed(cue.at_seconds); }} placeholder="00:00" />
              <select aria-label="Lighting cue note" className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-slate-100 disabled:opacity-50" disabled={pendingOperation !== null} onChange={(event) => updateCue(cue.id, { note: Number(event.target.value) }, true)} value={cue.note}>
                {displayedNoteOptions.map((option) => <option key={option.note} value={option.note}>{option.label}</option>)}
              </select>
              <input aria-label="Lighting cue velocity" className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-slate-100 disabled:opacity-50" disabled={pendingOperation !== null} max={127} min={1} onBlur={() => cue.velocity >= 1 && cue.velocity <= 127 && persistCues(cues)} onChange={(event) => updateCue(cue.id, { velocity: Number(event.target.value) })} type="number" value={cue.velocity} />
              <input aria-label="Lighting cue label" className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-slate-100 disabled:opacity-50" disabled={pendingOperation !== null} maxLength={120} onBlur={() => persistCues(cues)} onChange={(event) => updateCue(cue.id, { label: event.target.value })} placeholder="Verse, chorus, blackout…" value={cue.label} />
              <button className="rounded-lg border border-sky-300/30 bg-sky-300/10 px-3 py-2 text-xs font-bold text-sky-200 transition hover:bg-sky-300/20 disabled:opacity-40" disabled={lights?.connection_status !== "connected" || pendingOperation !== null} onClick={() => onTest(cue.note, cue.velocity)} type="button">Test</button>
              <button aria-label={`Remove cue at ${formatElapsed(cue.at_seconds)}`} className="rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs font-bold text-rose-300 disabled:opacity-40" disabled={pendingOperation !== null} onClick={() => persistCues(cues.filter((item) => item.id !== cue.id))} type="button">Remove</button>
            </div>
          ))}
          {!cues.length && <p className="rounded-lg border border-dashed border-white/10 px-4 py-5 text-center text-sm text-slate-500">No lighting cues saved for this song.</p>}
        </div>
        {selectedSong?.duration_seconds != null && <p className="mt-2 text-xs text-slate-500">Scheduled song length: {formatElapsed(selectedSong.duration_seconds)}. Cues must fall within this duration.</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-sm font-bold text-rose-200 transition hover:bg-rose-400/20 disabled:opacity-40" disabled={!cues.length || pendingOperation !== null || !selectedSong} onClick={clearSelectedSongCues} type="button">{pendingOperation === "save-cues" ? "Saving cues…" : "Clear"}</button>
          <button className="rounded-lg border border-rose-400/40 bg-rose-400/20 px-4 py-2 text-sm font-bold text-rose-100 transition hover:bg-rose-400/30 disabled:opacity-40" disabled={!songs.length || pendingOperation !== null} onClick={clearEverySongCues} type="button">{pendingOperation === "save-cues" ? "Saving cues…" : "Clear all"}</button>
        </div>
      </div>
    </section>
  );
}
