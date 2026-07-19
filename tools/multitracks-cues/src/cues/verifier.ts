import type { Configuration } from "../config/schema.js";
import type { CuePlanner } from "./planner.js";

export interface VerificationSummary {
  verified: number;
  missing: number;
  conflicting: number;
  duplicated: number;
  skipped: number;
  success: boolean;
}

export async function verifyCuePlan(
  planner: CuePlanner,
  configuration: Configuration,
  setlistId: string,
  positions?: number[],
): Promise<{ plan: Awaited<ReturnType<CuePlanner["buildCuePlan"]>>; summary: VerificationSummary }> {
  const plan = await planner.buildCuePlan(configuration, setlistId, positions);
  const summary: VerificationSummary = { verified: 0, missing: 0, conflicting: 0, duplicated: 0, skipped: 0, success: true };
  for (const item of plan.items) {
    if (item.operations.includes("SKIP_NON_SONG")) summary.skipped += 1;
    else if (item.operations.includes("SKIP_ALREADY_PRESENT")) {
      summary.verified += 1;
      if (/multiple/i.test(item.reason)) summary.duplicated += 1;
    } else if (item.operations.includes("SKIP_CONFLICT") || item.operations.includes("SKIP_AMBIGUOUS")) summary.conflicting += 1;
    else if (item.operations.some((operation) => operation.startsWith("CREATE_"))) summary.missing += 1;
  }
  summary.success = summary.missing === 0 && summary.conflicting === 0 && summary.duplicated === 0;
  return { plan, summary };
}
