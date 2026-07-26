import { describe, expect, it } from "vitest";

import { loadingProgressTarget } from "./loadingProgress";

describe("loadingProgressTarget", () => {
  it("advances with real backend startup phases", () => {
    expect(loadingProgressTarget(null)).toBe(24);
    expect(loadingProgressTarget("starting")).toBe(58);
    expect(loadingProgressTarget("ready")).toBe(92);
    expect(loadingProgressTarget("external")).toBe(92);
  });

  it("does not imply completion when startup failed or stopped", () => {
    expect(loadingProgressTarget("failed")).toBe(35);
    expect(loadingProgressTarget("stopped")).toBe(35);
  });
});
