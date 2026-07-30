import path from "node:path";
import type { Configuration } from "../config/schema.js";
import { EXIT } from "../constants.js";
import { AmbiguityError } from "../errors.js";
import type { MultiTracksGateway } from "../multitracks/gateway.js";
import { OperationJournal } from "../reporting/journal.js";
import type { ApplyResult, CuePlanItem, CueProfile } from "./models.js";
import type { CuePlanner } from "./planner.js";

export class CueApplier {
  constructor(
    private readonly gateway: MultiTracksGateway,
    private readonly planner: CuePlanner,
  ) {}

  async applyCuePlan(configuration: Configuration, setlistId: string, reportDirectory: string, cueProfile: CueProfile, positions?: number[]): Promise<ApplyResult> {
    const plan = await this.planner.buildCuePlan(configuration, setlistId, cueProfile, positions);
    const unsafe = plan.items.find((item) =>
      item.operations.some((operation) => operation === "SKIP_AMBIGUOUS" || operation === "SKIP_CONFLICT" || operation === "ERROR"));
    if (unsafe) {
      throw new AmbiguityError(
        `Apply stopped before writing because setlist position ${unsafe.setlistPosition} has an unresolved risk: ${unsafe.reason}`,
        EXIT.AMBIGUOUS,
      );
    }
    const journal = new OperationJournal(path.join(reportDirectory, `journal-${setlistId}.json`));
    const results: ApplyResult["results"] = [];
    for (const initial of plan.items) {
      if (!initial.operations.some((operation) => operation.startsWith("CREATE_"))) {
        const safeSkip = initial.operations.every((operation) => operation === "SKIP_NON_SONG" || operation === "SKIP_ALREADY_PRESENT");
        const status = safeSkip ? "skipped" : "failed";
        results.push({ setlistPosition: initial.setlistPosition, songTitle: initial.songTitle, status, message: initial.reason });
        await journal.record({ timestamp: new Date().toISOString(), setlistPosition: initial.setlistPosition, targetId: initial.targetId, operation: initial.operations.join("+"), outcome: status, message: initial.reason });
        continue;
      }
      const freshPlan = await this.planner.buildCuePlan(configuration, setlistId, cueProfile, [initial.setlistPosition]);
      const fresh = freshPlan.items[0];
      if (!fresh || !fresh.operations.some((operation) => operation.startsWith("CREATE_"))) {
        const verified = fresh?.operations.includes("SKIP_ALREADY_PRESENT") ?? false;
        const message = fresh?.reason ?? "The song disappeared during the fresh pre-write inspection.";
        results.push({ setlistPosition: initial.setlistPosition, songTitle: initial.songTitle, status: verified ? "verified" : "failed", message, eventId: fresh?.existingMatchingEventId });
        await journal.record({ timestamp: new Date().toISOString(), setlistPosition: initial.setlistPosition, targetId: initial.targetId, operation: "REINSPECT", outcome: verified ? "verified" : "failed", message, eventId: fresh?.existingMatchingEventId });
        continue;
      }
      try {
        await this.applyOne(configuration, fresh);
      } catch (error) {
        const reconciled = await this.planner.buildCuePlan(configuration, setlistId, cueProfile, [initial.setlistPosition]);
        const item = reconciled.items[0];
        const verified = item?.operations.includes("SKIP_ALREADY_PRESENT") ?? false;
        const message = verified
          ? "The create response was uncertain, but read-back proved the exact cue exists."
          : `Write failed and read-back did not prove creation: ${error instanceof Error ? error.message : String(error)}`;
        results.push({ setlistPosition: initial.setlistPosition, songTitle: initial.songTitle, status: verified ? "verified" : "failed", message, eventId: item?.existingMatchingEventId });
        await journal.record({ timestamp: new Date().toISOString(), setlistPosition: initial.setlistPosition, targetId: initial.targetId, operation: fresh.operations.join("+"), outcome: verified ? "verified" : "failed", message, eventId: item?.existingMatchingEventId });
        continue;
      }
      const verification = await this.planner.buildCuePlan(configuration, setlistId, cueProfile, [initial.setlistPosition]);
      const verifiedItem = verification.items[0];
      const verified = verifiedItem?.operations.includes("SKIP_ALREADY_PRESENT") ?? false;
      const message = verified ? "Created event was read back and verified." : "Created event could not be verified by read-back.";
      results.push({ setlistPosition: initial.setlistPosition, songTitle: initial.songTitle, status: verified ? "verified" : "failed", message, eventId: verifiedItem?.existingMatchingEventId });
      await journal.record({ timestamp: new Date().toISOString(), setlistPosition: initial.setlistPosition, targetId: initial.targetId, operation: fresh.operations.join("+"), outcome: verified ? "verified" : "failed", message, eventId: verifiedItem?.existingMatchingEventId });
    }
    return { plan, results, success: results.every((result) => result.status !== "failed") };
  }

  private async applyOne(configuration: Configuration, item: CuePlanItem): Promise<void> {
    if (!item.songOrdinal || !item.velocity || !item.resolvedPosition) {
      throw new Error("The planned cue is missing its resolved ordinal, velocity, or one-beat position.");
    }
    const cue = {
      channel: 1,
      note: 112,
      velocity: item.velocity,
      position: item.resolvedPosition,
      songOrdinal: item.songOrdinal,
    };
    if (item.targetType === "library") {
      if (!item.bankId) throw new Error("No verified Default MIDI Bank ID is available.");
      await this.gateway.createLibraryEvent(item.busId, item.libraryId!, item.bankId, cue);
    } else if (item.targetType === "cloud") {
      await this.gateway.createCloudEvent(item.busId, item.arrangementId!, cue);
    } else {
      throw new Error("Ambiguous target reached the apply boundary.");
    }
  }
}
