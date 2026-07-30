import { EXIT } from "../constants.js";
import { AmbiguityError } from "../errors.js";
import type { SetlistItem } from "../multitracks/models.js";

export interface OrdinalAssignment {
  item: SetlistItem;
  songOrdinal?: number;
}

export function assignSongOrdinals(items: SetlistItem[]): OrdinalAssignment[] {
  const sorted = [...items].sort((left, right) => left.position - right.position);
  let ordinal = 0;
  const assignments = sorted.map((item) => {
    if (item.targetType !== "library" && item.targetType !== "cloud") return { item };
    ordinal += 1;
    if (ordinal > 127) {
      throw new AmbiguityError(
        "The setlist contains more than 127 qualifying songs; MIDI velocity cannot represent every ordinal.",
        EXIT.AMBIGUOUS,
      );
    }
    return { item, songOrdinal: ordinal };
  });
  return assignments;
}
