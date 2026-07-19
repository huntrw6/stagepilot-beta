import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { CuePlan } from "../cues/models.js";

export interface OutputOptions {
  json?: boolean;
  quiet?: boolean;
}

export function print(value: unknown, options: OutputOptions = {}): void {
  if (options.quiet) return;
  if (options.json) output.write(`${JSON.stringify(value, null, 2)}\n`);
  else output.write(`${String(value)}\n`);
}

export function renderPlan(plan: CuePlan): string {
  const lines = [
    `${plan.mode.toUpperCase()} — ${plan.setlist.name} (${plan.setlist.id})`,
    `Bus ${plan.configuration.busId}; channel ${plan.configuration.channel}; note ${plan.configuration.note}; velocity ${plan.configuration.velocity}`,
    "",
  ];
  for (const item of plan.items) {
    lines.push(`${String(item.setlistPosition).padStart(2)}  ${item.operations.join(" + ").padEnd(34)}  ${item.songTitle}`);
    lines.push(`    ${item.reason}`);
  }
  return lines.join("\n");
}

export async function ask(question: string): Promise<string> {
  const readline = createInterface({ input, output });
  try {
    return (await readline.question(question)).trim();
  } finally {
    readline.close();
  }
}

export async function askSecret(question: string): Promise<string> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") return ask(question);
  output.write(question);
  input.setRawMode(true);
  input.resume();
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const finish = (): void => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
      resolve(value);
    };
    const onData = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      if (text === "\r" || text === "\n") finish();
      else if (text === "\u0003") {
        input.off("data", onData);
        input.setRawMode(false);
        reject(new Error("Input cancelled."));
      } else if (text === "\b" || text === "\u007f") {
        value = value.slice(0, -1);
      } else if ([...text].every((character) => character.charCodeAt(0) >= 32)) {
        value += text;
      }
    };
    input.on("data", onData);
  });
}

export async function confirmApply(setlistId: string): Promise<boolean> {
  return (await ask(`Type APPLY ${setlistId} to perform the listed remote writes: `)) === `APPLY ${setlistId}`;
}
