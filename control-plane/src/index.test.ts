import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Registry } from './index';

class MemoryStorage {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put(keyOrEntries: string | Record<string, unknown>, value?: unknown): Promise<void> {
    if (typeof keyOrEntries === 'string') {
      this.values.set(keyOrEntries, structuredClone(value));
      return;
    }
    for (const [key, entry] of Object.entries(keyOrEntries)) {
      this.values.set(key, structuredClone(entry));
    }
  }
}

class FakeCloudflare {
  tunnels = new Map<string, Record<string, unknown>>();
  records = new Map<string, Record<string, unknown>>();
  configurations = new Map<string, unknown>();
  createCount = 0;
  dnsCreateCount = 0;
  failAfterNextCreate = false;

  fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
    const method = init?.method ?? 'GET';
    const payload = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    const parts = url.pathname.split('/');
    let result: unknown;

    if (url.pathname.endsWith('/cfd_tunnel')) {
      if (method === 'GET') {
        result = [...this.tunnels.values()].filter((tunnel) => tunnel.name === url.searchParams.get('name'));
      } else if (method === 'POST') {
        this.createCount += 1;
        const id = `00000000-0000-4000-8000-${String(this.createCount).padStart(12, '0')}`;
        this.tunnels.set(id, { id, ...payload, deleted_at: null });
        result = this.tunnels.get(id);
        if (this.failAfterNextCreate) {
          this.failAfterNextCreate = false;
          throw new TypeError('simulated lost response');
        }
      }
    } else if (url.pathname.includes('/dns_records')) {
      if (method === 'GET') {
        result = [...this.records.values()].filter((record) => record.name === url.searchParams.get('name'));
      } else if (method === 'POST') {
        this.dnsCreateCount += 1;
        const id = `dns-${this.dnsCreateCount}`;
        this.records.set(id, { id, ...payload });
        result = this.records.get(id);
      } else if (method === 'DELETE') {
        this.records.delete(parts.at(-1) ?? '');
        result = {};
      }
    } else if (url.pathname.endsWith('/configurations')) {
      const tunnelId = parts.at(-2) ?? '';
      if (method === 'PUT') this.configurations.set(tunnelId, payload);
      result = this.configurations.get(tunnelId);
    } else if (url.pathname.endsWith('/token')) {
      result = `installation-only-token-${parts.at(-2)}`;
    } else if (url.pathname.endsWith('/connections')) {
      result = {};
    } else if (method === 'DELETE' && url.pathname.includes('/cfd_tunnel/')) {
      this.tunnels.delete(parts.at(-1) ?? '');
      result = {};
    } else {
      throw new Error(`unexpected provider request: ${method} ${url.pathname}`);
    }
    return new Response(JSON.stringify({ success: true, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

const adminToken = 'admin-token-with-at-least-thirty-two-characters';
const env = {
  CLOUDFLARE_API_TOKEN: 'provider-secret-never-returned',
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  CLOUDFLARE_ZONE_ID: 'b'.repeat(32),
  REMOTE_HOST_SUFFIX: 'remote.example.com',
  ADMIN_API_TOKEN: adminToken,
  INSTALLATION_SIGNING_KEY: 'installation-signing-key-at-least-32-bytes',
  REMOTE_PORT: '18766',
};

function request(path: string, method = 'GET', token?: string, value?: unknown): Request {
  return new Request(`https://control.example.com${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(value ? { 'content-type': 'application/json' } : {}),
    },
    body: value ? JSON.stringify(value) : undefined,
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

async function enroll(registry: Registry, key: string): Promise<Record<string, unknown>> {
  const response = await registry.fetch(request('/v1/admin/installations', 'POST', adminToken, {
    idempotencyKey: key,
    label: key,
  }));
  expect(response.status).toBe(201);
  return json(response);
}

function installationPath(installation: Record<string, unknown>, action: string): string {
  return `/v1/installations/${String(installation.installationId)}/${action}`;
}

describe('private-beta control plane', () => {
  let storage: MemoryStorage;
  let provider: FakeCloudflare;
  let registry: Registry;

  beforeEach(() => {
    storage = new MemoryStorage();
    provider = new FakeCloudflare();
    vi.stubGlobal('fetch', provider.fetch);
    registry = new Registry({ storage } as unknown as DurableObjectState, env as never);
  });

  it('rejects arbitrary Internet clients before allocating state or provider resources', async () => {
    const response = await registry.fetch(request('/v1/admin/installations', 'POST', undefined, {
      idempotencyKey: 'unauthorized-request',
    }));
    expect(response.status).toBe(401);
    expect(storage.values.size).toBe(0);
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it('fails closed when any required Worker runtime secret is missing', async () => {
    for (const name of ['CLOUDFLARE_API_TOKEN', 'ADMIN_API_TOKEN', 'INSTALLATION_SIGNING_KEY'] as const) {
      registry = new Registry(
        { storage } as unknown as DurableObjectState,
        { ...env, [name]: undefined } as never,
      );
      const response = await registry.fetch(request('/v1/admin/installations', 'POST', adminToken, {
        idempotencyKey: 'missing-secret-test',
      }));
      expect(response.status).toBe(503);
      expect(await json(response)).toEqual({ error: 'operation incomplete; retry reconciliation' });
    }
    expect(storage.values.size).toBe(0);
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it('enrolls durable random identities idempotently and issues isolated credentials', async () => {
    const first = await enroll(registry, 'friend-one-request');
    const replay = await enroll(registry, 'friend-one-request');
    const second = await enroll(registry, 'friend-two-request');

    expect(replay).toEqual(first);
    expect(second.installationId).not.toBe(first.installationId);
    expect(second.hostname).not.toBe(first.hostname);
    expect(second.installationCredential).not.toBe(first.installationCredential);
    expect(String(first.hostname)).toBe(`sp-${String(first.installationId)}.remote.example.com`);
    expect(JSON.stringify([...storage.values.values()])).not.toContain('provider-secret-never-returned');
  });

  it('keeps two provisioned installations isolated across credentials, routes, and lifecycle', async () => {
    const first = await enroll(registry, 'friend-one-request');
    const second = await enroll(registry, 'friend-two-request');
    const firstGeneration = '11111111-1111-4111-8111-111111111111';
    const secondGeneration = '22222222-2222-4222-8222-222222222222';

    const crossUse = await registry.fetch(request(
      installationPath(first, 'status'),
      'GET',
      String(second.installationCredential),
    ));
    expect(crossUse.status).toBe(401);

    const firstProvision = await registry.fetch(request(
      installationPath(first, 'provision'),
      'POST',
      String(first.installationCredential),
      { generation: firstGeneration },
    ));
    const secondProvision = await registry.fetch(request(
      installationPath(second, 'provision'),
      'POST',
      String(second.installationCredential),
      { generation: secondGeneration },
    ));
    expect(firstProvision.status).toBe(200);
    expect(secondProvision.status).toBe(200);
    expect(provider.tunnels.size).toBe(2);
    expect(provider.records.size).toBe(2);

    const replay = await registry.fetch(request(
      installationPath(first, 'provision'),
      'POST',
      String(first.installationCredential),
      { generation: firstGeneration },
    ));
    expect(replay.status).toBe(200);
    expect(provider.createCount).toBe(2);
    expect(provider.dnsCreateCount).toBe(2);

    const disable = await registry.fetch(request(
      installationPath(first, 'disable'),
      'POST',
      String(first.installationCredential),
    ));
    expect(disable.status).toBe(200);
    expect(provider.tunnels.size).toBe(1);
    expect(provider.records.size).toBe(1);
    expect([...provider.records.values()][0]?.name).toBe(second.hostname);

    const secondStatus = await registry.fetch(request(
      installationPath(second, 'status'),
      'GET',
      String(second.installationCredential),
    ));
    expect(secondStatus.status).toBe(200);
    expect((await json(secondStatus)).phase).toBe('provisioned');

    const revoke = await registry.fetch(request(
      `/v1/admin/installations/${String(first.installationId)}/revoke`,
      'POST',
      adminToken,
    ));
    expect(revoke.status).toBe(200);
    const revokedCredential = await registry.fetch(request(
      installationPath(first, 'status'),
      'GET',
      String(first.installationCredential),
    ));
    expect(revokedCredential.status).toBe(401);
    expect(provider.tunnels.size).toBe(1);
  });

  it('recovers after a lost create response and Durable Object restart without duplication', async () => {
    const installation = await enroll(registry, 'restart-proof-request');
    provider.failAfterNextCreate = true;
    const generation = '33333333-3333-4333-8333-333333333333';
    const failed = await registry.fetch(request(
      installationPath(installation, 'provision'),
      'POST',
      String(installation.installationCredential),
      { generation },
    ));
    expect(failed.status).toBe(503);
    expect(provider.tunnels.size).toBe(1);

    registry = new Registry({ storage } as unknown as DurableObjectState, env as never);
    const recovered = await registry.fetch(request(
      installationPath(installation, 'reconcile'),
      'POST',
      String(installation.installationCredential),
    ));
    expect(recovered.status).toBe(200);
    expect((await json(recovered)).phase).toBe('provisioned');
    expect(provider.createCount).toBe(1);
    expect(provider.dnsCreateCount).toBe(1);
  });

  it('fails closed on foreign DNS ownership and never adopts the route', async () => {
    const installation = await enroll(registry, 'ownership-proof-request');
    provider.records.set('foreign', {
      id: 'foreign',
      name: installation.hostname,
      type: 'CNAME',
      content: 'foreign.cfargotunnel.com',
      proxied: true,
      comment: 'not-stagepilot-owned',
    });
    const response = await registry.fetch(request(
      installationPath(installation, 'provision'),
      'POST',
      String(installation.installationCredential),
      { generation: '44444444-4444-4444-8444-444444444444' },
    ));
    expect(response.status).toBe(503);
    expect(provider.createCount).toBe(0);
    expect(provider.records.size).toBe(1);
    expect((await json(response)).error).not.toContain('foreign.cfargotunnel.com');
  });
});
