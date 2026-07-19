import { describe, expect, it } from "vitest";
import { defaultConfiguration, type Configuration } from "../src/config/schema.js";
import { CueApplier } from "../src/cues/applier.js";
import { CuePlanner } from "../src/cues/planner.js";
import type { MultiTracksGateway } from "../src/multitracks/gateway.js";
import type { MidiBank, MidiBus, MidiEvent, Setlist } from "../src/multitracks/models.js";

const bus: MidiBus = { id: "aux-1", name: "Aux 1", type: "Aux", raw: {} };
const otherBus: MidiBus = { id: "lights", name: "Lights", type: "Lights", raw: {} };
const configuration: Configuration = { ...defaultConfiguration, midiBus: { id: bus.id, name: bus.name, type: bus.type } };
const exactEvent = (id = "event-1", velocity = 100, position = { measure: 1, beat: 1, tick: 0 }): MidiEvent => ({ id, busId: bus.id, channel: 1, note: 112, velocity, eventType: "noteOn", position, malformed: false, raw: {} });

class FakeGateway {
  writes: string[] = [];
  banks = new Map<string, MidiBank[]>();
  libraryEvents = new Map<string, MidiEvent[]>();
  cloudEvents = new Map<string, MidiEvent[]>();

  constructor(public setlist: Setlist) {}
  async getSetlist(): Promise<Setlist> { return this.setlist; }
  async listMidiBuses(): Promise<MidiBus[]> { return [bus, otherBus]; }
  async listLibraryBanks(id: string): Promise<MidiBank[]> { return this.banks.get(id) ?? []; }
  async listLibraryEvents(libraryId: string, bankId: string, busId: string): Promise<MidiEvent[]> { return this.libraryEvents.get(`${libraryId}:${bankId}:${busId}`) ?? []; }
  async listCloudEvents(arrangementId: string, busId: string): Promise<MidiEvent[]> { return this.cloudEvents.get(`${arrangementId}:${busId}`) ?? []; }
  expectedEventArguments(_config: Configuration, _target: "library" | "cloud", identity: Record<string, unknown>): Record<string, unknown> {
    return { ...identity, busId: bus.id, channel: 1, note: 112, velocity: 100, type: "noteOn", measure: 1, beat: 1, tick: 0 };
  }
  async createLibraryBank(libraryId: string, name: string): Promise<void> {
    this.writes.push("libraryMidiBankCreate");
    this.banks.set(libraryId, [...(this.banks.get(libraryId) ?? []), { id: `bank-${libraryId}`, name, raw: {} }]);
  }
  async createLibraryEvent(_config: Configuration, libraryId: string, bankId: string): Promise<Record<string, unknown>> {
    this.writes.push("libraryMidiEventCreate");
    this.libraryEvents.set(`${libraryId}:${bankId}:${bus.id}`, [exactEvent(`event-${libraryId}`)]);
    return {};
  }
  async createCloudEvent(_config: Configuration, arrangementId: string): Promise<Record<string, unknown>> {
    this.writes.push("cloudArrangementMidiEventCreate");
    this.cloudEvents.set(`${arrangementId}:${bus.id}`, [exactEvent(`event-${arrangementId}`)]);
    return {};
  }
}

function setlist(items: Setlist["items"]): Setlist {
  return { id: "set-1", name: "Sunday", targetDate: "2026-07-19", items };
}

const librarySong = (position: number, id = `library-${position}`): Setlist["items"][number] => ({ position, title: `Song ${position}`, targetType: "library", libraryEntryId: id, raw: {} });
const cloudSong = (position: number, id = `cloud-${position}`): Setlist["items"][number] => ({ position, title: `Cloud ${position}`, targetType: "cloud", arrangementId: id, arrangementType: "cloud", raw: {} });

