#!/usr/bin/env node
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { Command, InvalidArgumentError } from "commander";
import { APP_VERSION, EXIT } from "../constants.js";
import { ConfigurationStore, applicationDataDirectory } from "../config/store.js";
import { configurationSchema } from "../config/schema.js";
import { runDoctor } from "../doctor.js";
import { Reporter } from "../reporting/reporter.js";
import { sanitizedError } from "../security/redact.js";
import {
  applyCuePlan,
  connect,
  createAuthentication,
  inspectSetlist,
  listSetlists,
  saveSanitizedToolSchemas,
  verifyCuePlan,
} from "../services.js";
import { StagePilotCuesError } from "../errors.js";
import { ask, askSecret, confirmApply, print, renderPlan } from "./io.js";

interface GlobalOptions {
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  color?: boolean;
}

const program = new Command();
program
  .name("stagepilot-cues")
  .description("Safely add StagePilot Start next MIDI cues through the official MultiTracks MCP server.")
  .version(APP_VERSION)
  .option("--json", "print machine-readable JSON")
  .option("--quiet", "suppress normal terminal output")
  .option("--verbose", "show additional diagnostics")
  .option("--no-color", "disable colored output");

const globals = (): GlobalOptions => program.opts<GlobalOptions>();
const isoDate = (value: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new InvalidArgumentError("Use YYYY-MM-DD.");
  }
  return value;
};
const positiveInteger = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new InvalidArgumentError("Use a positive integer.");
  return parsed;
};
const reportDirectory = (configured: string): string =>
  path.isAbsolute(configured) ? configured : path.join(applicationDataDirectory(), configured);

async function withConnection<T>(operation: (services: Awaited<ReturnType<typeof connect>>) => Promise<T>): Promise<T> {
  const services = await connect();
  try {
    return await operation(services);
  } finally {
    await services.close();
  }
}

const auth = program.command("auth").description("Manage MultiTracks OAuth authentication.");
auth.command("login").description("Log in through the system browser using PKCE.").action(async () => {
  const { configStore, auth: service } = createAuthentication();
  let configuration = await configStore.load();
  const organizations = await service.login(configuration);
  configuration = await configStore.load();
  if (organizations.length === 1) {
    const candidate = organizations[0]!;
    const answer = await ask(`Use MultiTracks organization '${candidate.name}' (${candidate.id})? [y/N] `);
    if (/^y(?:es)?$/i.test(answer)) configuration = await service.selectOrganization(configuration, candidate);
    else throw new StagePilotCuesError("Organization selection was not confirmed.", EXIT.AMBIGUOUS);
  } else if (organizations.length > 1) {
    print(organizations.map((organization, index) => `${index + 1}. ${organization.name} (${organization.id})`).join("\n"), globals());
    const selection = positiveInteger(await ask("Select the organization number: "));
    const candidate = organizations[selection - 1];
    if (!candidate) throw new StagePilotCuesError("Organization selection is out of range.", EXIT.AMBIGUOUS);
    const confirmation = await ask(`Confirm '${candidate.name}'? [y/N] `);
    if (!/^y(?:es)?$/i.test(confirmation)) throw new StagePilotCuesError("Organization selection was not confirmed.", EXIT.AMBIGUOUS);
    configuration = await service.selectOrganization(configuration, candidate);
  }
  print({ authenticated: true, organization: configuration.organization ?? "not exposed by OAuth userinfo" }, globals());
});

auth.command("status").description("Show authentication state without exposing tokens.").action(async () => {
  const { configStore, auth: service } = createAuthentication();
  print(await service.status(await configStore.load()), globals());
});

auth.command("logout").description("Revoke tokens when supported and remove local credentials.").action(async () => {
  const { configStore, auth: service } = createAuthentication();
  await service.logout(await configStore.load());
  print("Logged out; local tokens and cached organization identity were removed.", globals());
});

program.command("doctor").description("Run read-only environment, OAuth, MCP capability, and MIDI bus checks.").action(async () => {
  const checks = await runDoctor();
  print(globals().json ? checks : checks.map((check) => `${check.status.toUpperCase().padEnd(7)} ${check.name}: ${check.message}`).join("\n"), globals());
  if (checks.some((check) => check.status === "error")) process.exitCode = EXIT.AUTH;
});

program.command("tools")
  .description("List MCP tools and optionally save sanitized schemas.")
  .option("--output <file>", "write sanitized schemas to a local JSON file")
  .action(async (options: { output?: string }) => withConnection(async (services) => {
    const tools = services.client.listTools();
    if (options.output) {
      await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
      await saveSanitizedToolSchemas(services, path.resolve(options.output));
    }
    print(globals().json ? tools.map((tool) => tool.name) : tools.map((tool) => tool.name).join("\n"), globals());
  }));

const setlists = program.command("setlists").description("List and inspect MultiTracks setlists.");
setlists.command("list")
  .option("--from <date>", "first target date", isoDate)
  .option("--to <date>", "last target date", isoDate)
  .option("--limit <number>", "maximum results", positiveInteger, 50)
  .action(async (options: { from?: string; to?: string; limit: number }) => withConnection(async (services) => {
    const result = await listSetlists(services, options);
    print(globals().json ? result : result.map((item) => `${item.targetDate ?? "no date"}  ${item.name}  [${item.id}]`).join("\n") || "No setlists found.", globals());
  }));

