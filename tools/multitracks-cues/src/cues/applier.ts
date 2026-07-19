import path from "node:path";
import type { Configuration } from "../config/schema.js";
import type { MultiTracksGateway } from "../multitracks/gateway.js";
import { OperationJournal } from "../reporting/journal.js";
import type { ApplyResult, CuePlanItem } from "./models.js";
import type { CuePlanner } from "./planner.js";

export class CueApplier {
  constructor(
    private readonly gateway: MultiTracksGateway,
    private readonly planner: CuePlanner,
  ) {}

  async applyCuePlan(configuration: Configuration, setlistId: string, reportDirectory: string, positions?: number[]): Promise<ApplyResult> {
    const plan = await this.planner.buildCuePlan(configuration, setlistId, positions);
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
      const freshPlan = await this.planner.buildCuePlan(configuration, setlistId, [initial.setlistPosition]);
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
        const reconciled = await this.planner.buildCuePlan(configuration, setlistId, [initial.setlistPosition]);
        const item = reconciled.items[0];
        const verified = item?.operations.includes("SKIP_ALREADY_PRESENT") ?? false;
        const message = verified
          ? "The create response was uncertain, but read-back proved the exact cue exists."
          : `Write failed and read-back did not prove creation: ${error instanceof Error ? error.message : String(error)}`;
        results.push({ setlistPosition: initial.setlistPosition, songTitle: initial.songTitle, status: verified ? "verified" : "failed", message, eventId: item?.existingMatchingEventId });
        await journal.record({ timestamp: new Date().toISOString(), setlistPosition: initial.setlistPosition, targetId: initial.targetId, operation: fresh.operations.join("+"), outcome: verified ? "verified" : "failed", message, eventId: item?.existingMatchingEventId });
        continue;
      }
      const verification = await this.planner.buildCuePlan(configuration, setlistId, [initial.setlistPosition]);
      const verifiedItem = verification.items[0];
      const verified = verifiedItem?.operations.includes("SKIP_ALREADY_PRESENT") ?? false;
      const message = verified ? "Created event was read back and verified." : "Created event could not be verified by read-back.";
      results.push({ setlistPosition: initial.setlistPosition, songTitle: initial.songTitle, status: verified ? "verified" : "failed", message, eventId: verifiedItem?.existingMatchingEventId });
      await journal.record({ timestamp: new Date().toISOString(), setlistPosition: initial.setlistPosition, targetId: initial.targetId, operation: fresh.operations.join("+"), outcome: verified ? "verified" : "failed", message, eventId: verifiedItem?.existingMatchingEventId });
    }
    return { plan, results, success: results.every((result) => result.status !== "failed") };
  }

  private async applyOne(configuration: Configuration, item: CuePlanItem): Promise<void> {
    if (item.targetType === "library") {
      let bankId = item.bankId;
      if (item.operations.includes("CREATE_BANK")) {
        await this.gateway.createLibraryBank(item.libraryId!, configuration.bankName);
        const banks = (await this.gateway.listLibraryBanks(item.libraryId!)).filter((bank) => bank.name === configuration.bankName);
        if (banks.length !== 1) throw new Error("Bank creation did not resolve to exactly one StagePilot bank.");
        bankId = banks[0]!.id;
      }
      if (!bankId) throw new Error("No verified bank ID is available for Library MIDI event creation.");
      await this.gateway.createLibraryEvent(configuration, item.libraryId!, bankId);
    } else if (item.targetType === "cloud") {
      await this.gateway.createCloudEvent(configuration, item.arrangementId!);
    } else {
      throw new Error("Ambiguous target reached the apply boundary.");
    }
  }
}
