import { EXIT } from "../constants.js";
import type { Configuration } from "../config/schema.js";
import { AmbiguityError } from "../errors.js";
import type { MultiTracksGateway } from "../multitracks/gateway.js";
import type { MidiBank, MidiBus, MidiEvent, SetlistItem } from "../multitracks/models.js";
import { compareEvent, expectedEvent } from "./compare.js";
import type { CuePlan, CuePlanItem } from "./models.js";

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

export class CuePlanner {
  constructor(private readonly gateway: MultiTracksGateway) {}

  async buildCuePlan(configuration: Configuration, setlistId: string, positions?: number[]): Promise<CuePlan> {
    const [setlist, buses] = await Promise.all([
      this.gateway.getSetlist(setlistId),
      this.gateway.listMidiBuses(),
    ]);
    const selectedBus = validateBus(configuration, buses);
    const selectedPositions = positions ? new Set(positions) : undefined;
    const seenLibraryTargets = new Set<string>();
    const items: CuePlanItem[] = [];
    for (const item of setlist.items) {
      if (selectedPositions && !selectedPositions.has(item.position)) continue;
      if (item.targetType === "non-song") {
        items.push(this.base(item, selectedBus, ["SKIP_NON_SONG"], "This setlist item is explicitly not a song."));
        continue;
      }
      if (item.targetType === "ambiguous") {
        items.push(this.base(item, selectedBus, ["SKIP_AMBIGUOUS"], item.ambiguity ?? "Target type is ambiguous."));
        continue;
      }
      if (item.targetType === "library") {
        if (!item.libraryEntryId) {
          items.push(this.base(item, selectedBus, ["SKIP_AMBIGUOUS"], "Library target has no stable library entry ID."));
          continue;
        }
        if (seenLibraryTargets.has(item.libraryEntryId)) {
          items.push(this.base(item, selectedBus, ["SKIP_ALREADY_PRESENT"], "Repeated occurrence uses the same reusable Library MIDI target already covered by this plan."));
          continue;
        }
        seenLibraryTargets.add(item.libraryEntryId);
        items.push(await this.inspectLibrary(configuration, item, selectedBus, buses));
      } else {
        items.push(await this.inspectCloud(configuration, item, selectedBus, buses));
      }
    }
    return {
      generatedAt: new Date().toISOString(),
      mode: "dry-run",
      setlist,
      items,
      configuration: {
        bankName: configuration.bankName,
        channel: configuration.channel,
        note: configuration.note,
        velocity: configuration.velocity,
        busId: selectedBus.id,
        busType: selectedBus.type,
      },
    };
  }

  private async inspectLibrary(configuration: Configuration, item: SetlistItem, selectedBus: MidiBus, buses: MidiBus[]): Promise<CuePlanItem> {
    const libraryId = item.libraryEntryId!;
    const banks = await this.gateway.listLibraryBanks(libraryId);
    const selectedBanks = banks.filter((bank) => bank.name === configuration.bankName);
    if (selectedBanks.length > 1) {
      return this.base(item, selectedBus, ["SKIP_AMBIGUOUS"], `Multiple MIDI banks are named '${configuration.bankName}'.`, banks);
    }
    const scopes: RemoteEventScope[] = [];
    for (const bank of banks) {
      for (const bus of buses) {
        scopes.push({ bank, bus, events: await this.gateway.listLibraryEvents(libraryId, bank.id, bus.id) });
      }
    }
    const bank = selectedBanks[0];
    if (!bank) {
      const outside = this.findOutsideConflict(configuration, item, selectedBus, scopes);
      if (outside) return this.base(item, selectedBus, ["SKIP_CONFLICT"], outside, banks);
      return {
        ...this.base(item, selectedBus, ["CREATE_BANK", "CREATE_LIBRARY_EVENT"], "The StagePilot bank and cue are missing.", banks),
        libraryId,
        targetId: libraryId,
        proposedBankName: configuration.bankName,
      };
    }
    const expected = expectedEvent(
      this.gateway.expectedEventArguments(configuration, "library", { libraryEntryId: libraryId, bankId: bank.id }),
      selectedBus.id,
    );
    const selectedScope = scopes.find((scope) => scope.bank?.id === bank.id && scope.bus.id === selectedBus.id)!;
    const matches = selectedScope.events.filter((event) => compareEvent(event, expected, selectedBus.id) === "exact");
    const conflict = selectedScope.events.find((event) => ["conflict", "other-position", "malformed"].includes(compareEvent(event, expected, selectedBus.id)));
    const outside = scopes.find((scope) => (scope.bank?.id !== bank.id || scope.bus.id !== selectedBus.id) && scope.events.some((event) => compareEvent(event, { ...expected, busId: scope.bus.id }, scope.bus.id) === "exact"));
    if (matches.length > 1) return this.item(item, selectedBus, bank, selectedScope.events, ["SKIP_CONFLICT"], "Multiple exact StagePilot cues already exist.", matches[0]?.id);
    if (matches.length === 1) return this.item(item, selectedBus, bank, selectedScope.events, ["SKIP_ALREADY_PRESENT"], "The exact StagePilot cue already exists.", matches[0]?.id);
    if (conflict) return this.item(item, selectedBus, bank, selectedScope.events, ["SKIP_CONFLICT"], "A malformed, different-velocity, or different-start cue requires review.");
    if (outside) return this.item(item, selectedBus, bank, selectedScope.events, ["SKIP_CONFLICT"], "An exact cue exists in another bank or on another bus; Playback behavior requires review.");
    return this.item(item, selectedBus, bank, selectedScope.events, ["CREATE_LIBRARY_EVENT"], "The StagePilot bank exists and the exact cue is missing.");
  }

