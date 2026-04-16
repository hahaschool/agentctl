import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetTailscaleBinCacheForTests,
  deriveSyncUrlFromTarget,
  isValidTailscaleIp,
  parseTailscalePeers,
  probePeerHealth,
  resolveTailscaleBin,
} from './peer-discovery.js';

const SAMPLE_STATUS = {
  Self: {
    TailscaleIPs: ['100.64.0.1'],
    HostName: 'youhane-lori',
    Online: true,
    Tags: ['tag:mesh-node'],
  },
  Peer: {
    'nodekey:abc': {
      TailscaleIPs: ['100.64.0.2'],
      HostName: 'ec2-worker',
      Online: true,
      Tags: ['tag:mesh-node'],
    },
    'nodekey:def': {
      TailscaleIPs: ['100.64.0.3'],
      HostName: 'mac-mini',
      Online: true,
      Tags: ['tag:worker'],
    },
    'nodekey:ghi': {
      TailscaleIPs: ['100.64.0.4'],
      HostName: 'laptop',
      Online: false,
      Tags: ['tag:mesh-node'],
    },
  },
};

describe('parseTailscalePeers', () => {
  it('extracts only online peers with tag:mesh-node', () => {
    const peers = parseTailscalePeers(SAMPLE_STATUS);

    expect(peers).toHaveLength(1);
    expect(peers[0]).toEqual({ hostname: 'ec2-worker', tailscaleIp: '100.64.0.2' });
  });

  it('excludes non-mesh-node tags', () => {
    const peers = parseTailscalePeers(SAMPLE_STATUS);

    expect(peers.find((peer) => peer.hostname === 'mac-mini')).toBeUndefined();
  });

  it('excludes offline peers', () => {
    const peers = parseTailscalePeers(SAMPLE_STATUS);

    expect(peers.find((peer) => peer.hostname === 'laptop')).toBeUndefined();
  });

  it('returns empty for no peers', () => {
    expect(
      parseTailscalePeers({ Self: { TailscaleIPs: [], HostName: 'x', Online: true }, Peer: {} }),
    ).toEqual([]);
  });
});

describe('deriveSyncUrlFromTarget', () => {
  it('rejects non-string input', () => {
    const result = deriveSyncUrlFromTarget(undefined);
    expect(result.ok).toBe(false);
  });

  it('rejects empty / whitespace-only strings', () => {
    expect(deriveSyncUrlFromTarget('').ok).toBe(false);
    expect(deriveSyncUrlFromTarget('   ').ok).toBe(false);
  });

  it('rejects inputs longer than 2048 characters', () => {
    const huge = `${'a'.repeat(2_049)}.example.com`;
    expect(deriveSyncUrlFromTarget(huge).ok).toBe(false);
  });

  it('wraps a bare IP as http://<ip>:8080', () => {
    const result = deriveSyncUrlFromTarget('100.64.0.9');
    expect(result).toEqual({ ok: true, syncUrl: 'http://100.64.0.9:8080' });
  });

  it('wraps a bare hostname as http://<host>:8080', () => {
    const result = deriveSyncUrlFromTarget('ec2-worker');
    expect(result).toEqual({ ok: true, syncUrl: 'http://ec2-worker:8080' });
  });

  it('preserves a full http URL with custom port', () => {
    const result = deriveSyncUrlFromTarget('http://100.64.0.9:9090');
    expect(result).toEqual({ ok: true, syncUrl: 'http://100.64.0.9:9090' });
  });

  it('preserves a full https URL', () => {
    const result = deriveSyncUrlFromTarget('https://mesh.example.com');
    expect(result).toEqual({ ok: true, syncUrl: 'https://mesh.example.com' });
  });

  it('rejects URLs with embedded credentials', () => {
    const result = deriveSyncUrlFromTarget('http://user:pass@100.64.0.9:8080');
    expect(result.ok).toBe(false);
  });

  it.each([
    'localhost',
    'LOCALHOST',
    'foo.localhost',
    'metadata',
    'metadata.google.internal',
    'metadata.google.com',
  ])('rejects blocked hostname %s', (host) => {
    expect(deriveSyncUrlFromTarget(host).ok).toBe(false);
  });

  it.each([
    '127.0.0.1',
    '127.1.2.3',
    '0.0.0.0',
    '169.254.169.254',
  ])('rejects blocked IPv4 literal %s', (ip) => {
    expect(deriveSyncUrlFromTarget(ip).ok).toBe(false);
  });

  it.each(['::1', '::', 'fe80::1', '[::1]'])('rejects blocked IPv6 literal %s', (ip) => {
    expect(deriveSyncUrlFromTarget(ip).ok).toBe(false);
  });
});

