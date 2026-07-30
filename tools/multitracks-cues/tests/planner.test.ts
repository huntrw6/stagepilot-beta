import { describe, expect, it } from "vitest";
import { defaultConfiguration, type Configuration } from "../src/config/schema.js";
import { CueApplier } from "../src/cues/applier.js";
import type { ResolvedCue } from "../src/cues/models.js";
import { assignSongOrdinals } from "../src/cues/ordinal.js";
import { CuePlanner, resolveDefaultBank } from "../src/cues/planner.js";
import type { MultiTracksGateway } from "../src/multitracks/gateway.js";
import type { MidiBank, MidiBus, MidiEvent, Setlist } from "../src/multitracks/models.js";
import { SETLIST_ORDINAL_TEST_PROFILE } from "../src/constants.js";

const bus: MidiBus = { id: "aux-1", name: "Aux 1", type: "Aux", raw: {} };
const otherBus: MidiBus = { id: "aux-2", name: "Aux 2", type: "Aux", raw: {} };
const configuration: Configuration = { ...defaultConfiguration, midiBus: { id: bus.id } };
const position = { measure: 1, beat: 2, tick: 0 };
const event = (velocity: number, overrides: Partial<MidiEvent> = {}): MidiEvent => ({
  id: `event-${velocity}`, busId: bus.id, channel: 1, note: 112, velocity,
  eventType: "noteOn", position, malformed: false, raw: {}, ...overrides,
});
const librarySong = (setlistPosition: number, id = `library-${setlistPosition}`): Setlist["items"][number] =>
  ({ position: setlistPosition, title: `Song ${setlistPosition}`, targetType: "library", libraryEntryId: id, raw: {} });
const cloudSong = (setlistPosition: number, id = `cloud-${setlistPosition}`): Setlist["items"][number] =>
  ({ position: setlistPosition, title: `Cloud ${setlistPosition}`, targetType: "cloud", arrangementId: id, arrangementType: "cloud", raw: {} });
const nonSong = (setlistPosition: number): Setlist["items"][number] =>
  ({ position: setlistPosition, title: "Header", targetType: "non-song", raw: {} });
const ambiguous = (setlistPosition: number): Setlist["items"][number] =>
  ({ position: setlistPosition, title: "Unknown", targetType: "ambiguous", ambiguity: "unknown", raw: {} });
const setlist = (items: Setlist["items"]): Setlist => ({ id: "set-1", name: "Test", items });

class FakeGateway {
  writes: Array<{ tool: string; velocity: number }> = [];
  banks = new Map<string, MidiBank[]>();
  libraryEvents = new Map<string, MidiEvent[]>();
  cloudEvents = new Map<string, MidiEvent[]>();
  throwAfterCreate = false;
  constructor(public setlist: Setlist) {}
  async getSetlist(): Promise<Setlist> { return this.setlist; }
  async listMidiBuses(): Promise<MidiBus[]> { return [bus, otherBus]; }
  async listLibraryBanks(id: string): Promise<MidiBank[]> {
    return this.banks.get(id) ?? [{ id: `default-${id}`, name: "Default MIDI Bank", isDefault: true, raw: {} }];
  }
  async listLibraryEvents(id: string, bank: string, selectedBus: string): Promise<MidiEvent[]> {
    return this.libraryEvents.get(`${id}:${bank}:${selectedBus}`) ?? [];
  }
  async listCloudEvents(id: string, selectedBus: string): Promise<MidiEvent[]> {
    return this.cloudEvents.get(`${id}:${selectedBus}`) ?? [];
  }
  resolveCue(_target: "library" | "cloud", songOrdinal: number): ResolvedCue {
    return { channel: 1, note: 112, velocity: songOrdinal, songOrdinal, position };
  }
  expectedEventArguments(_target: "library" | "cloud", identity: Record<string, unknown>, busId: string, cue: ResolvedCue): Record<string, unknown> {
    return { ...identity, busId, channel: cue.channel, note: cue.note, velocity: cue.velocity, type: "noteOn", ...cue.position };
  }
  async createLibraryEvent(selectedBus: string, id: string, bank: string, cue: ResolvedCue): Promise<Record<string, unknown>> {
    this.writes.push({ tool: "libraryMidiEventCreate", velocity: cue.velocity });
    this.libraryEvents.set(`${id}:${bank}:${selectedBus}`, [event(cue.velocity)]);
    if (this.throwAfterCreate) {
      this.throwAfterCreate = false;
      throw new Error("temporary uncertain response");
    }
    return {};
  }
  async createCloudEvent(selectedBus: string, id: string, cue: ResolvedCue): Promise<Record<string, unknown>> {
    this.writes.push({ tool: "cloudArrangementMidiEventCreate", velocity: cue.velocity });
    this.cloudEvents.set(`${id}:${selectedBus}`, [event(cue.velocity)]);
    return {};
  }
}