  private async inspectCloud(configuration: Configuration, item: SetlistItem, selectedBus: MidiBus, buses: MidiBus[]): Promise<CuePlanItem> {
    if (!item.arrangementId) return this.base(item, selectedBus, ["SKIP_AMBIGUOUS"], "Cloud target has no writable arrangement ID.");
    const scopes: RemoteEventScope[] = [];
    for (const bus of buses) scopes.push({ bus, events: await this.gateway.listCloudEvents(item.arrangementId, bus.id) });
    const expected = expectedEvent(
      this.gateway.expectedEventArguments(configuration, "cloud", { arrangementId: item.arrangementId }),
      selectedBus.id,
    );
    const selected = scopes.find((scope) => scope.bus.id === selectedBus.id)!;
    const matches = selected.events.filter((event) => compareEvent(event, expected, selectedBus.id) === "exact");
    const conflict = selected.events.find((event) => ["conflict", "other-position", "malformed"].includes(compareEvent(event, expected, selectedBus.id)));
    const outside = scopes.find((scope) => scope.bus.id !== selectedBus.id && scope.events.some((event) => compareEvent(event, { ...expected, busId: scope.bus.id }, scope.bus.id) === "exact"));
    if (matches.length > 1) return this.cloudItem(item, selectedBus, selected.events, ["SKIP_CONFLICT"], "Multiple exact StagePilot cues already exist.", matches[0]?.id);
    if (matches.length === 1) return this.cloudItem(item, selectedBus, selected.events, ["SKIP_ALREADY_PRESENT"], "The exact StagePilot cue already exists.", matches[0]?.id);
    if (conflict || outside) return this.cloudItem(item, selectedBus, selected.events, ["SKIP_CONFLICT"], outside ? "An exact cue exists on another bus." : "A malformed, different-velocity, or different-start cue requires review.");
    return this.cloudItem(item, selectedBus, selected.events, ["CREATE_CLOUD_EVENT"], "The exact cloud-arrangement cue is missing.");
  }

  private findOutsideConflict(configuration: Configuration, item: SetlistItem, selectedBus: MidiBus, scopes: RemoteEventScope[]): string | undefined {
    for (const scope of scopes) {
      if (scope.events.some((event) => event.malformed)) {
        return "A malformed MIDI event in another bank or bus cannot be compared safely; no new bank was created.";
      }
      const expected = { ...expectedEvent(this.gateway.expectedEventArguments(configuration, "library", { libraryEntryId: item.libraryEntryId, bankId: scope.bank!.id }), scope.bus.id), busId: scope.bus.id };
      if (scope.events.some((event) => compareEvent(event, expected, scope.bus.id) === "exact")) {
        return "An exact StagePilot cue already exists in another bank or on another bus; no new bank was created.";
      }
    }
    return undefined;
  }

  private base(item: SetlistItem, bus: MidiBus, operations: CuePlanItem["operations"], reason: string, banks: MidiBank[] = []): CuePlanItem {
    return {
      setlistPosition: item.position,
      songTitle: item.title,
      targetType: item.targetType,
      targetId: item.libraryEntryId ?? item.arrangementId,
      libraryId: item.libraryEntryId,
      arrangementId: item.arrangementId,
      busId: bus.id,
      busType: bus.type,
      operations,
      reason,
      risk: operations.some((operation) => operation.startsWith("SKIP_")) ? reason : undefined,
      verificationStrategy: "Re-read the scoped event list and compare every canonical cue field.",
      existingBanks: banks,
      selectedBusEvents: [],
    };
  }

  private item(item: SetlistItem, bus: MidiBus, bank: MidiBank, events: MidiEvent[], operations: CuePlanItem["operations"], reason: string, eventId?: string): CuePlanItem {
    return { ...this.base(item, bus, operations, reason, [bank]), libraryId: item.libraryEntryId, targetId: item.libraryEntryId, bankId: bank.id, selectedBusEvents: events, existingMatchingEventId: eventId };
  }

  private cloudItem(item: SetlistItem, bus: MidiBus, events: MidiEvent[], operations: CuePlanItem["operations"], reason: string, eventId?: string): CuePlanItem {
    return { ...this.base(item, bus, operations, reason), arrangementId: item.arrangementId, targetId: item.arrangementId, selectedBusEvents: events, existingMatchingEventId: eventId };
  }
}
