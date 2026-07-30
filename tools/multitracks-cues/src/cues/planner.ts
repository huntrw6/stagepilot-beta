import { EXIT, SETLIST_ORDINAL_TEST_PROFILE } from "../constants.js";
import type { Configuration } from "../config/schema.js";
import { AmbiguityError } from "../errors.js";
import type { MultiTracksGateway } from "../multitracks/gateway.js";
import type { MidiBank, MidiBus, MidiEvent, SetlistItem } from "../multitracks/models.js";
import { compareEvent, expectedEvent } from "./compare.js";
import type { CuePlan, CuePlanItem, CueProfile, ResolvedCue } from "./models.js";
import { assignSongOrdinals } from "./ordinal.js";

interface RemoteEventScope {
  bank?: MidiBank;
  bus: MidiBus;
  events: MidiEvent[];
}

function validateBus(configuration: Configuration, buses: MidiBus[]): MidiBus {
  if (!configuration.midiBus) {
    throw new AmbiguityError("No MIDI bus is selected. Run 'stagepilot-cues configure'.", EXIT.AMBIGUOUS);
  }
  const matches = buses.filter((bus) => bus.id === configuration.midiBus!.id);
  if (matches.length !== 1) {
    throw new AmbiguityError("The saved MIDI bus no longer exists or is ambiguous; select it again.", EXIT.AMBIGUOUS);
  }
  return matches[0]!;
}

export function resolveDefaultBank(banks: MidiBank[]): MidiBank | undefined {
  const explicit = banks.filter((bank) => bank.isDefault === true);
  if (explicit.length === 1) return explicit[0];
  if (explicit.length > 1) return undefined;
  const named = banks.filter((bank) =>
    ["default midi bank", "default"].includes(bank.name.trim().replace(/\s+/g, " ").toLowerCase()),
  );
  return named.length === 1 ? named[0] : undefined;
}

export class CuePlanner {
  constructor(private readonly gateway: MultiTracksGateway) {}

  async buildCuePlan(configuration: Configuration, setlistId: string, cueProfile: CueProfile, positions?: number[]): Promise<CuePlan> {
    if (cueProfile !== SETLIST_ORDINAL_TEST_PROFILE) {
      throw new AmbiguityError("An explicit supported cue profile is required.", EXIT.INVALID);
    }
    const [setlist, buses] = await Promise.all([this.gateway.getSetlist(setlistId), this.gateway.listMidiBuses()]);
    const selectedBus = validateBus(configuration, buses);
    const assignments = assignSongOrdinals(setlist.items);
    const libraryCounts = new Map<string, number>();
    const cloudCounts = new Map<string, number>();
    for (const { item, songOrdinal } of assignments) {
      if (songOrdinal && item.targetType === "library" && item.libraryEntryId) {
        libraryCounts.set(item.libraryEntryId, (libraryCounts.get(item.libraryEntryId) ?? 0) + 1);
      }
      if (songOrdinal && item.targetType === "cloud" && item.arrangementId) {
        cloudCounts.set(item.arrangementId, (cloudCounts.get(item.arrangementId) ?? 0) + 1);
      }
    }
    const selectedPositions = positions ? new Set(positions) : undefined;
    const items: CuePlanItem[] = [];
    for (const assignment of assignments) {
      const { item, songOrdinal } = assignment;
      if (selectedPositions && !selectedPositions.has(item.position)) continue;
      if (!songOrdinal) {
        items.push(this.base(item, selectedBus, undefined, undefined,
          item.targetType === "non-song" ? ["SKIP_NON_SONG"] : ["SKIP_AMBIGUOUS"],
          item.targetType === "non-song" ? "This setlist item is explicitly not a song." : item.ambiguity ?? "Target type is ambiguous."));
        continue;
      }
      const targetType: "library" | "cloud" = item.targetType === "library" ? "library" : "cloud";
      const cue = this.gateway.resolveCue(targetType, songOrdinal);
      if (
        item.targetType === "library"
        && item.libraryEntryId
        && (libraryCounts.get(item.libraryEntryId) ?? 0) > 1
      ) {
        items.push(this.base(item, selectedBus, songOrdinal, cue, ["SKIP_AMBIGUOUS"],
          "This reusable Library target occurs more than once with different ordinal velocities; one shared event cannot represent each occurrence."));
        continue;
      }
      if (
        item.targetType === "cloud"
        && item.arrangementId
        && (cloudCounts.get(item.arrangementId) ?? 0) > 1
      ) {
        items.push(this.base(item, selectedBus, songOrdinal, cue, ["SKIP_AMBIGUOUS"],
          "This Cloud Arrangement identity is reused for multiple occurrences with different ordinal velocities; occurrence-specific writable targets are not proven."));
        continue;
      }
      items.push(item.targetType === "library"
        ? await this.inspectLibrary(item, selectedBus, buses, cue)
        : await this.inspectCloud(item, selectedBus, buses, cue));
    }
    return {
      generatedAt: new Date().toISOString(),
      mode: "dry-run",
      setlist,
      items,
      configuration: {
        cueProfile: SETLIST_ORDINAL_TEST_PROFILE,
        channel: 1,
        note: 112,
        busId: selectedBus.id,
        busType: selectedBus.type,
      },
    };
  }

