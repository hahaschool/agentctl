// ---------------------------------------------------------------------------
// Tests for sync-discover.ts — roadmap §33.7.
// ---------------------------------------------------------------------------

import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseTailscaleStatus, syncDiscoverRoutes } from './sync-discover.js';

type BuildOpts = {
  fetchImpl?: typeof fetch;
  runTailscaleStatus?: () => Promise<string | null>;
};

async function buildApp(opts: BuildOpts = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(syncDiscoverRoutes, {
    prefix: '/api/sync',
    fetchImpl: opts.fetchImpl,
    runTailscaleStatus: opts.runTailscaleStatus,
  });
  await app.ready();
  return app;
}

describe('parseTailscaleStatus', () => {
  it('extracts peers with IPv4 tailscale addresses', () => {
    const json = JSON.stringify({
      Peer: {
        'node-a': {
          HostName: 'alpha',
          TailscaleIPs: ['100.64.0.10', 'fd7a::1'],
        },
        'node-b': {
          HostName: 'beta',
          TailscaleIPs: ['100.64.0.11'],
        },
      },
    });
    const peers = parseTailscaleStatus(json);
    expect(peers).toHaveLength(2);
    expect(peers[0]).toMatchObject({
      hostname: 'alpha',
      tailscaleIp: '100.64.0.10',
      candidateSyncUrl: 'http://100.64.0.10:8080',
    });
    expect(peers[1].hostname).toBe('beta');
  });

  it('returns an empty list for malformed JSON', () => {
    expect(parseTailscaleStatus('not-json')).toEqual([]);
    expect(parseTailscaleStatus('{}')).toEqual([]);
    expect(parseTailscaleStatus(JSON.stringify({ Peer: null }))).toEqual([]);
  });

  it('skips entries missing hostname or IPv4', () => {
    const json = JSON.stringify({
      Peer: {
        a: { HostName: '', TailscaleIPs: ['100.64.0.1'] },
        b: { HostName: 'beta', TailscaleIPs: ['fd7a::1'] },
        c: { HostName: 'gamma', TailscaleIPs: [] },
      },
    });
    expect(parseTailscaleStatus(json)).toEqual([]);
  });
});

describe('GET /api/sync/discover', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('returns empty list + source: none when the Tailscale CLI is not detected', async () => {
    app = await buildApp({ runTailscaleStatus: async () => null });
    const response = await app.inject({ method: 'GET', url: '/api/sync/discover' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      peers: [],
      source: 'none',
      message: expect.stringContaining('Tailscale'),
    });
  });

  it('parses peers when the Tailscale CLI returns status JSON', async () => {
    const statusJson = JSON.stringify({
      Peer: {
        'p-1': { HostName: 'mac-mini', TailscaleIPs: ['100.64.0.42'] },
      },
    });
    app = await buildApp({ runTailscaleStatus: async () => statusJson });

    const response = await app.inject({ method: 'GET', url: '/api/sync/discover' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.source).toBe('tailscale');
    expect(body.peers).toEqual([
      {
        hostname: 'mac-mini',
        tailscaleIp: '100.64.0.42',
        candidateSyncUrl: 'http://100.64.0.42:8080',
      },
    ]);
  });

  it('falls back to empty when the runner throws', async () => {
    app = await buildApp({
      runTailscaleStatus: async () => {
        throw new Error('exec failed');
      },
    });

    const response = await app.inject({ method: 'GET', url: '/api/sync/discover' });
    expect(response.statusCode).toBe(200);
    expect(response.json().source).toBe('none');
  });

  it('enforces the discover rate limit (11th request returns 429)', async () => {
    vi.stubEnv('SYNC_DISCOVER_RATE_LIMIT_MAX', '3');
    vi.stubEnv('SYNC_DISCOVER_RATE_LIMIT_WINDOW_MS', '60000');
    app = await buildApp({ runTailscaleStatus: async () => null });

    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await app.inject({ method: 'GET', url: '/api/sync/discover' });
      statuses.push(res.statusCode);
    }

    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses[3]).toBe(429);
    vi.unstubAllEnvs();
  });
});

describe('POST /api/sync/probe', () => {
  let app: FastifyInstance | null = null;

  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('returns reachable:true with parsed version on 200 response', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ appVersion: '0.5.0', schemaVersion: 26 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    app = await buildApp({ fetchImpl });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/probe',
      payload: { syncUrl: 'http://100.64.0.11:8080' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      reachable: true,
      statusCode: 200,
      appVersion: '0.5.0',
      schemaVersion: 26,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://100.64.0.11:8080/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns reachable:false with statusCode on non-OK response', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('', { status: 503 }),
    ) as unknown as typeof fetch;
    app = await buildApp({ fetchImpl });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/probe',
      payload: { syncUrl: 'http://100.64.0.11:8080' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      reachable: false,
      statusCode: 503,
      error: expect.stringContaining('503'),
    });
  });

  it('returns reachable:false with timeout error when fetch throws AbortError', async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }) as unknown as typeof fetch;
    app = await buildApp({ fetchImpl });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/probe',
      payload: { syncUrl: 'http://100.64.0.11:8080' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ reachable: false, error: 'timeout' });
  });

  it('rejects invalid sync URLs with 400', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    app = await buildApp({ fetchImpl });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/probe',
      payload: { syncUrl: 'ftp://example.com' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_SYNC_URL');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects localhost sync URLs with 400', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    app = await buildApp({ fetchImpl });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/probe',
      payload: { syncUrl: 'http://localhost:8080' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_SYNC_URL');
  });

  it('enforces the probe rate limit', async () => {
    vi.stubEnv('SYNC_PROBE_RATE_LIMIT_MAX', '2');
    vi.stubEnv('SYNC_PROBE_RATE_LIMIT_WINDOW_MS', '60000');
    const fetchImpl = vi.fn(
      async () => new Response('', { status: 200 }),
    ) as unknown as typeof fetch;
    app = await buildApp({ fetchImpl });

    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sync/probe',
        payload: { syncUrl: 'http://100.64.0.11:8080' },
      });
      statuses.push(res.statusCode);
    }
    expect(statuses[2]).toBe(429);
  });
});
