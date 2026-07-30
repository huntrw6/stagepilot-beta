import type { ResolvedCue } from "../cues/models.js";
import type { SafeMcpClient } from "../mcp/client.js";
import { SchemaAdapter } from "../mcp/schema-adapter.js";
import {
  normalizeMidiBanks,
  normalizeMidiBuses,
  normalizeMidiEvents,
  normalizeSetlist,
  normalizeSetlistSummaries,
} from "./normalize.js";
import type { MidiBank, MidiBus, MidiEvent, Setlist, SetlistSummary } from "./models.js";

export class MultiTracksGateway {
  constructor(
    readonly client: SafeMcpClient,
    private readonly adapter = new SchemaAdapter(),
  ) {}

  async listSetlists(filters: { from?: string; to?: string; limit?: number } = {}): Promise<SetlistSummary[]> {
    const args = this.adapter.arguments(this.client.schema("setlistsList"), filters);
    return normalizeSetlistSummaries(await this.client.call("setlistsList", args, "read"));
  }

  async getSetlist(setlistId: string): Promise<Setlist> {
    const args = this.adapter.arguments(this.client.schema("setlistGet"), { setlistId });
    return normalizeSetlist(await this.client.call("setlistGet", args, "read"));
  }

  async listMidiBuses(): Promise<MidiBus[]> {
    return normalizeMidiBuses(await this.client.call("midiBusesList", {}, "read"));
  }

  async listLibraryBanks(libraryEntryId: string): Promise<MidiBank[]> {
    const args = this.adapter.arguments(this.client.schema("libraryMidiBanksList"), { libraryEntryId });
    return normalizeMidiBanks(await this.client.call("libraryMidiBanksList", args, "read"));
  }

  async listLibraryEvents(libraryEntryId: string, bankId: string, busId: string): Promise<MidiEvent[]> {
    const args = this.adapter.arguments(this.client.schema("libraryMidiEventsList"), { libraryEntryId, bankId, busId });
    return normalizeMidiEvents(await this.client.call("libraryMidiEventsList", args, "read"));
  }

  async createLibraryEvent(
    busId: string,
    libraryEntryId: string,
    bankId: string,
    cue: ResolvedCue,
  ): Promise<Record<string, unknown>> {
    const args = this.adapter.eventArguments(this.client.schema("libraryMidiEventCreate"), {
      libraryEntryId,
      bankId,
      busId,
      cue,
    });
    await this.client.call("libraryMidiEventCreate", args, "apply");
    return args;
  }

  async listCloudEvents(arrangementId: string, busId: string): Promise<MidiEvent[]> {
    const args = this.adapter.arguments(this.client.schema("cloudArrangementMidiEventsList"), { arrangementId, busId });
    return normalizeMidiEvents(await this.client.call("cloudArrangementMidiEventsList", args, "read"));
  }

  async createCloudEvent(busId: string, arrangementId: string, cue: ResolvedCue): Promise<Record<string, unknown>> {
    const args = this.adapter.eventArguments(this.client.schema("cloudArrangementMidiEventCreate"), {
      arrangementId,
      busId,
      cue,
    });
    await this.client.call("cloudArrangementMidiEventCreate", args, "apply");
    return args;
  }

  resolveCue(target: "library" | "cloud", songOrdinal: number): ResolvedCue {
    const tool = target === "library" ? "libraryMidiEventCreate" : "cloudArrangementMidiEventCreate";
    return {
      channel: 1,
      note: 112,
      velocity: songOrdinal,
      songOrdinal,
      position: this.adapter.resolveOneBeatPosition(this.client.schema(tool)),
    };
  }

  expectedEventArguments(target: "library" | "cloud", identity: { libraryEntryId?: string; bankId?: string; arrangementId?: string }, busId: string, cue: ResolvedCue): Record<string, unknown> {
    const tool = target === "library" ? "libraryMidiEventCreate" : "cloudArrangementMidiEventCreate";
    return this.adapter.eventArguments(this.client.schema(tool), {
      ...identity,
      busId,
      cue,
    });
  }
}
