import { describe, expect, it } from "vitest";
import { SchemaAdapter } from "../src/mcp/schema-adapter.js";

describe("dynamic schema adapter", () => {
  it("maps the canonical cue to advertised aliases and earliest valid start", () => {
    const schema = {
      type: "object",
      properties: {
        library_entry_id: { type: "string" }, bank_id: { type: "string" }, bus_id: { type: "string" },
        midi_channel: { type: "integer" }, note_number: { type: "integer" }, velocity: { type: "integer" },
        event_type: { type: "string", enum: ["noteOn", "controlChange"] },
        position: { type: "object", properties: { measure: { type: "integer", minimum: 1 }, beat: { type: "integer", minimum: 1 }, tick: { type: "integer", minimum: 0 } }, required: ["measure", "beat", "tick"] },
        duration: { type: "integer", exclusiveMinimum: 0 },
      },
      required: ["library_entry_id", "bank_id", "bus_id", "midi_channel", "note_number", "velocity", "event_type", "position", "duration"],
    };
    expect(new SchemaAdapter().eventArguments(schema, { libraryEntryId: "l1", bankId: "b1", busId: "aux", channel: 1, note: 112, velocity: 100 })).toMatchObject({
      library_entry_id: "l1", bank_id: "b1", bus_id: "aux", midi_channel: 1, note_number: 112, velocity: 100, event_type: "noteOn", position: { measure: 1, beat: 1, tick: 0 }, duration: 1,
    });
  });

  it("fails safely for unknown required fields or ambiguous start positions", () => {
    expect(() => new SchemaAdapter().arguments({ type: "object", properties: { mystery: { type: "string" } }, required: ["mystery"] }, {})).toThrow(/unsupported required/);
    expect(() => new SchemaAdapter().eventArguments({ type: "object", properties: { channel: { type: "integer" }, note: { type: "integer" }, velocity: { type: "integer" } }, required: ["channel", "note", "velocity"] }, { busId: "b", channel: 1, note: 112, velocity: 100 })).toThrow(/song-start position/);
  });
});