setlists.command("inspect")
  .requiredOption("--setlist-id <id>")
  .option("--song-position <number>", "inspect one setlist position", positiveInteger)
  .action(async (options: { setlistId: string; songPosition?: number }) => runPlanCommand("inspect", options));

program.command("configure").description("Configure OAuth client, cue defaults, and an explicit MIDI bus.").action(async () => {
  const { configStore, auth: service } = createAuthentication();
  let current = await configStore.load();
  const clientId = await ask(`MultiTracks-issued OAuth client ID [${current.clientId ?? "not configured"}]: `);
  const clientSecret = clientId ? await askSecret("Optional MultiTracks-issued client secret (leave blank for none): ") : "";
  if (clientId) current = await service.configureClient(current, clientId, clientSecret || undefined);
  const bankName = await ask(`MIDI bank name [${current.bankName}]: `);
  const channel = await ask(`MIDI channel [${current.channel}]: `);
  const note = await ask(`MIDI note [${current.note} / E7]: `);
  const velocity = await ask(`Velocity [${current.velocity}]: `);
  const reportDirectoryValue = await ask(`Report directory [${current.reportDirectory}]: `);
  current = configurationSchema.parse({
    ...current,
    bankName: bankName || current.bankName,
    channel: channel ? Number(channel) : current.channel,
    note: note ? Number(note) : current.note,
    velocity: velocity ? Number(velocity) : current.velocity,
    reportDirectory: reportDirectoryValue || current.reportDirectory,
    color: !process.env.NO_COLOR,
  });
  try {
    await withConnection(async (services) => {
      const buses = await services.gateway.listMidiBuses();
      print(buses.map((bus) => `${bus.name ?? "unnamed"} | ${bus.type ?? "unknown type"} | ${bus.id}`).join("\n"), globals());
      const selectedId = await ask("Enter the exact stable ID of the dedicated MIDI bus (blank keeps current selection): ");
      if (selectedId) {
        const matches = buses.filter((bus) => bus.id === selectedId);
        if (matches.length !== 1) throw new StagePilotCuesError("Bus ID did not resolve to exactly one advertised bus.", EXIT.AMBIGUOUS);
        const selected = matches[0]!;
        if (/lyrics|lights|patch|guitar/i.test(`${selected.name ?? ""} ${selected.type ?? ""}`)) {
          throw new StagePilotCuesError("Refusing a protected or unrelated production bus; select a dedicated unused Aux bus.", EXIT.AMBIGUOUS);
        }
        current = { ...current, midiBus: { id: selected.id, name: selected.name, type: selected.type } };
      }
    });
  } catch (error) {
    print(`MIDI bus selection deferred: ${sanitizedError(error)}`, globals());
  }
  await configStore.save(current);
  print("Configuration saved. No remote MIDI data was changed.", globals());
});

program.command("prepare")
  .description("Dry-run the exact changes for a setlist (default safe mode).")
  .requiredOption("--setlist-id <id>")
  .option("--song-position <number>", "prepare one test song", positiveInteger)
  .action(async (options: { setlistId: string; songPosition?: number }) => runPlanCommand("prepare", options));

program.command("apply")
  .description("Explicitly apply and verify safe cue additions.")
  .requiredOption("--setlist-id <id>")
  .option("--song-position <number>", "apply to one test song", positiveInteger)
  .option("--yes", "skip typed confirmation (automation only)")
  .action(async (options: { setlistId: string; songPosition?: number; yes?: boolean }) => {
    const configStore = new ConfigurationStore();
    const configuration = await configStore.load();
    await withConnection(async (services) => {
      const positions = options.songPosition ? [options.songPosition] : undefined;
      const fresh = await inspectSetlist(services, configuration, options.setlistId, positions);
      print(globals().json ? fresh : renderPlan(fresh), globals());
      if (!options.yes && !(await confirmApply(options.setlistId))) {
        throw new StagePilotCuesError("Apply cancelled; no remote writes occurred.", EXIT.INVALID);
      }
      const startedAt = new Date().toISOString();
      const directory = reportDirectory(configuration.reportDirectory);
      const result = await applyCuePlan(services, configuration, options.setlistId, directory, positions);
      const reporter = new Reporter(directory);
      const files = await reporter.write({
        startedAt,
        finishedAt: new Date().toISOString(),
        command: "apply",
        serverOrigin: new URL(configuration.serverUrl).origin,
        organization: configuration.organization,
        setlist: result.plan.setlist,
        configuration: result.plan.configuration,
        plan: result.plan.items,
        apply: result.results,
        finalStatus: result.success ? "success" : "failed",
      });
      print(globals().json ? { ...result, reports: files } : `${result.results.map((item) => `${item.status.toUpperCase()} ${item.songTitle}: ${item.message}`).join("\n")}\nReports: ${files.json}`, globals());
      if (!result.success) process.exitCode = EXIT.PARTIAL_FAILURE;
    });
  });