describe('probePeerHealth', () => {
  it('extracts machineId, nodePublicKey, and version metadata on HTTP 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          machineId: 'machine-1',
          nodePublicKey: 'pk-1',
          appVersion: 'v0.5.1',
          gitSha: 'deadbeef',
          schemaVersion: 42,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await probePeerHealth(
      'http://100.64.0.9:8080',
      fetchImpl as unknown as typeof fetch,
    );

    expect(result.reachable).toBe(true);
    if (!result.reachable) return;
    expect(result.statusCode).toBe(200);
    expect(result.identity).toEqual({
      machineId: 'machine-1',
      nodePublicKey: 'pk-1',
      appVersion: 'v0.5.1',
      gitSha: 'deadbeef',
      schemaVersion: 42,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://100.64.0.9:8080/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('trims trailing slash from syncUrl before appending /health', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ machineId: 'm' }), { status: 200 }));

    await probePeerHealth('http://100.64.0.9:8080/', fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledWith('http://100.64.0.9:8080/health', expect.any(Object));
  });

  it('returns reachable=false with HTTP status on non-2xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 503 }));

    const result = await probePeerHealth(
      'http://100.64.0.9:8080',
      fetchImpl as unknown as typeof fetch,
    );

    expect(result).toMatchObject({
      reachable: false,
      statusCode: 503,
      syncUrl: 'http://100.64.0.9:8080',
      error: 'HTTP 503',
    });
  });

  it('maps ECONNREFUSED to connect_refused', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('boom'), { code: 'ECONNREFUSED' }));

    const result = await probePeerHealth(
      'http://100.64.0.9:8080',
      fetchImpl as unknown as typeof fetch,
    );

    expect(result).toMatchObject({
      reachable: false,
      statusCode: null,
      error: 'connect_refused',
    });
  });

  it('maps ENOTFOUND / EAI_AGAIN to dns', async () => {
    const notFound = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }));
    const again = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('getaddrinfo'), { code: 'EAI_AGAIN' }));

    const r1 = await probePeerHealth('http://h:8080', notFound as unknown as typeof fetch);
    const r2 = await probePeerHealth('http://h:8080', again as unknown as typeof fetch);

    expect(r1).toMatchObject({ reachable: false, error: 'dns' });
    expect(r2).toMatchObject({ reachable: false, error: 'dns' });
  });

  it('maps AbortError to timeout', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));

    const result = await probePeerHealth('http://h:8080', fetchImpl as unknown as typeof fetch);

    expect(result).toMatchObject({ reachable: false, error: 'timeout' });
  });

  it('tolerates non-JSON body by returning null identity fields', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>nope</html>', { status: 200 }));

    const result = await probePeerHealth('http://h:8080', fetchImpl as unknown as typeof fetch);

    expect(result.reachable).toBe(true);
    if (!result.reachable) return;
    expect(result.identity.machineId).toBeNull();
    expect(result.identity.nodePublicKey).toBeNull();
    expect(result.identity.appVersion).toBeNull();
  });

  it('rejects machineId strings longer than 256 chars as null', async () => {
    const tooLong = 'a'.repeat(257);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ machineId: tooLong, nodePublicKey: 'ok' }), { status: 200 }),
      );

    const result = await probePeerHealth('http://h:8080', fetchImpl as unknown as typeof fetch);
    expect(result.reachable).toBe(true);
    if (!result.reachable) return;
    expect(result.identity.machineId).toBeNull();
    expect(result.identity.nodePublicKey).toBe('ok');
  });
});

describe('resolveTailscaleBin', () => {
  beforeEach(() => {
    __resetTailscaleBinCacheForTests();
  });

  afterEach(() => {
    __resetTailscaleBinCacheForTests();
    vi.unstubAllEnvs();
  });

  it('respects TAILSCALE_BIN env var', () => {
    vi.stubEnv('TAILSCALE_BIN', '/custom/path/tailscale');
    const result = resolveTailscaleBin();
    expect(result).toBe('/custom/path/tailscale');
  });

  it('caches the resolved binary path', () => {
    vi.stubEnv('TAILSCALE_BIN', '/custom/tailscale');
    const first = resolveTailscaleBin();
    vi.stubEnv('TAILSCALE_BIN', '/other/tailscale');
    const second = resolveTailscaleBin();
    expect(first).toBe(second);
  });

  it('finds a well-known path when TAILSCALE_BIN is not set', () => {
    // On this dev machine the macOS app bundle path exists, so the resolver
    // should find it or fall back to bare 'tailscale'. Either way it returns
    // a non-empty string.
    const result = resolveTailscaleBin();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── §33.12 Phase 1: Tailscale IP validation ────────────────────

describe('isValidTailscaleIp', () => {
  it('accepts standard Tailscale CGNAT addresses', () => {
    expect(isValidTailscaleIp('100.64.0.1')).toBe(true);
    expect(isValidTailscaleIp('100.100.100.100')).toBe(true);
    expect(isValidTailscaleIp('100.127.255.254')).toBe(true);
  });

  it('accepts RFC1918 addresses (not blocked)', () => {
    expect(isValidTailscaleIp('10.0.0.1')).toBe(true);
    expect(isValidTailscaleIp('192.168.1.1')).toBe(true);
    expect(isValidTailscaleIp('172.16.0.1')).toBe(true);
  });

  it('rejects loopback addresses', () => {
    expect(isValidTailscaleIp('127.0.0.1')).toBe(false);
    expect(isValidTailscaleIp('127.255.255.255')).toBe(false);
  });

  it('rejects link-local addresses', () => {
    expect(isValidTailscaleIp('169.254.0.1')).toBe(false);
    expect(isValidTailscaleIp('169.254.169.254')).toBe(false);
  });

  it('rejects all-zeroes', () => {
    expect(isValidTailscaleIp('0.0.0.0')).toBe(false);
  });

  it('rejects non-IPv4 values', () => {
    expect(isValidTailscaleIp('')).toBe(false);
    expect(isValidTailscaleIp('not-an-ip')).toBe(false);
    expect(isValidTailscaleIp('::1')).toBe(false);
    expect(isValidTailscaleIp('100.64.0')).toBe(false);
    expect(isValidTailscaleIp('100.64.0.1.2')).toBe(false);
    expect(isValidTailscaleIp('256.0.0.1')).toBe(false);
    expect(isValidTailscaleIp('100.64.0.-1')).toBe(false);
  });
});
