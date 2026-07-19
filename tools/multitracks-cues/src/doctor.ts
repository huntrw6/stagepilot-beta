import { ALLOWED_WRITE_TOOLS, REQUIRED_READ_TOOLS } from "./constants.js";
import type { ServiceDependencies } from "./services.js";
import { connect, createAuthentication } from "./services.js";

export interface DoctorCheck {
  name: string;
  status: "ok" | "warning" | "error" | "skipped";
  message: string;
}

export async function runDoctor(dependencies: ServiceDependencies = {}): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "Node.js", status: major >= 22 && major < 25 ? "ok" : "error", message: `Node ${process.versions.node}; supported range is 22–24.` });
  const { configStore, auth, vault } = createAuthentication(dependencies);
  const configuration = await configStore.load();
  const availability = await vault.availability();
  checks.push({ name: "Credential store", status: availability.available ? "ok" : "error", message: availability.available ? `Secure backend: ${availability.backend}.` : availability.error ?? "Unavailable." });
  try {
    const response = await (dependencies.fetchFn ?? fetch)(configuration.serverUrl, { method: "GET" });
    checks.push({ name: "MCP endpoint", status: response.status === 401 || response.ok ? "ok" : "error", message: `Reachable; HTTP ${response.status}.` });
  } catch (error) {
    checks.push({ name: "MCP endpoint", status: "error", message: error instanceof Error ? error.message : String(error) });
  }
  let status: Awaited<ReturnType<typeof auth.status>>;
  try {
    status = await auth.status(configuration);
    const message = status.registrationMode === "missing"
      ? "MultiTracks does not advertise dynamic registration. Request a standalone client ID and set MULTITRACKS_MCP_CLIENT_ID."
      : status.authenticated ? `Authenticated; token expires ${status.expiresAt ?? "at an unspecified time"}.` : "Not authenticated; run auth login.";
    checks.push({ name: "OAuth", status: status.authenticated ? "ok" : "error", message });
  } catch (error) {
    checks.push({ name: "OAuth", status: "error", message: error instanceof Error ? error.message : String(error) });
    return checks;
  }
  if (!status.authenticated) {
    checks.push({ name: "MCP tools", status: "skipped", message: "Authentication is required before tools/list." });
    checks.push({ name: "MIDI buses", status: "skipped", message: "Authentication is required before bus discovery." });
    return checks;
  }
  let services: Awaited<ReturnType<typeof connect>> | undefined;
  try {
    services = await connect(dependencies);
    const capabilities = services.client.validateCapabilities();
    checks.push({ name: "MCP tools", status: capabilities.missing.length ? "error" : "ok", message: capabilities.missing.length ? `Missing: ${capabilities.missing.join(", ")}.` : `All ${REQUIRED_READ_TOOLS.length + ALLOWED_WRITE_TOOLS.length} required read/write capabilities are present (writes were not called).` });
    const buses = await services.gateway.listMidiBuses();
    checks.push({ name: "MIDI buses", status: buses.length ? "ok" : "warning", message: buses.length ? buses.map((bus) => `${bus.name ?? bus.id} [${bus.id}]`).join(", ") : "No MIDI buses returned." });
  } catch (error) {
    checks.push({ name: "MCP tools", status: "error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    await services?.close();
  }
  return checks;
}
