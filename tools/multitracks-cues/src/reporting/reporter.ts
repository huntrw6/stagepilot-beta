import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Configuration } from "../config/schema.js";
import type { ApplyResult, CuePlan } from "../cues/models.js";
import { redact } from "../security/redact.js";

export interface ReportEnvelope {
  startedAt: string;
  finishedAt: string;
  command: "inspect" | "prepare" | "apply" | "verify";
  serverOrigin: string;
  organization?: Configuration["organization"];
  setlist: CuePlan["setlist"];
  configuration: CuePlan["configuration"];
  plan: CuePlan["items"];
  apply?: ApplyResult["results"];
  finalStatus: "success" | "failed";
}

function safeTimestamp(date = new Date()): string {
  return date.toISOString().replaceAll(":", "-");
}

function csvCell(value: unknown): string {
  const text = value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export class Reporter {
  constructor(private readonly directory: string) {}

  async write(report: ReportEnvelope): Promise<{ text: string; json: string; csv: string }> {
    await mkdir(this.directory, { recursive: true });
    const base = path.join(this.directory, `${safeTimestamp()}-${report.command}-${report.setlist.id}`);
    const safe = redact(report) as ReportEnvelope;
    const text = this.renderText(safe);
    const csv = [
      ["position", "song", "target", "operations", "reason", "verification"].map(csvCell).join(","),
      ...safe.plan.map((item) => [item.setlistPosition, item.songTitle, item.targetType, item.operations.join("+"), item.reason, item.verificationStrategy].map(csvCell).join(",")),
    ].join("\n");
    await Promise.all([
      writeFile(`${base}.txt`, `${text}\n`, "utf8"),
      writeFile(`${base}.json`, `${JSON.stringify(safe, null, 2)}\n`, "utf8"),
      writeFile(`${base}.csv`, `${csv}\n`, "utf8"),
    ]);
    return { text: `${base}.txt`, json: `${base}.json`, csv: `${base}.csv` };
  }

  renderText(report: ReportEnvelope): string {
    const lines = [
      `StagePilot MultiTracks Cue Report`,
      `Command: ${report.command}`,
      `Started: ${report.startedAt}`,
      `Finished: ${report.finishedAt}`,
      `Server: ${report.serverOrigin}`,
      `Organization: ${report.organization?.name ?? "not confirmed"}`,
      `Setlist: ${report.setlist.name} (${report.setlist.id})`,
      `Cue: channel ${report.configuration.channel}, note ${report.configuration.note}, velocity ${report.configuration.velocity}`,
      `Bus: ${report.configuration.busId}${report.configuration.busType ? ` (${report.configuration.busType})` : ""}`,
      "",
    ];
    for (const item of report.plan) {
      lines.push(`${item.setlistPosition}. ${item.songTitle} — ${item.operations.join(" + ")} — ${item.reason}`);
    }
    lines.push("", `Final status: ${report.finalStatus}`);
    return lines.join("\n");
  }
}