program.command("verify")
  .description("Read back and verify cues without writing.")
  .requiredOption("--setlist-id <id>")
  .option("--song-position <number>", "verify one setlist position", positiveInteger)
  .action(async (options: { setlistId: string; songPosition?: number }) => {
    const configStore = new ConfigurationStore();
    const configuration = await configStore.load();
    await withConnection(async (services) => {
      const startedAt = new Date().toISOString();
      const result = await verifyCuePlan(services, configuration, options.setlistId, options.songPosition ? [options.songPosition] : undefined);
      const directory = reportDirectory(configuration.reportDirectory);
      const files = await new Reporter(directory).write({ startedAt, finishedAt: new Date().toISOString(), command: "verify", serverOrigin: new URL(configuration.serverUrl).origin, organization: configuration.organization, setlist: result.plan.setlist, configuration: result.plan.configuration, plan: result.plan.items, finalStatus: result.summary.success ? "success" : "failed" });
      print(globals().json ? { ...result, reports: files } : `${renderPlan(result.plan)}\n\nVerification: ${JSON.stringify(result.summary)}\nReports: ${files.json}`, globals());
      if (!result.summary.success) process.exitCode = EXIT.VERIFICATION;
    });
  });

program.command("sync-next")
  .description("Find one unambiguous upcoming setlist; dry-run unless --apply is supplied.")
  .option("--apply", "apply after typed confirmation")
  .option("--yes", "skip typed confirmation with --apply")
  .action(async (options: { apply?: boolean; yes?: boolean }) => {
    const configStore = new ConfigurationStore();
    const configuration = await configStore.load();
    await withConnection(async (services) => {
      const from = new Date().toISOString().slice(0, 10);
      const until = new Date(Date.now() + configuration.defaultDateWindowDays * 86_400_000).toISOString().slice(0, 10);
      let candidates = await listSetlists(services, { from, to: until, limit: 100 });
      if (configuration.setlistNameFilter) candidates = candidates.filter((item) => item.name === configuration.setlistNameFilter);
      if (candidates.length !== 1) throw new StagePilotCuesError(`Expected exactly one upcoming setlist; found ${candidates.length}. Use an exact name filter or an explicit setlist ID.`, EXIT.AMBIGUOUS);
      const setlistId = candidates[0]!.id;
      if (!options.apply) {
        const startedAt = new Date().toISOString();
        const plan = await inspectSetlist(services, configuration, setlistId);
        const directory = reportDirectory(configuration.reportDirectory);
        const files = await new Reporter(directory).write({ startedAt, finishedAt: new Date().toISOString(), command: "prepare", serverOrigin: new URL(configuration.serverUrl).origin, organization: configuration.organization, setlist: plan.setlist, configuration: plan.configuration, plan: plan.items, finalStatus: "success" });
        print(globals().json ? { plan, reports: files } : `${renderPlan(plan)}\n\nReports: ${files.json}`, globals());
        return;
      }
      const plan = await inspectSetlist(services, configuration, setlistId);
      print(renderPlan(plan), globals());
      if (!options.yes && !(await confirmApply(setlistId))) throw new StagePilotCuesError("Apply cancelled; no remote writes occurred.", EXIT.INVALID);
      const result = await applyCuePlan(services, configuration, setlistId, reportDirectory(configuration.reportDirectory));
      print(result, globals());
      if (!result.success) process.exitCode = EXIT.PARTIAL_FAILURE;
    });
  });

async function runPlanCommand(command: "inspect" | "prepare", options: { setlistId: string; songPosition?: number }): Promise<void> {
  const configStore = new ConfigurationStore();
  const configuration = await configStore.load();
  await withConnection(async (services) => {
    const startedAt = new Date().toISOString();
    const plan = await inspectSetlist(services, configuration, options.setlistId, options.songPosition ? [options.songPosition] : undefined);
    const directory = reportDirectory(configuration.reportDirectory);
    const files = await new Reporter(directory).write({ startedAt, finishedAt: new Date().toISOString(), command, serverOrigin: new URL(configuration.serverUrl).origin, organization: configuration.organization, setlist: plan.setlist, configuration: plan.configuration, plan: plan.items, finalStatus: plan.items.some((item) => item.operations.includes("ERROR")) ? "failed" : "success" });
    print(globals().json ? { plan, reports: files } : `${renderPlan(plan)}\n\nReports: ${files.json}`, globals());
  });
}

program.exitOverride();
program.configureOutput({ writeErr: (text) => process.stderr.write(text) });

program.parseAsync(process.argv).catch((error: unknown) => {
  const commanderCode = (error as { code?: string }).code;
  if (commanderCode === "commander.helpDisplayed" || commanderCode === "commander.version") return;
  const message = sanitizedError(error);
  if (globals().json) process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  else process.stderr.write(`Error: ${message}\n`);
  process.exitCode = error instanceof StagePilotCuesError ? error.exitCode : EXIT.INVALID;
});
