import { EXIT } from "../constants.js";
import { SchemaError } from "../errors.js";

type JsonSchema = Record<string, unknown>;

const aliases: Record<string, string[]> = {
  setlistId: ["setlistId", "setlist_id", "id"],
  from: ["from", "startDate", "start_date", "dateFrom"],
  to: ["to", "endDate", "end_date", "dateTo"],
  limit: ["limit", "pageSize", "page_size", "take"],
  libraryEntryId: ["libraryEntryId", "library_entry_id", "libraryId", "library_id"],
  arrangementId: ["arrangementId", "arrangement_id", "cloudArrangementId", "cloud_arrangement_id"],
  bankId: ["bankId", "bank_id", "midiBankId", "midi_bank_id"],
  bankName: ["name", "title", "bankName", "bank_name"],
  busId: ["busId", "bus_id", "midiBusId", "midi_bus_id", "bus"],
  channel: ["channel", "midiChannel", "midi_channel"],
  note: ["note", "noteNumber", "note_number", "midiNote", "midi_note"],
  velocity: ["velocity", "noteVelocity", "note_velocity"],
  eventType: ["type", "eventType", "event_type", "kind"],
  duration: ["duration", "durationTicks", "duration_ticks", "length"],
};

function objectProperties(schema: JsonSchema): Record<string, JsonSchema> {
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return {};
  return properties as Record<string, JsonSchema>;
}

function required(schema: JsonSchema): string[] {
  return Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : [];
}

function pick(schema: JsonSchema, semantic: keyof typeof aliases): string | undefined {
  const properties = objectProperties(schema);
  return aliases[semantic]!.find((name) => name in properties);
}

function minimumValue(schema: JsonSchema): number | undefined {
  if (typeof schema.const === "number") return schema.const;
  if (typeof schema.minimum === "number") return schema.minimum;
  if (typeof schema.default === "number") return schema.default;
  return undefined;
}

export class SchemaAdapter {
  arguments(schema: JsonSchema, values: Record<string, unknown>): Record<string, unknown> {
    const result = this.mapArguments(schema, values);
    const missing = required(schema).filter((name) => !(name in result));
    if (missing.length > 0) {
      throw new SchemaError(`Advertised schema has unsupported required fields: ${missing.join(", ")}.`, EXIT.SCHEMA);
    }
    return result;
  }

  private mapArguments(schema: JsonSchema, values: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [semantic, value] of Object.entries(values)) {
      if (value === undefined) continue;
      const property = pick(schema, semantic as keyof typeof aliases);
      if (property) result[property] = value;
    }
    return result;
  }

  eventArguments(
    schema: JsonSchema,
    values: {
      libraryEntryId?: string;
      arrangementId?: string;
      bankId?: string;
      busId: string;
      channel: number;
      note: number;
      velocity: number;
    },
  ): Record<string, unknown> {
    const result = this.mapArguments(schema, values);
    const properties = objectProperties(schema);
    const typeKey = pick(schema, "eventType");
    if (typeKey) {
      const typeSchema = properties[typeKey] ?? {};
      const choices = Array.isArray(typeSchema.enum) ? typeSchema.enum : [];
      const noteOn = choices.find((item) => typeof item === "string" && /note.?on/i.test(item));
      if (noteOn) result[typeKey] = noteOn;
      else if (required(schema).includes(typeKey)) {
        throw new SchemaError("The event schema does not advertise a Note On event type.", EXIT.SCHEMA);
      }
    }
    this.addStartPosition(schema, result);
    const durationKey = pick(schema, "duration");
    if (durationKey && required(schema).includes(durationKey)) {
      const durationSchema = properties[durationKey] ?? {};
      const minimum = typeof durationSchema.exclusiveMinimum === "number"
        ? durationSchema.exclusiveMinimum + 1
        : Math.max(1, minimumValue(durationSchema) ?? 1);
      result[durationKey] = minimum;
    }
    const missing = required(schema).filter((name) => !(name in result));
    if (missing.length > 0) {
      throw new SchemaError(`Cannot safely represent the cue; unsupported required fields: ${missing.join(", ")}.`, EXIT.SCHEMA);
    }
    return result;
  }

  private addStartPosition(schema: JsonSchema, result: Record<string, unknown>): void {
    const properties = objectProperties(schema);
    const positionKey = ["position", "songPosition", "song_position"].find((key) => key in properties);
    if (positionKey) {
      const positionSchema = properties[positionKey] ?? {};
      const position: Record<string, number> = {};
      for (const [key, valueSchema] of Object.entries(objectProperties(positionSchema))) {
        if (/measure|bar|beat|tick|millisecond|time/i.test(key)) {
          const value = minimumValue(valueSchema);
          if (value === undefined) {
            throw new SchemaError(`Cannot prove the song-start value for position field '${key}'.`, EXIT.SCHEMA);
          }
          position[key] = value;
        }
      }
      if (Object.keys(position).length === 0) {
        throw new SchemaError("The advertised position object has no supported song-start fields.", EXIT.SCHEMA);
      }
      result[positionKey] = position;
      return;
    }
    const positionFields = Object.entries(properties).filter(([key]) => /^(measure|bar|beat|tick|milliseconds|time)$/i.test(key));
    if (positionFields.length === 0) {
      throw new SchemaError("The advertised event schema does not expose a provable song-start position.", EXIT.SCHEMA);
    }
    for (const [key, valueSchema] of positionFields) {
      const value = minimumValue(valueSchema);
      if (value === undefined) throw new SchemaError(`Cannot prove the song-start value for '${key}'.`, EXIT.SCHEMA);
      result[key] = value;
    }
  }
}
