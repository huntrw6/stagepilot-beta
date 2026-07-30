import { describe, expect, it } from "vitest";
import { SchemaAdapter } from "../src/mcp/schema-adapter.js";

const cue = (position: Record<string, number>) => ({
  channel: 1,
  note: 112,
  velocity: 3,
  songOrdinal: 3,
  position,
});

function schema(position: Record<string, unknown>, nested = true): Record<string, unknown> {
  const common = {
    library_entry_id: { type: "string" },
    bank_id: { type: "string" },
    bus_id: { type: "string" },
    midi_channel: { type: "integer" },
    note_number: { type: "integer" },
    velocity: { type: "integer" },
    event_type: { type: "string", enum: ["noteOn"] },
  };
  return {
    type: "object",
    properties: nested ? { ...common, position: { type: "object", properties: position } } : { ...common, ...position },
    required: [...Object.keys(common), ...(nested ? ["position"] : Object.keys(position))],
  };
}

describe("one-beat schema adapter", () => {
  it("maps a one-based nested position exactly one beat after start", () => {
    const adapter = new SchemaAdapter();
    const advertised = schema({
      measure: { type: "integer", minimum: 1 },
      beat: { type: "integer", minimum: 1 },
      tick: { type: "integer", minimum: 0 },
    });
    const position = adapter.resolveOneBeatPosition(advertised);
    expect(position).toEqual({ measure: 1, beat: 2, tick: 0 });
    expect(adapter.eventArguments(advertised, {
      libraryEntryId: "l1", bankId: "default", busId: "aux", cue: cue(position),
    })).toMatchObject({ velocity: 3, position });
  });

  it("supports zero-based flat coordinates", () => {
    const adapter = new SchemaAdapter();
    const advertised = schema({
      measure: { type: "integer", minimum: 0 },
      beat: { type: "integer", minimum: 0 },
      tick: { type: "integer", minimum: 0 },
    }, false);
    expect(adapter.resolveOneBeatPosition(advertised)).toEqual({ measure: 0, beat: 1, tick: 0 });
  });

  it.each([
    [{ milliseconds: { type: "integer", minimum: 0 } }, "musical beat"],
    [{ tick: { type: "integer", minimum: 0 } }, "musical beat"],
    [{ measure: { type: "integer", minimum: 1 }, beat: { type: "integer" } }, "song-start"],
    [{ measure: { type: "integer", minimum: 1 }, beat: { type: "integer", minimum: 1, maximum: 1 } }, "maximum"],
  ])("fails closed for ambiguous position semantics", (position, message) => {
    expect(() => new SchemaAdapter().resolveOneBeatPosition(schema(position))).toThrow(message);
  });

  it("rejects unsupported required nested position fields", () => {
    const advertised = schema({
      measure: { type: "integer", minimum: 1 },
      beat: { type: "integer", minimum: 1 },
      section: { type: "string" },
    });
    const positionSchema = (advertised.properties as Record<string, Record<string, unknown>>).position!;
    positionSchema.required = ["measure", "beat", "section"];
    expect(() => new SchemaAdapter().resolveOneBeatPosition(advertised)).toThrow(/required position fields/);
  });
});