  private async inspectLibrary(item: SetlistItem, selectedBus: MidiBus, buses: MidiBus[], cue: ResolvedCue): Promise<CuePlanItem> {
    if (!item.libraryEntryId) return this.base(item, selectedBus, cue.songOrdinal, cue, ["SKIP_AMBIGUOUS"], "Library target has no stable library entry ID.");
    const banks = await this.gateway.listLibraryBanks(item.libraryEntryId);
    const bank = resolveDefaultBank(banks);
    if (!bank) {
      return this.base(item, selectedBus, cue.songOrdinal, cue, ["SKIP_AMBIGUOUS"],
        "The existing Default MIDI Bank is missing or ambiguous; no bank will be created.", banks);
    }
    const scopes: RemoteEventScope[] = [];
    for (const candidateBank of banks) {
      for (const bus of buses) {
        scopes.push({ bank: candidateBank, bus, events: await this.gateway.listLibraryEvents(item.libraryEntryId, candidateBank.id, bus.id) });
      }
    }
    const expected = expectedEvent(
      this.gateway.expectedEventArguments("library", { libraryEntryId: item.libraryEntryId, bankId: bank.id }, selectedBus.id, cue),
      selectedBus.id,
    );
    const selected = scopes.find((scope) => scope.bank?.id === bank.id && scope.bus.id === selectedBus.id)!;
    const matches = selected.events.filter((event) => compareEvent(event, expected, selectedBus.id) === "exact");
    const conflict = selected.events.some((event) => ["conflict", "other-position", "malformed"].includes(compareEvent(event, expected, selectedBus.id)));
    const outside = scopes.some((scope) =>
      (scope.bank?.id !== bank.id || scope.bus.id !== selectedBus.id)
      && scope.events.some((event) =>
        event.malformed
        || compareEvent(event, { ...expected, busId: scope.bus.id }, scope.bus.id) === "exact"));
    if (matches.length > 1) return this.libraryItem(item, selectedBus, bank, selected.events, cue, ["SKIP_CONFLICT"], "Multiple exact ordinal cues already exist.", matches[0]?.id);
    if (matches.length === 1) return this.libraryItem(item, selectedBus, bank, selected.events, cue, ["SKIP_ALREADY_PRESENT"], "The exact ordinal cue already exists.", matches[0]?.id);
    if (conflict || outside) return this.libraryItem(item, selectedBus, bank, selected.events, cue, ["SKIP_CONFLICT"], outside ? "An exact cue exists in another bank or on another bus." : "An existing E7 cue conflicts in velocity, position, or shape.");
    return this.libraryItem(item, selectedBus, bank, selected.events, cue, ["CREATE_LIBRARY_EVENT"], "Create the ordinal cue in the existing Default MIDI Bank.");
  }

