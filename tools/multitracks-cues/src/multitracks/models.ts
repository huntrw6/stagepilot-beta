export interface SetlistSummary {
  id: string;
  name: string;
  targetDate?: string;
}

export type TargetType = "library" | "cloud" | "ambiguous" | "non-song";

export interface SetlistItem {
  position: number;
  title: string;
  itemType?: string;
  targetType: TargetType;
  libraryEntryId?: string;
  arrangementId?: string;
  arrangementType?: string;
  raw: Record<string, unknown>;
  ambiguity?: string;
}

export interface Setlist extends SetlistSummary {
  items: SetlistItem[];
}

export interface MidiBus {
  id: string;
  name?: string;
  type?: string;
  raw: Record<string, unknown>;
}

export interface MidiBank {
  id: string;
  name: string;
  raw: Record<string, unknown>;
}

export interface MidiEvent {
  id?: string;
  busId?: string;
  channel?: number;
  note?: number;
  velocity?: number;
  eventType?: string;
  position?: Record<string, number>;
  malformed: boolean;
  raw: Record<string, unknown>;
}
