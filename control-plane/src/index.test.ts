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

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
    return new Map(
      [...this.values.entries()]
        .filter(([key]) => !options?.prefix || key.startsWith(options.prefix))
        .map(([key, value]) => [key, structuredClone(value) as T]),
    );
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
      if (method === 'PUT') {
        const config = payload?.config as {
          ingress: Array<{ hostname?: string; service: string }>;
          'warp-routing': { enabled: boolean };
        };
        this.configurations.set(tunnelId, {
          config: {
            // Cloudflare's real read-back orders object keys differently from
            // the submitted JSON. Semantic equality must not depend on key order.
            ingress: config.ingress.map((row) => row.hostname
              ? { service: row.service, hostname: row.hostname }
              : { service: row.service }),
            'warp-routing': config['warp-routing'],
          },
        });
      }
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
  ENROLLMENT_ENABLED: 'true',
  BETA_INSTALLATION_LIMIT: '500',
};

function request(path: string, method = 'GET', token?: string, value?: unknown, source = '203.0.113.10'): Request {
  return new Request(`https://control.example.com${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(value ? { 'content-type': 'application/json' } : {}),
      'cf-connecting-ip': source,
    },
    body: value ? JSON.stringify(value) : undefined,
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

async function enroll(registry: Registry, key: string): Promise<Record<string, unknown>> {
  const response = await registry.fetch(request('/v1/installations/enroll', 'POST', undefined, {
    nonce: key,
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

  it('rejects malformed enrollment before allocating installation or provider resources', async () => {
    const response = await registry.fetch(request('/v1/installations/enroll', 'POST', undefined, {
      unexpected: 'unauthorized-request',
    }));
    expect(response.status).toBe(400);
    expect(storage.values.size).toBe(0);
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it('fails closed when any required Worker runtime secret is missing', async () => {
    for (const name of ['CLOUDFLARE_API_TOKEN', 'ADMIN_API_TOKEN', 'INSTALLATION_SIGNING_KEY'] as const) {
      registry = new Registry(
        { storage } as unknown as DurableObjectState,
        { ...env, [name]: undefined } as never,
      );
      const response = await registry.fetch(request('/v1/installations/enroll', 'POST', undefined, {
        nonce: 'missing-secret-test',
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

  it('enforces normalized-source enrollment quota while replay and another source remain available', async () => {
    const ipv6 = '2001:0db8:0001:0002:0000:0000:0000:0001';
    const compactSamePrefix = '2001:db8:1:2::abcd';
    const accepted: Record<string, unknown>[] = [];
    for (const nonce of ['source-one-0001', 'source-one-0002', 'source-one-0003']) {
      const response = await registry.fetch(request('/v1/installations/enroll', 'POST', undefined, { nonce }, ipv6));
      expect(response.status).toBe(201);
      accepted.push(await json(response));
    }
    const before = [...storage.values.keys()].filter((key) => key.startsWith('installation:')).length;
    const denied = await registry.fetch(request(
      '/v1/installations/enroll', 'POST', undefined, { nonce: 'source-one-0004' }, compactSamePrefix,
    ));
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get('retry-after'))).toBeGreaterThan(0);
    expect([...storage.values.keys()].filter((key) => key.startsWith('installation:'))).toHaveLength(before);
    const replay = await registry.fetch(request(
      '/v1/installations/enroll', 'POST', undefined, { nonce: 'source-one-0001' }, compactSamePrefix,
    ));
    expect(await json(replay)).toEqual(accepted[0]);
    const other = await registry.fetch(request(
      '/v1/installations/enroll', 'POST', undefined, { nonce: 'source-two-0001' }, '2001:db8:1:3::1',
    ));
    expect(other.status).toBe(201);
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it('enforces the installation ceiling and kill switch without creating installations', async () => {
    registry = new Registry({ storage } as unknown as DurableObjectState, { ...env, BETA_INSTALLATION_LIMIT: '1' } as never);
    await enroll(registry, 'ceiling-first-request');
    const denied = await registry.fetch(request(
      '/v1/installations/enroll', 'POST', undefined, { nonce: 'ceiling-second-request' }, '198.51.100.2',
    ));
    expect(denied.status).toBe(503);
    expect([...storage.values.keys()].filter((key) => key.startsWith('installation:'))).toHaveLength(1);

    const disabledStorage = new MemoryStorage();
    registry = new Registry(
      { storage: disabledStorage } as unknown as DurableObjectState,
      { ...env, ENROLLMENT_ENABLED: 'false' } as never,
    );
    const switchedOff = await registry.fetch(request(
      '/v1/installations/enroll', 'POST', undefined, { nonce: 'kill-switch-request' },
    ));
    expect(switchedOff.status).toBe(503);
    expect([...disabledStorage.values.keys()].some((key) => key.startsWith('installation:'))).toBe(false);
  });

  it('uses distinct status and mutation quotas and exposes only aggregate counters', async () => {
    const installation = await enroll(registry, 'rate-limits-request');
    for (let index = 0; index < 120; index += 1) {
      const response = await registry.fetch(request(
        installationPath(installation, 'status'), 'GET', String(installation.installationCredential),
      ));
      expect(response.status).toBe(200);
    }
    const statusDenied = await registry.fetch(request(
      installationPath(installation, 'status'), 'GET', String(installation.installationCredential),
    ));
    expect(statusDenied.status).toBe(429);

    const generation = '55555555-5555-4555-8555-555555555555';
    for (let index = 0; index < 20; index += 1) {
      const response = await registry.fetch(request(
        installationPath(installation, 'provision'), 'POST', String(installation.installationCredential), { generation },
      ));
      expect(response.status).toBe(200);
    }
    const mutationDenied = await registry.fetch(request(
      installationPath(installation, 'provision'), 'POST', String(installation.installationCredential), { generation },
    ));
    expect(mutationDenied.status).toBe(429);
    expect(provider.createCount).toBe(1);
    expect(provider.dnsCreateCount).toBe(1);

    const metrics = await registry.fetch(request('/v1/admin/metrics', 'GET', adminToken));
    expect(metrics.status).toBe(200);
    const aggregate = await json(metrics);
    expect(aggregate.statusDenied).toBe(1);
    expect(aggregate.mutationDenied).toBe(1);
    expect(JSON.stringify(aggregate)).not.toContain('203.0.113.10');
  });

  it('reserves provider capacity for revoke and recovery operations', async () => {
    const installation = await enroll(registry, 'provider-budget-request');
    storage.values.set('provider:budget', { startedAt: Math.floor(Date.now() / 1000), count: 480 });
    const generation = '66666666-6666-4666-8666-666666666666';
    const provision = await registry.fetch(request(
      installationPath(installation, 'provision'), 'POST', String(installation.installationCredential), { generation },
    ));
    expect(provision.status).toBe(503);
    expect(provider.fetch).not.toHaveBeenCalled();
    const revoke = await registry.fetch(request(
      installationPath(installation, 'revoke'), 'POST', String(installation.installationCredential), {},
    ));
    expect(revoke.status).toBe(200);
    expect((await json(revoke)).revoked).toBe(true);
  });

  it('does not let enabled reconcile consume reserved revoke capacity', async () => {
    const installation = await enroll(registry, 'reconcile-budget-request');
    const generation = '77777777-7777-4777-8777-777777777777';
    expect((await registry.fetch(request(
      installationPath(installation, 'provision'), 'POST', String(installation.installationCredential), { generation },
    ))).status).toBe(200);
    storage.values.set('provider:budget', { startedAt: Math.floor(Date.now() / 1000), count: 480 });
    registry = new Registry({ storage } as unknown as DurableObjectState, env as never);
    const callsBefore = provider.fetch.mock.calls.length;

    const reconcile = await registry.fetch(request(
      installationPath(installation, 'reconcile'), 'POST', String(installation.installationCredential),
    ));
    expect(reconcile.status).toBe(503);
    expect(provider.fetch).toHaveBeenCalledTimes(callsBefore);

    const revoke = await registry.fetch(request(
      installationPath(installation, 'revoke'), 'POST', String(installation.installationCredential),
    ));
    expect(revoke.status).toBe(200);
  });

  it('does not log a non-JSON provider response body', async () => {
    const installation = await enroll(registry, 'provider-body-request');
    const providerBody = 'PRIVATE_PROVIDER_BODY';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(providerBody, { status: 200 })));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await registry.fetch(request(
      installationPath(installation, 'provision'),
      'POST',
      String(installation.installationCredential),
      { generation: '88888888-8888-4888-8888-888888888888' },
    ));

    expect(response.status).toBe(503);
    expect(JSON.stringify(await json(response))).not.toContain(providerBody);
    expect(JSON.stringify(error.mock.calls)).not.toContain(providerBody);
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