describe("cue planning and application", () => {
  it("dry-run proposes a bank and one library event without any writes", async () => {
    const gateway = new FakeGateway(setlist([librarySong(1)]));
    const plan = await new CuePlanner(gateway as unknown as MultiTracksGateway).buildCuePlan(configuration, "set-1");
    expect(plan.items[0]?.operations).toEqual(["CREATE_BANK", "CREATE_LIBRARY_EVENT"]);
    expect(gateway.writes).toEqual([]);
  });

  it("skips exact cues, reports conflicts, and deduplicates reusable library targets", async () => {
    const gateway = new FakeGateway(setlist([librarySong(1, "same"), librarySong(2, "same"), librarySong(3, "conflict")]));
    gateway.banks.set("same", [{ id: "bank-same", name: "StagePilot", raw: {} }]);
    gateway.libraryEvents.set(`same:bank-same:${bus.id}`, [exactEvent()]);
    gateway.banks.set("conflict", [{ id: "bank-conflict", name: "StagePilot", raw: {} }]);
    gateway.libraryEvents.set(`conflict:bank-conflict:${bus.id}`, [exactEvent("conflict-event", 101)]);
    const plan = await new CuePlanner(gateway as unknown as MultiTracksGateway).buildCuePlan(configuration, "set-1");
    expect(plan.items.map((item) => item.operations[0])).toEqual(["SKIP_ALREADY_PRESENT", "SKIP_ALREADY_PRESENT", "SKIP_CONFLICT"]);
  });

  it("refuses duplicate bank names and cues found on another bank or bus", async () => {
    const gateway = new FakeGateway(setlist([librarySong(1)]));
    gateway.banks.set("library-1", [
      { id: "a", name: "StagePilot", raw: {} },
      { id: "b", name: "StagePilot", raw: {} },
    ]);
    const duplicatePlan = await new CuePlanner(gateway as unknown as MultiTracksGateway).buildCuePlan(configuration, "set-1");
    expect(duplicatePlan.items[0]?.operations).toEqual(["SKIP_AMBIGUOUS"]);

    gateway.banks.set("library-1", [{ id: "other", name: "Other", raw: {} }]);
    gateway.libraryEvents.set(`library-1:other:${otherBus.id}`, [{ ...exactEvent(), busId: otherBus.id }]);
    const outsidePlan = await new CuePlanner(gateway as unknown as MultiTracksGateway).buildCuePlan(configuration, "set-1");
    expect(outsidePlan.items[0]?.operations).toEqual(["SKIP_CONFLICT"]);
  });

  it("supports explicit cloud arrangements and skips non-song or ambiguous items", async () => {
    const gateway = new FakeGateway(setlist([
      cloudSong(1),
      { position: 2, title: "Welcome", targetType: "non-song", raw: {} },
      { position: 3, title: "Unknown", targetType: "ambiguous", ambiguity: "No explicit target", raw: {} },
    ]));
    const plan = await new CuePlanner(gateway as unknown as MultiTracksGateway).buildCuePlan(configuration, "set-1");
    expect(plan.items.map((item) => item.operations[0])).toEqual(["CREATE_CLOUD_EVENT", "SKIP_NON_SONG", "SKIP_AMBIGUOUS"]);
  });

  it("applies sequentially, verifies every create, and is idempotent on rerun", async () => {
    const gateway = new FakeGateway(setlist([librarySong(1), cloudSong(2)]));
    const planner = new CuePlanner(gateway as unknown as MultiTracksGateway);
    const applier = new CueApplier(gateway as unknown as MultiTracksGateway, planner);
    const first = await applier.applyCuePlan(configuration, "set-1", process.env.TEMP ?? ".");
    expect(first.success).toBe(true);
    expect(first.results.map((item) => item.status)).toEqual(["verified", "verified"]);
    expect(gateway.writes).toEqual(["libraryMidiBankCreate", "libraryMidiEventCreate", "cloudArrangementMidiEventCreate"]);
    const writes = gateway.writes.length;
    const second = await applier.applyCuePlan(configuration, "set-1", process.env.TEMP ?? ".");
    expect(second.success).toBe(true);
    expect(gateway.writes).toHaveLength(writes);
  });

  it("fails safely when the selected bus disappears", async () => {
    const gateway = new FakeGateway(setlist([librarySong(1)]));
    gateway.listMidiBuses = async () => [otherBus];
    await expect(new CuePlanner(gateway as unknown as MultiTracksGateway).buildCuePlan(configuration, "set-1")).rejects.toThrow(/no longer exists/);
  });
});
