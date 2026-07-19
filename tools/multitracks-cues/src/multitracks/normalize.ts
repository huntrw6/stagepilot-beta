import type { MidiBank, MidiBus, MidiEvent, Setlist, SetlistItem, SetlistSummary } from "./models.js";

type RecordValue = Record<string, unknown>;

export function asRecord(value: unknown): RecordValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : undefined;
}

function first(record: RecordValue, names: string[]): unknown {
  for (const name of names) if (record[name] !== undefined) return record[name];
  return undefined;
}

function text(record: RecordValue, names: string[]): string | undefined {
  const value = first(record, names);
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function numberValue(record: RecordValue, names: string[]): number | undefined {
  const value = first(record, names);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

export function arrayFrom(value: unknown, names: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  for (const name of names) {
    const candidate = record[name];
    if (Array.isArray(candidate)) return candidate;
    const nested = asRecord(candidate);
    if (nested) {
      const found = arrayFrom(nested, names);
      if (found.length) return found;
    }
  }
  return [];
}

export function normalizeSetlistSummaries(value: unknown): SetlistSummary[] {
  return arrayFrom(value, ["setlists", "items", "data", "results"]).flatMap((item) => {
    const record = asRecord(item);
    const id = record && text(record, ["id", "setlistId", "setlist_id"]);
    if (!record || !id) return [];
    return [{
      id,
      name: text(record, ["name", "title", "setlistName"]) ?? `Setlist ${id}`,
      targetDate: text(record, ["date", "targetDate", "target_date", "serviceDate"]),
    }];
  });
}

export function normalizeSetlist(value: unknown): Setlist {
  const root = asRecord(value) ?? {};
  const nested = asRecord(first(root, ["setlist", "data"])) ?? root;
  const id = text(nested, ["id", "setlistId", "setlist_id"]);
  if (!id) throw new Error("Setlist response did not contain a stable ID.");
  const rawItems = arrayFrom(nested, ["items", "setlistItems", "songs"]);
  return {
    id,
    name: text(nested, ["name", "title", "setlistName"]) ?? `Setlist ${id}`,
    targetDate: text(nested, ["date", "targetDate", "target_date", "serviceDate"]),
    items: rawItems.map((item, index) => normalizeSetlistItem(item, index + 1)),
  };
}

export function normalizeSetlistItem(value: unknown, position: number): SetlistItem {
  const raw = asRecord(value) ?? {};
  const itemType = text(raw, ["itemType", "item_type", "type", "kind"]);
  const title = text(raw, ["title", "name", "songTitle", "song_name"]) ?? `Item ${position}`;
  const explicitSong = first(raw, ["isSong", "is_song"]);
  if (explicitSong === false || (itemType && /header|note|non.?song|section|break/i.test(itemType))) {
    return { position, title, itemType, targetType: "non-song", raw };
  }
  const libraryEntryId = text(raw, ["libraryEntryId", "library_entry_id", "libraryId", "library_id"]);
  const arrangementId = text(raw, ["cloudArrangementId", "cloud_arrangement_id", "arrangementId", "arrangement_id"]);
  const arrangementType = text(raw, ["arrangementType", "arrangement_type", "sourceType", "source_type"]);
  const cloudFlag = first(raw, ["isCloudArrangement", "is_cloud_arrangement"]);
  const explicitCloud = cloudFlag === true || Boolean(arrangementType && /cloud/i.test(arrangementType));
  const explicitLibrary = Boolean(libraryEntryId && (!arrangementType || /library|owned/i.test(arrangementType)) && cloudFlag !== true);
  if (explicitCloud && arrangementId) {
    return { position, title, itemType, targetType: "cloud", libraryEntryId, arrangementId, arrangementType, raw };
  }
  if (explicitLibrary && !explicitCloud) {
    return { position, title, itemType, targetType: "library", libraryEntryId, arrangementId, arrangementType, raw };
  }
  const ambiguity = explicitCloud && !arrangementId
    ? "Cloud arrangement is explicit but no writable arrangement ID is present."
    : "The response does not prove whether this song is a Library or Cloud Arrangement MIDI target.";
  return { position, title, itemType, targetType: "ambiguous", libraryEntryId, arrangementId, arrangementType, raw, ambiguity };
}

export function normalizeMidiBuses(value: unknown): MidiBus[] {
  return arrayFrom(value, ["buses", "midiBuses", "items", "data"]).flatMap((item) => {
    const raw = asRecord(item);
    const id = raw && text(raw, ["id", "busId", "bus_id", "stableId"]);
    if (!raw || !id) return [];
    return [{ id, name: text(raw, ["name", "title", "label"]), type: text(raw, ["type", "busType", "bus_type"]), raw }];
  });
}

export function normalizeMidiBanks(value: unknown): MidiBank[] {
  return arrayFrom(value, ["banks", "midiBanks", "items", "data"]).flatMap((item) => {
    const raw = asRecord(item);
    const id = raw && text(raw, ["id", "bankId", "bank_id"]);
    const name = raw && text(raw, ["name", "title", "bankName", "bank_name"]);
    return raw && id && name ? [{ id, name, raw }] : [];
  });
}

function normalizePosition(raw: RecordValue): Record<string, number> | undefined {
  const nested = asRecord(first(raw, ["position", "songPosition", "song_position"]));
  const source = nested ?? raw;
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(source)) {
    if (/^(measure|bar|beat|tick|milliseconds|time)$/i.test(key)) {
      const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
      if (Number.isFinite(parsed)) result[key] = parsed;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

export function normalizeMidiEvents(value: unknown): MidiEvent[] {
  return arrayFrom(value, ["events", "midiEvents", "items", "data"]).map((item) => {
    const raw = asRecord(item) ?? {};
    const channel = numberValue(raw, ["channel", "midiChannel", "midi_channel"]);
    const note = numberValue(raw, ["note", "noteNumber", "note_number", "midiNote", "midi_note"]);
    const velocity = numberValue(raw, ["velocity", "noteVelocity", "note_velocity"]);
    const position = normalizePosition(raw);
    return {
      id: text(raw, ["id", "eventId", "event_id"]),
      busId: text(raw, ["busId", "bus_id", "midiBusId", "midi_bus_id", "bus"]),
      channel,
      note,
      velocity,
      eventType: text(raw, ["type", "eventType", "event_type", "kind"]),
      position,
      malformed: channel === undefined || note === undefined || velocity === undefined || position === undefined,
      raw,
    };
  });
}
