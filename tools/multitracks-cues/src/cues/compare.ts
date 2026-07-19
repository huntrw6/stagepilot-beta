import { normalizeMidiEvents } from "../multitracks/normalize.js";
import type { MidiEvent } from "../multitracks/models.js";

export type EventMatch = "exact" | "conflict" | "other-position" | "unrelated" | "malformed";

function equalPosition(left?: Record<string, number>, right?: Record<string, number>): boolean {
  if (!left || !right) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

export function expectedEvent(args: Record<string, unknown>, impliedBusId: string): MidiEvent {
  const normalized = normalizeMidiEvents({ events: [{ ...args }] })[0];
  if (!normalized) throw new Error("Could not normalize the advertised event input schema.");
  return { ...normalized, busId: normalized.busId ?? impliedBusId };
}

export function compareEvent(actual: MidiEvent, expected: MidiEvent, impliedBusId: string): EventMatch {
  if (actual.malformed) return "malformed";
  const actualBus = actual.busId ?? impliedBusId;
  if (actualBus !== expected.busId || actual.channel !== expected.channel || actual.note !== expected.note) return "unrelated";
  if (!equalPosition(actual.position, expected.position)) {
    return actual.velocity === expected.velocity ? "other-position" : "unrelated";
  }
  return actual.velocity === expected.velocity ? "exact" : "conflict";
}
