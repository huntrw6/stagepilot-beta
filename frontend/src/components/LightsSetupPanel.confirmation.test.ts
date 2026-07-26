import { afterEach, describe, expect, it, vi } from "vitest";

import {
  confirmClearAllLightingCues,
  confirmClearSelectedLightingCues,
} from "./lightingCueConfirmations";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lighting cue clear confirmations", () => {
  it("confirms clearing only the selected song", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    expect(confirmClearSelectedLightingCues("Holy Forever")).toBe(true);
    expect(confirm).toHaveBeenCalledWith(
      'Clear the lighting cues for "Holy Forever"? This cannot be undone.',
    );
  });

  it("confirms clearing every song in the current plan", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    expect(
      confirmClearAllLightingCues(["Holy Forever", "Gratitude"], "Sunday"),
    ).toBe(false);
    expect(confirm).toHaveBeenCalledWith(
      'Clear all lighting cues for every song in "Sunday"? This cannot be undone.',
    );
  });
});