describe("ordinal assignment", () => {
  it("sorts positions and excludes non-song and ambiguous items", () => {
    const result = assignSongOrdinals([librarySong(7), nonSong(2), cloudSong(5), ambiguous(3)]);
    expect(result.map(({ item, songOrdinal }) => [item.position, songOrdinal])).toEqual([
      [2, undefined], [3, undefined], [5, 1], [7, 2],
    ]);
  });

  it("accepts song 127 and fails before song 128", () => {
    expect(assignSongOrdinals(Array.from({ length: 127 }, (_, index) => librarySong(index + 1))).at(-1)?.songOrdinal).toBe(127);
    expect(() => assignSongOrdinals(Array.from({ length: 128 }, (_, index) => librarySong(index + 1)))).toThrow(/more than 127/);
  });
});

describe("Default MIDI Bank resolution", () => {
  it("prefers exactly one explicit default and allows one normalized fallback", () => {
    expect(resolveDefaultBank([{ id: "x", name: "Anything", isDefault: true, raw: {} }])?.id).toBe("x");
    expect(resolveDefaultBank([{ id: "x", name: "  DEFAULT   midi BANK ", raw: {} }])?.id).toBe("x");
  });
  it("fails closed for missing or ambiguous defaults", () => {
    expect(resolveDefaultBank([{ id: "x", name: "StagePilot", raw: {} }])).toBeUndefined();
    expect(resolveDefaultBank([
      { id: "x", name: "Default", isDefault: true, raw: {} },
      { id: "y", name: "Default MIDI Bank", isDefault: true, raw: {} },
    ])).toBeUndefined();
  });
});

