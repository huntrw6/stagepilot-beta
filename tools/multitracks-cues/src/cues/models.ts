import type { MidiBank, MidiEvent, Setlist } from "../multitracks/models.js";
import type { SETLIST_ORDINAL_TEST_PROFILE } from "../constants.js";

export type CueProfile = typeof SETLIST_ORDINAL_TEST_PROFILE;

export type PlanOperation =
  | "SKIP_NON_SONG"
  | "SKIP_ALREADY_PRESENT"
  | "SKIP_AMBIGUOUS"
  | "SKIP_CONFLICT"
  | "CREATE_LIBRARY_EVENT"
  | "CREATE_CLOUD_EVENT"
  | "ERROR";

export interface CuePlanItem {
  setlistPosition: number;
  songOrdinal?: number;
  velocity?: number;
  songTitle: string;
  targetType: "library" | "cloud" | "ambiguous" | "non-song";
  targetId?: string;
  libraryId?: string;
  arrangementId?: string;
  bankId?: string;
  resolvedPosition?: Record<string, number>;
  busId: string;
  busType?: string;
  existingMatchingEventId?: string;
  operations: PlanOperation[];
  reason: string;
  risk?: string;
  verificationStrategy: string;
  existingBanks: MidiBank[];
  selectedBusEvents: MidiEvent[];
}

export interface CuePlan {
  generatedAt: string;
  mode: "dry-run";
  setlist: Setlist;
  items: CuePlanItem[];
  configuration: {
    cueProfile: "setlist-ordinal-test";
    channel: number;
    note: number;
    busId: string;
    busType?: string;
  };
}

export interface ResolvedCue {
  channel: number;
  note: number;
  velocity: number;
  position: Record<string, number>;
  songOrdinal: number;
}

export interface ApplyResult {
  plan: CuePlan;
  results: Array<{
    setlistPosition: number;
    songTitle: string;
    status: "verified" | "skipped" | "failed";
    message: string;
    eventId?: string;
  }>;
  success: boolean;
}