  private async inspectCloud(item: SetlistItem, selectedBus: MidiBus, buses: MidiBus[], cue: ResolvedCue): Promise<CuePlanItem> {
    if (!item.arrangementId) return this.base(item, selectedBus, cue.songOrdinal, cue, ["SKIP_AMBIGUOUS"], "Cloud target has no writable arrangement ID.");
    const scopes: RemoteEventScope[] = [];
    for (const bus of buses) scopes.push({ bus, events: await this.gateway.listCloudEvents(item.arrangementId, bus.id) });
    const expected = expectedEvent(
      this.gateway.expectedEventArguments("cloud", { arrangementId: item.arrangementId }, selectedBus.id, cue),
      selectedBus.id,
    );
    const selected = scopes.find((scope) => scope.bus.id === selectedBus.id)!;
    const matches = selected.events.filter((event) => compareEvent(event, expected, selectedBus.id) === "exact");
    const conflict = selected.events.some((event) => ["conflict", "other-position", "malformed"].includes(compareEvent(event, expected, selectedBus.id)));
    const outside = scopes.some((scope) => scope.bus.id !== selectedBus.id
      && scope.events.some((event) =>
        event.malformed
        || compareEvent(event, { ...expected, busId: scope.bus.id }, scope.bus.id) === "exact"));
    if (matches.length > 1) return this.cloudItem(item, selectedBus, selected.events, cue, ["SKIP_CONFLICT"], "Multiple exact ordinal cues already exist.", matches[0]?.id);
    if (matches.length === 1) return this.cloudItem(item, selectedBus, selected.events, cue, ["SKIP_ALREADY_PRESENT"], "The exact ordinal cue already exists.", matches[0]?.id);
    if (conflict || outside) return this.cloudItem(item, selectedBus, selected.events, cue, ["SKIP_CONFLICT"], outside ? "An exact cue exists on another bus." : "An existing E7 cue conflicts in velocity, position, or shape.");
    return this.cloudItem(item, selectedBus, selected.events, cue, ["CREATE_CLOUD_EVENT"], "Create the ordinal cue on the proven Cloud Arrangement.");
  }

  private base(item: SetlistItem, bus: MidiBus, songOrdinal: number | undefined, cue: ResolvedCue | undefined, operations: CuePlanItem["operations"], reason: string, banks: MidiBank[] = []): CuePlanItem {
    return {
      setlistPosition: item.position,
      songOrdinal,
      velocity: cue?.velocity,
      songTitle: item.title,
      targetType: item.targetType,
      targetId: item.libraryEntryId ?? item.arrangementId,
      libraryId: item.libraryEntryId,
      arrangementId: item.arrangementId,
      busId: bus.id,
      busType: bus.type,
      resolvedPosition: cue?.position,
      operations,
      reason,
      risk: operations.some((operation) => operation.startsWith("SKIP_")) ? reason : item.targetType === "library" ? "Velocity is stored on a reusable Library asset and is specific to this test setlist order." : undefined,
      verificationStrategy: "Re-read the scoped event list and compare channel, note, ordinal velocity, one-beat position, bus, and target.",
      existingBanks: banks,
      selectedBusEvents: [],
    };
  }

  private libraryItem(item: SetlistItem, bus: MidiBus, bank: MidiBank, events: MidiEvent[], cue: ResolvedCue, operations: CuePlanItem["operations"], reason: string, eventId?: string): CuePlanItem {
    return { ...this.base(item, bus, cue.songOrdinal, cue, operations, reason, [bank]), bankId: bank.id, selectedBusEvents: events, existingMatchingEventId: eventId };
  }

  private cloudItem(item: SetlistItem, bus: MidiBus, events: MidiEvent[], cue: ResolvedCue, operations: CuePlanItem["operations"], reason: string, eventId?: string): CuePlanItem {
    return { ...this.base(item, bus, cue.songOrdinal, cue, operations, reason), selectedBusEvents: events, existingMatchingEventId: eventId };
  }
}