describe("cue planning and application", () => {
  it("preserves the full-setlist ordinal when filtering one position", async () => {
    const gateway = new FakeGateway(setlist([librarySong(1), nonSong(2), cloudSong(3), librarySong(7)]));
    const plan = await new CuePlanner(gateway as unknown as MultiTracksGateway).buildCuePlan(configuration, "set-1", SETLIST_ORDINAL_TEST_PROFILE, [7]);
    expect(plan.items[0]).toMatchObject({ setlistPosition: 7, songOrdinal: 3, velocity: 3, resolvedPosition: position });
  });

  it("never creates a bank and skips a missing Default bank", async () => {
    const gateway = new FakeGateway(setlist([librarySong(1)]));
    gateway.banks.set("library-1", [{ id: "custom", name: "StagePilot", raw: {} }]);
    const plan = await new CuePlanner(gateway as unknown as MultiTracksGateway).buildCuePlan(configuration, "set-1", SETLIST_ORDINAL_TEST_PROFILE);
    expect(plan.items[0]?.operations).toEqual(["SKIP_AMBIGUOUS"]);
    expect(gateway.writes).toEqual([]);
  });

  it("rejects repeated reusable Library targets with different ordinals", async () => {
    const gateway = new FakeGateway(setlist([librarySong(1, "same"), librarySong(2, "same")]));
    const plan = await new CuePlanner(gateway as unknown as MultiTracksGateway).buildCuePlan(configuration, "set-1", SETLIST_ORDINAL_TEST_PROFILE);
    expect(plan.items.map((item) => item.operations)).toEqual([["SKIP_AMBIGUOUS"], ["SKIP_AMBIGUOUS"]]);
  });

  it("allows distinct proven Cloud Arrangements but rejects one reused arrangement identity", async () => {
    const distinct = new FakeGateway(setlist([cloudSong(1, "arr-a"), cloudSong(2, "arr-b")]));
    expect((await new CuePlanner(distinct as unknown as MultiTracksGateway).buildCuePlan(configuration, "set-1", SETLIST_ORDINAL_TEST_PROFILE)).items.map((item) => item.operations[0]))
      .toEqual(["CREATE_CLOUD_EVENT", "CREATE_CLOUD_EVENT"]);
    const reused = new FakeGateway(setlist([cloudSong(1, "same"), cloudSong(2, "same")]));
    expect((await new CuePlanner(reused as unknown as MultiTracksGateway).buildCuePlan(configuration, "set-1", SETLIST_ORDINAL_TEST_PROFILE)).items.map((item) => item.operations[0]))
      .toEqual(["SKIP_AMBIGUOUS", "SKIP_AMBIGUOUS"]);
  });

  it("skips exact events and rejects wrong velocity, wrong position, duplicates, and another bus", async () => {
    const gateway = new FakeGateway(setlist([librarySong(1)]));
    const bank = "default-library-1";
    gateway.libraryEvents.set(`library-1:${bank}:${bus.id}`, [event(1)]);
    expect((await new CuePlanner(gateway as unknown as MultiTracksGateway).buildCuePlan(configuration, "set-1", SETLIST_ORDINAL_TEST_PROFILE)).items[0]?.operations).toEqual(["SKIP_ALREADY_PRESENT"]);
    gateway.libraryEvents.set(`library-1:${bank}:${bus.id}`, [event(2)]);
    expect((await new CuePlanner(gateway as unknown as MultiTracksGateway).buildCuePlan(configuration, "set-1", SETLIST_ORDINAL_TEST_PROFILE)).items[0]?.operations).toEqual(["SKIP_CONFLICT"]);
    gateway.libraryEvents.set(`library-1:${bank}:${bus.id}`, [event(1, { position: { measure: 1, beat: 1, tick: 0 } })]);
    expect((await new CuePlanner(gateway as unknown as MultiTracksGateway).buildCuePlan(configuration, "set-1", SETLIST_ORDINAL_TEST_PROFILE)).items[0]?.operations).toEqual(["SKIP_CONFLICT"]);
    gateway.libraryEvents.set(`library-1:${bank}:${bus.id}`, [event(1), event(1, { id: "duplicate" })]);
    expect((await new CuePlanner(gateway as unknown as MultiTracksGateway).buildCuePlan(configuration, "set-1", SETLIST_ORDINAL_TEST_PROFILE)).items[0]?.operations).toEqual(["SKIP_CONFLICT"]);
    gateway.libraryEvents.set(`library-1:${bank}:${bus.id}`, []);
    gateway.libraryEvents.set(`library-1:${bank}:${otherBus.id}`, [event(1, { busId: otherBus.id })]);
    expect((await new CuePlanner(gateway as unknown as MultiTracksGateway).buildCuePlan(configuration, "set-1", SETLIST_ORDINAL_TEST_PROFILE)).items[0]?.operations).toEqual(["SKIP_CONFLICT"]);
  });

  it("dry-run writes nothing; apply creates once, verifies, and is idempotent", async () => {
    const gateway = new FakeGateway(setlist([librarySong(1), cloudSong(2)]));
    const planner = new CuePlanner(gateway as unknown as MultiTracksGateway);
    expect((await planner.buildCuePlan(configuration, "set-1", SETLIST_ORDINAL_TEST_PROFILE)).items.map((item) => item.operations[0]))
      .toEqual(["CREATE_LIBRARY_EVENT", "CREATE_CLOUD_EVENT"]);
    expect(gateway.writes).toEqual([]);
    const applier = new CueApplier(gateway as unknown as MultiTracksGateway, planner);
    expect((await applier.applyCuePlan(configuration, "set-1", process.env.TEMP ?? ".", SETLIST_ORDINAL_TEST_PROFILE)).success).toBe(true);
    expect(gateway.writes).toEqual([
      { tool: "libraryMidiEventCreate", velocity: 1 },
      { tool: "cloudArrangementMidiEventCreate", velocity: 2 },
    ]);
    await applier.applyCuePlan(configuration, "set-1", process.env.TEMP ?? ".", SETLIST_ORDINAL_TEST_PROFILE);
    expect(gateway.writes).toHaveLength(2);
  });

  it("refuses the entire apply before writing when the selected plan contains risk", async () => {
    const gateway = new FakeGateway(setlist([librarySong(1), ambiguous(2)]));
    const planner = new CuePlanner(gateway as unknown as MultiTracksGateway);
    const applier = new CueApplier(gateway as unknown as MultiTracksGateway, planner);
    await expect(applier.applyCuePlan(configuration, "set-1", process.env.TEMP ?? ".", SETLIST_ORDINAL_TEST_PROFILE)).rejects.toThrow(/stopped before writing/);
    expect(gateway.writes).toEqual([]);
  });

  it("reconciles an uncertain create by read-back without a duplicate retry", async () => {
    const gateway = new FakeGateway(setlist([librarySong(1)]));
    gateway.throwAfterCreate = true;
    const planner = new CuePlanner(gateway as unknown as MultiTracksGateway);
    const result = await new CueApplier(gateway as unknown as MultiTracksGateway, planner)
      .applyCuePlan(configuration, "set-1", process.env.TEMP ?? ".", SETLIST_ORDINAL_TEST_PROFILE);
    expect(result.results[0]).toMatchObject({ status: "verified" });
    expect(gateway.writes).toHaveLength(1);
  });
});
