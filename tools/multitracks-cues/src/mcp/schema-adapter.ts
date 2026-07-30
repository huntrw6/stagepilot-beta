import { EXIT } from "../constants.js";
import { SchemaError } from "../errors.js";
import type { ResolvedCue } from "../cues/models.js";

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

function maximumValue(schema: JsonSchema): number | undefined {
  if (typeof schema.const === "number") return schema.const;
  if (typeof schema.maximum === "number") return schema.maximum;
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
      cue: ResolvedCue;
    },
  ): Record<string, unknown> {
    const { cue, ...identity } = values;
    const result = this.mapArguments(schema, {
      ...identity,
      channel: cue.channel,
      note: cue.note,
      velocity: cue.velocity,
    });
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
    this.addResolvedPosition(schema, result, cue.position);
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

  resolveOneBeatPosition(schema: JsonSchema): Record<string, number> {
    const properties = objectProperties(schema);
    const positionKey = ["position", "songPosition", "song_position"].find((key) => key in properties);
    const positionSchema = positionKey ? properties[positionKey] ?? {} : schema;
    const fields = positionKey ? objectProperties(positionSchema) : properties;
    const supported = Object.entries(fields).filter(([key]) => /^(measure|bar|beat|tick)$/i.test(key));
    const beatEntry = supported.find(([key]) => /^beat$/i.test(key));
    if (!beatEntry) {
      throw new SchemaError("The advertised event schema does not prove a musical beat coordinate.", EXIT.SCHEMA);
    }
    const position: Record<string, number> = {};
    for (const [key, fieldSchema] of supported) {
      const start = minimumValue(fieldSchema);
      if (start === undefined) {
        throw new SchemaError(`Cannot prove the song-start value for '${key}'.`, EXIT.SCHEMA);
      }
      position[key] = /^beat$/i.test(key) ? start + 1 : start;
      const maximum = maximumValue(fieldSchema);
      if (maximum !== undefined && position[key]! > maximum) {
        throw new SchemaError(`One beat after song start exceeds the advertised maximum for '${key}'.`, EXIT.SCHEMA);
      }
    }
    const missingNested = positionKey ? required(positionSchema).filter((key) => !(key in position)) : [];
    if (missingNested.length) {
      throw new SchemaError(
        `Cannot safely represent required position fields: ${missingNested.join(", ")}.`,
        EXIT.SCHEMA,
      );
    }
    return position;
  }

  private addResolvedPosition(
    schema: JsonSchema,
    result: Record<string, unknown>,
    position: Record<string, number>,
  ): void {
    const properties = objectProperties(schema);
    const positionKey = ["position", "songPosition", "song_position"].find((key) => key in properties);
    if (positionKey) {
      result[positionKey] = position;
      return;
    }
    Object.assign(result, position);
  }
}
