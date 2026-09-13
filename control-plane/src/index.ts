interface Env {
  REGISTRY: DurableObjectNamespace;
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_ZONE_ID: string;
  REMOTE_HOST_SUFFIX: string;
  ADMIN_API_TOKEN: string;
  INSTALLATION_SIGNING_KEY: string;
  REMOTE_PORT?: string;
}

type Phase = 'disabled' | 'enabling' | 'provisioned' | 'revoking';

interface Installation {
  id: string;
  hostname: string;
  label: string;
  phase: Phase;
  desiredEnabled: boolean;
  generation?: string;
  lastGeneration?: string;
  tunnelId?: string;
  revoked: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CloudflareEnvelope<T> {
  success: boolean;
  result: T;
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};
const ID = /^[a-f0-9]{32}$/;
const GENERATION = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function randomHex(bytes: number): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(value, (part) => part.toString(16).padStart(2, '0')).join('');
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function equalSecret(actual: string, expected: string): Promise<boolean> {
  const [left, right] = await Promise.all([digest(actual), digest(expected)]);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function bearer(request: Request): string {
  const value = request.headers.get('authorization') ?? '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > 4096) throw new Error('invalid request');
  const text = await request.text();
  if (text.length > 4096) throw new Error('invalid request');
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid request');
  return value as Record<string, unknown>;
}

function publicInstallation(installation: Installation): Record<string, unknown> {
  return {
    installationId: installation.id,
    hostname: installation.hostname,
    phase: installation.phase,
    generation: installation.generation ?? null,
    revoked: installation.revoked,
    createdAt: installation.createdAt,
    updatedAt: installation.updatedAt,
  };
}

export class Registry {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    try {
      this.validateConfiguration();
      const url = new URL(request.url);
      if (request.method === 'POST' && url.pathname === '/v1/admin/installations') {
        if (!(await this.isAdmin(request))) return reply({ error: 'unauthorized' }, 401);
        return await this.enroll(request);
      }
      const adminRevoke = url.pathname.match(/^\/v1\/admin\/installations\/([a-f0-9]{32})\/revoke$/);
      if (request.method === 'POST' && adminRevoke) {
        if (!(await this.isAdmin(request))) return reply({ error: 'unauthorized' }, 401);
        return await this.adminRevoke(adminRevoke[1]);
      }
      const route = url.pathname.match(/^\/v1\/installations\/([a-f0-9]{32})\/(status|provision|disable|reconcile)$/);
      if (!route) return reply({ error: 'not found' }, 404);
      const installation = await this.state.storage.get<Installation>(`installation:${route[1]}`);
      if (!installation || installation.revoked || !(await this.isInstallation(request, installation))) {
        return reply({ error: 'unauthorized' }, 401);
      }
      const action = route[2];
      if (action === 'status' && request.method === 'GET') return reply(publicInstallation(installation));
      if (request.method !== 'POST') return reply({ error: 'method not allowed' }, 405);
      if (action === 'provision') return await this.provision(request, installation);
      if (action === 'disable') return await this.disable(installation, false);
      if (action === 'reconcile') return await this.reconcile(installation);
      return reply({ error: 'method not allowed' }, 405);
    } catch (error) {
      // Internal messages are deliberately generic and never include provider
      // response bodies, request headers, or credential values.
      const message = error instanceof Error ? error.message : 'unknown';
      console.error('control-plane request failed', message);
      const response: Record<string, string> = { error: 'operation incomplete; retry reconciliation' };
      const safeDiagnostics = new Set([
        'missing generation',
        'hostname ownership conflict',
        'tunnel creation not confirmed',
        'hostname route not confirmed',
        'installation credential unavailable',
        'hostname removal not confirmed',
        'tunnel revocation not confirmed',
        'ambiguous tunnel ownership',
        'invalid tunnel ownership',
        'ambiguous hostname ownership',
        'tunnel configuration not confirmed',
      ]);
      if (message.startsWith('provider ') || safeDiagnostics.has(message)) {
        response.diagnostic = message;
      }
      return reply(response, 503);
    }
  }

  private validateConfiguration(): void {
    if (!ID.test(this.env.CLOUDFLARE_ACCOUNT_ID) || !ID.test(this.env.CLOUDFLARE_ZONE_ID)) {
      throw new Error('invalid provider configuration');
    }
    if (typeof this.env.CLOUDFLARE_API_TOKEN !== 'string' || this.env.CLOUDFLARE_API_TOKEN.length < 20
      || typeof this.env.ADMIN_API_TOKEN !== 'string' || this.env.ADMIN_API_TOKEN.length < 32
      || typeof this.env.INSTALLATION_SIGNING_KEY !== 'string' || this.env.INSTALLATION_SIGNING_KEY.length < 32
      || this.env.ADMIN_API_TOKEN === this.env.INSTALLATION_SIGNING_KEY) {
      throw new Error('invalid authentication configuration');
    }
    const suffix = this.env.REMOTE_HOST_SUFFIX.toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9.-]{1,251}[a-z0-9])$/.test(suffix) || suffix.includes('..')) {
      throw new Error('invalid hostname suffix');
    }
    this.remotePort();
  }

  private async isAdmin(request: Request): Promise<boolean> {
    const token = bearer(request);
    return token.length >= 32 && equalSecret(token, this.env.ADMIN_API_TOKEN);
  }


  private async credential(id: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.env.INSTALLATION_SIGNING_KEY),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`stagepilot-installation:${id}`)),
    );
    return `spi_${id}.${encodeBase64Url(signature)}`;
  }

  private async isInstallation(request: Request, installation: Installation): Promise<boolean> {
    const token = bearer(request);
    if (!token.startsWith(`spi_${installation.id}.`)) return false;
    return equalSecret(token, await this.credential(installation.id));
  }

  private async enroll(request: Request): Promise<Response> {
    const input = await body(request);
    const idempotencyKey = input.idempotencyKey;
    const label = input.label ?? '';
    if (!IDEMPOTENCY_KEY.test(String(idempotencyKey)) || typeof label !== 'string' || label.length > 100) {
      return reply({ error: 'invalid request' }, 400);
    }
    const requestKey = `enrollment:${String(idempotencyKey)}`;
    let id = await this.state.storage.get<string>(requestKey);
    let installation = id
      ? await this.state.storage.get<Installation>(`installation:${id}`)
      : undefined;
    if (!installation) {
      id = randomHex(16);
      const now = new Date().toISOString();
      installation = {
        id,
        hostname: `sp-${id}.${this.env.REMOTE_HOST_SUFFIX.toLowerCase()}`,
        label,
        phase: 'disabled',
        desiredEnabled: false,
        revoked: false,
        createdAt: now,
        updatedAt: now,
      };
      await this.state.storage.put({
        [requestKey]: id,
        [`installation:${id}`]: installation,
      });
    }
    return reply({
      ...publicInstallation(installation),
      installationCredential: await this.credential(installation.id),
    }, 201);
  }

  private async provision(request: Request, installation: Installation): Promise<Response> {
    const input = await body(request);
    const generation = input.generation;
    if (typeof generation !== 'string' || !GENERATION.test(generation)) {
      return reply({ error: 'invalid generation' }, 400);
    }
    if (installation.phase === 'revoking') return reply({ error: 'disable must finish first' }, 409);
    if (installation.generation && installation.generation !== generation) {
      return reply({ error: 'generation conflict' }, 409);
    }
    if (!installation.generation && installation.lastGeneration === generation) {
      return reply({ error: 'a new generation is required' }, 409);
    }
    installation.generation = generation;
    installation.desiredEnabled = true;
    installation.phase = 'enabling';
    installation.updatedAt = new Date().toISOString();
    await this.save(installation);
    return this.ensureProvisioned(installation);
  }

  private async reconcile(installation: Installation): Promise<Response> {
    if (installation.desiredEnabled && installation.generation) {
      return this.ensureProvisioned(installation);
    }
    if (installation.phase === 'disabled') return reply(publicInstallation(installation));
    return this.disable(installation, false);
  }

  private async ensureProvisioned(installation: Installation): Promise<Response> {
    const generation = installation.generation;
    if (!generation) throw new Error('missing generation');
    const name = this.tunnelName(installation, generation);
    let tunnel = await this.tunnel(name);
    let record = await this.dns(installation.hostname);
    if (record && (!tunnel || !this.owned(record, name, installation.hostname, tunnel.id))) {
      throw new Error('hostname ownership conflict');
    }
    if (!tunnel) {
      await this.cf('POST', this.tunnelsPath(), { name, config_src: 'cloudflare' });
      tunnel = await this.tunnel(name);
      if (!tunnel) throw new Error('tunnel creation not confirmed');
    }
    await this.configure(tunnel.id, installation.hostname);
    if (!record) {
      await this.cf('POST', this.recordsPath(), {
        type: 'CNAME',
        name: installation.hostname,
        content: `${tunnel.id}.cfargotunnel.com`,
        proxied: true,
        ttl: 1,
        comment: name,
      });
      record = await this.dns(installation.hostname);
    }
    if (!record || !this.owned(record, name, installation.hostname, tunnel.id)) {
      throw new Error('hostname route not confirmed');
    }
    const token = await this.cf<unknown>('GET', `${this.tunnelsPath()}/${tunnel.id}/token`);
    if (typeof token !== 'string' || token.length < 20 || /\s/.test(token)) {
      throw new Error('installation credential unavailable');
    }
    installation.tunnelId = tunnel.id;
    installation.phase = 'provisioned';
    installation.updatedAt = new Date().toISOString();
    await this.save(installation);
    return reply({
      ...publicInstallation(installation),
      tunnelId: tunnel.id,
      tunnelToken: token,
    });
  }

  private async disable(installation: Installation, revoke: boolean): Promise<Response> {
    installation.desiredEnabled = false;
    installation.phase = 'revoking';
    installation.revoked ||= revoke;
    installation.updatedAt = new Date().toISOString();
    await this.save(installation);
    const generation = installation.generation;
    if (generation) {
      const name = this.tunnelName(installation, generation);
      const tunnel = await this.tunnel(name);
      const tunnelId = tunnel?.id ?? installation.tunnelId;
      const record = await this.dns(installation.hostname);
      if (record) {
        if (!tunnelId || !this.owned(record, name, installation.hostname, tunnelId)) {
          throw new Error('hostname ownership conflict');
        }
        await this.cf('DELETE', `${this.recordsPath()}/${String(record.id)}`);
        if (await this.dns(installation.hostname)) throw new Error('hostname removal not confirmed');
      }
      if (tunnel) {
        await this.configure(tunnel.id);
        await this.cf('DELETE', `${this.tunnelsPath()}/${tunnel.id}/connections`);
        await this.cf('DELETE', `${this.tunnelsPath()}/${tunnel.id}`);
        if (await this.tunnel(name)) throw new Error('tunnel revocation not confirmed');
      }
    }
    installation.phase = 'disabled';
    installation.lastGeneration = installation.generation;
    delete installation.generation;
    delete installation.tunnelId;
    installation.updatedAt = new Date().toISOString();
    await this.save(installation);
    return reply(publicInstallation(installation));
  }

  private async adminRevoke(id: string): Promise<Response> {
    const installation = await this.state.storage.get<Installation>(`installation:${id}`);
    if (!installation) return reply({ error: 'not found' }, 404);
    if (installation.revoked && installation.phase === 'disabled') {
      return reply(publicInstallation(installation));
    }
    return this.disable(installation, true);
  }

  private async save(installation: Installation): Promise<void> {
    await this.state.storage.put(`installation:${installation.id}`, installation);
  }

  private tunnelName(installation: Installation, generation: string): string {
    return `stagepilot-${installation.id}-${generation}`;
  }

  private tunnelsPath(): string {
    return `/accounts/${this.env.CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel`;
  }

  private recordsPath(): string {
    return `/zones/${this.env.CLOUDFLARE_ZONE_ID}/dns_records`;
  }

  private async cf<T>(method: string, path: string, requestBody?: unknown): Promise<T> {
    const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.env.CLOUDFLARE_API_TOKEN}`,
        'content-type': 'application/json',
      },
      body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
    });
    const operation = path.includes('/dns_records')
      ? 'DNS'
      : path.endsWith('/token')
        ? 'tunnel-token'
        : path.endsWith('/configurations')
          ? 'tunnel-configuration'
          : 'tunnel-lifecycle';
    if (!response.ok) throw new Error(`provider ${operation} request failed (HTTP ${response.status})`);
    const envelope = (await response.json()) as CloudflareEnvelope<T>;
    if (envelope.success !== true || !('result' in envelope)) {
      throw new Error(`provider rejected ${operation} request`);
    }
    return envelope.result;
  }

  private async tunnel(name: string): Promise<{ id: string; name: string; config_src: string } | undefined> {
    const query = new URLSearchParams({ name, is_deleted: 'false' });
    const rows = await this.cf<Array<{ id: string; name: string; config_src: string; deleted_at?: string }>>(
      'GET', `${this.tunnelsPath()}?${query}`,
    );
    const matches = rows.filter((row) => row.name === name && !row.deleted_at);
    if (matches.length > 1) throw new Error('ambiguous tunnel ownership');
    if (matches[0] && (matches[0].config_src !== 'cloudflare' || !/^[0-9a-f-]{36}$/i.test(matches[0].id))) {
      throw new Error('invalid tunnel ownership');
    }
    return matches[0];
  }

  private async dns(hostname: string): Promise<Record<string, unknown> | undefined> {
    const query = new URLSearchParams({ name: hostname });
    const rows = await this.cf<Array<Record<string, unknown>>>('GET', `${this.recordsPath()}?${query}`);
    const matches = rows.filter((row) => row.name === hostname);
    if (matches.length > 1) throw new Error('ambiguous hostname ownership');
    return matches[0];
  }

  private owned(record: Record<string, unknown>, name: string, hostname: string, tunnelId: string): boolean {
    return record.comment === name && record.name === hostname && record.type === 'CNAME'
      && record.content === `${tunnelId}.cfargotunnel.com` && record.proxied === true;
  }

  private async configure(tunnelId: string, hostname?: string): Promise<void> {
    const ingress = hostname
      ? [
          { hostname, service: `http://127.0.0.1:${this.remotePort()}` },
          { service: 'http_status:404' },
        ]
      : [{ service: 'http_status:404' }];
    const path = `${this.tunnelsPath()}/${tunnelId}/configurations`;
    const config = { ingress, 'warp-routing': { enabled: false } };
    await this.cf('PUT', path, { config });
    const actual = await this.cf<{ config?: { ingress?: unknown; 'warp-routing'?: { enabled?: unknown } } }>('GET', path);
    if (JSON.stringify(actual.config?.ingress) !== JSON.stringify(ingress)
      || actual.config?.['warp-routing']?.enabled !== false) {
      throw new Error('tunnel configuration not confirmed');
    }
  }

  private remotePort(): number {
    const value = Number(this.env.REMOTE_PORT ?? '8766');
    if (!Number.isInteger(value) || value < 1024 || value > 65535 || value === 8765) {
      throw new Error('invalid remote port');
    }
    return value;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') return reply({ status: 'ok' });
    const id = env.REGISTRY.idFromName('stagepilot-private-beta-v1');
    return env.REGISTRY.get(id).fetch(request);
  },
};
