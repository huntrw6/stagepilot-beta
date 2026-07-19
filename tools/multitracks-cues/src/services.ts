import { writeFile } from "node:fs/promises";
import { CredentialVault } from "./auth/credential-store.js";
import { AuthenticationService } from "./auth/service.js";
import { TokenStore } from "./auth/token-store.js";
import type { Configuration } from "./config/schema.js";
import { ConfigurationStore } from "./config/store.js";
import { CueApplier } from "./cues/applier.js";
import { CuePlanner } from "./cues/planner.js";
import { verifyCuePlan as verifyWithPlanner } from "./cues/verifier.js";
import { SafeMcpClient } from "./mcp/client.js";
import { SdkToolTransport } from "./mcp/sdk-transport.js";
import { MultiTracksGateway } from "./multitracks/gateway.js";

export interface ConnectedServices {
  client: SafeMcpClient;
  gateway: MultiTracksGateway;
  planner: CuePlanner;
  applier: CueApplier;
  close(): Promise<void>;
}

export interface ServiceDependencies {
  configStore?: ConfigurationStore;
  credentialVault?: CredentialVault;
  fetchFn?: typeof fetch;
}

export function createAuthentication(dependencies: ServiceDependencies = {}): {
  configStore: ConfigurationStore;
  auth: AuthenticationService;
  vault: CredentialVault;
} {
  const configStore = dependencies.configStore ?? new ConfigurationStore();
  const vault = dependencies.credentialVault ?? new CredentialVault();
  return { configStore, vault, auth: new AuthenticationService(configStore, new TokenStore(vault)) };
}

export async function connect(dependencies: ServiceDependencies = {}): Promise<ConnectedServices> {
  const { configStore, auth } = createAuthentication(dependencies);
  const configuration = await configStore.load();
  const tokens = await auth.tokens(configuration, dependencies.fetchFn ?? fetch);
  const client = new SafeMcpClient(new SdkToolTransport(configuration.serverUrl, tokens, dependencies.fetchFn ?? fetch));
  await client.connect();
  const gateway = new MultiTracksGateway(client);
  const planner = new CuePlanner(gateway);
  return {
    client,
    gateway,
    planner,
    applier: new CueApplier(gateway, planner),
    close: () => client.close(),
  };
}

export async function authenticate(dependencies: ServiceDependencies = {}): Promise<ReturnType<AuthenticationService["login"]>> {
  const { configStore, auth } = createAuthentication(dependencies);
  return auth.login(await configStore.load(), { fetchFn: dependencies.fetchFn });
}

export async function listTools(services: ConnectedServices): Promise<ReturnType<SafeMcpClient["listTools"]>> {
  return services.client.listTools();
}

export async function saveSanitizedToolSchemas(services: ConnectedServices, filePath: string): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(services.client.sanitizedSchemas(), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function listSetlists(services: ConnectedServices, filters?: Parameters<MultiTracksGateway["listSetlists"]>[0]): Promise<Awaited<ReturnType<MultiTracksGateway["listSetlists"]>>> {
  return services.gateway.listSetlists(filters);
}

export async function getSetlist(services: ConnectedServices, id: string): Promise<Awaited<ReturnType<MultiTracksGateway["getSetlist"]>>> {
  return services.gateway.getSetlist(id);
}

export async function listMidiBuses(services: ConnectedServices): Promise<Awaited<ReturnType<MultiTracksGateway["listMidiBuses"]>>> {
  return services.gateway.listMidiBuses();
}

export async function inspectSetlist(services: ConnectedServices, configuration: Configuration, setlistId: string, positions?: number[]): Promise<Awaited<ReturnType<CuePlanner["buildCuePlan"]>>> {
  return services.planner.buildCuePlan(configuration, setlistId, positions);
}

export const buildCuePlan = inspectSetlist;

export async function applyCuePlan(services: ConnectedServices, configuration: Configuration, setlistId: string, reportDirectory: string, positions?: number[]): Promise<Awaited<ReturnType<CueApplier["applyCuePlan"]>>> {
  return services.applier.applyCuePlan(configuration, setlistId, reportDirectory, positions);
}

export async function verifyCuePlan(services: ConnectedServices, configuration: Configuration, setlistId: string, positions?: number[]): Promise<Awaited<ReturnType<typeof verifyWithPlanner>>> {
  return verifyWithPlanner(services.planner, configuration, setlistId, positions);
}
