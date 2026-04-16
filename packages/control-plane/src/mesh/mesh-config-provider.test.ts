import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeshConfigProvider } from './mesh-config-provider.js';

// ---------------------------------------------------------------------------
// Mock DB — matches Drizzle chainable query builder pattern
// ---------------------------------------------------------------------------

function createMockDb() {
  let rows: unknown[] = [];

  const chain: Record<string, unknown> = {};

  const chainMethods = [
    'select',
    'from',
    'where',
    'orderBy',
    'limit',
    'offset',
    'insert',
    'update',
    'delete',
    'values',
    'set',
    'returning',
    'onConflictDoUpdate',
  ];

  for (const method of chainMethods) {
    chain[method] = vi.fn(() => chain);
  }

  // biome-ignore lint/suspicious/noThenProperty: Drizzle query builder mock requires a thenable
  chain.then = (resolve: (value: unknown) => void) => {
    resolve(rows);
    return chain;
  };

  return {
    db: chain,
    setRows: (newRows: unknown[]) => {
      rows = newRows;
    },
  };
}

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

function createMockLogger() {
  const logger = {
    child: () => logger,
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    level: 'silent',
  };
  return logger;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MeshConfigProvider', () => {
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function createProvider(
    opts: { autoDetectedIp?: string | null; port?: number; controlPlaneUrl?: string } = {},
  ) {
    return new MeshConfigProvider({
      db: mockDb.db as never,
      autoDetectedIp: opts.autoDetectedIp ?? null,
      port: opts.port ?? 8080,
      controlPlaneUrl: opts.controlPlaneUrl ?? 'http://localhost:8080',
      logger: createMockLogger() as never,
    });
  }

  describe('resolve', () => {
    it('returns auto-detected IP when no DB or env override', async () => {
      vi.stubEnv('TAILSCALE_IP', '');
      vi.stubEnv('CONTROL_PLANE_URL', '');
      mockDb.setRows([]);

      const provider = createProvider({ autoDetectedIp: '100.64.0.5' });
      const config = await provider.resolve();

      expect(config.tailscaleIp).toBe('100.64.0.5');
      expect(config.tailscaleIpSource).toBe('auto-detect');
      expect(config.syncUrl).toBe('http://100.64.0.5:8080');
      expect(config.syncUrlSource).toBe('derived');
    });

    it('DB override wins over env and auto-detect', async () => {
      vi.stubEnv('TAILSCALE_IP', '100.64.0.99');
      mockDb.setRows([{ key: 'tailscale_ip_override', value: '100.64.0.10' }]);

      const provider = createProvider({ autoDetectedIp: '100.64.0.5' });
      const config = await provider.resolve();

      expect(config.tailscaleIp).toBe('100.64.0.10');
      expect(config.tailscaleIpSource).toBe('db');
    });

    it('env var wins over auto-detect when no DB override', async () => {
      vi.stubEnv('TAILSCALE_IP', '100.64.0.99');
      mockDb.setRows([]);

      const provider = createProvider({ autoDetectedIp: '100.64.0.5' });
      const config = await provider.resolve();

      expect(config.tailscaleIp).toBe('100.64.0.99');
      expect(config.tailscaleIpSource).toBe('env');
    });

    it('falls back to controlPlaneUrl when no IP is available', async () => {
      vi.stubEnv('TAILSCALE_IP', '');
      vi.stubEnv('CONTROL_PLANE_URL', '');
      mockDb.setRows([]);

      const provider = createProvider({
        autoDetectedIp: null,
        controlPlaneUrl: 'http://my-host:9090',
      });
      const config = await provider.resolve();

      expect(config.tailscaleIp).toBeNull();
      expect(config.tailscaleIpSource).toBeNull();
      expect(config.syncUrl).toBe('http://my-host:9090');
      expect(config.syncUrlSource).toBe('derived');
    });

    it('uses CONTROL_PLANE_URL env var for syncUrl when set', async () => {
      vi.stubEnv('TAILSCALE_IP', '');
      vi.stubEnv('CONTROL_PLANE_URL', 'https://mesh.example.com');
      mockDb.setRows([]);

      const provider = createProvider({ autoDetectedIp: null });
      const config = await provider.resolve();

      expect(config.syncUrl).toBe('https://mesh.example.com');
      expect(config.syncUrlSource).toBe('env');
    });

    it('uses sync URL DB override when present', async () => {
      vi.stubEnv('CONTROL_PLANE_URL', 'https://ignored.com');
      mockDb.setRows([{ key: 'sync_url_override', value: 'https://custom.example.com:9090' }]);

      const provider = createProvider();
      const config = await provider.resolve();

      expect(config.syncUrl).toBe('https://custom.example.com:9090');
      expect(config.syncUrlSource).toBe('db');
    });

    it('resolves registration token from DB', async () => {
      vi.stubEnv('SYNC_PEER_REGISTRATION_TOKEN', 'env-token');
      mockDb.setRows([{ key: 'registration_token', value: 'db-token' }]);

      const provider = createProvider();
      const config = await provider.resolve();

      expect(config.registrationToken).toBe('db-token');
      expect(config.registrationTokenSource).toBe('db');
    });

    it('resolves registration token from env when no DB value', async () => {
      vi.stubEnv('SYNC_PEER_REGISTRATION_TOKEN', 'env-token');
      mockDb.setRows([]);

      const provider = createProvider();
      const config = await provider.resolve();

      expect(config.registrationToken).toBe('env-token');
      expect(config.registrationTokenSource).toBe('env');
    });

    it('prefers SYNC_PEER_REVERSE_REGISTRATION_TOKEN over SYNC_PEER_REGISTRATION_TOKEN', async () => {
      vi.stubEnv('SYNC_PEER_REVERSE_REGISTRATION_TOKEN', 'reverse-token');
      vi.stubEnv('SYNC_PEER_REGISTRATION_TOKEN', 'regular-token');
      mockDb.setRows([]);

      const provider = createProvider();
      const config = await provider.resolve();

      expect(config.registrationToken).toBe('reverse-token');
      expect(config.registrationTokenSource).toBe('env');
    });

    it('returns null token when nothing configured', async () => {
      vi.stubEnv('SYNC_PEER_REGISTRATION_TOKEN', '');
      vi.stubEnv('SYNC_PEER_REVERSE_REGISTRATION_TOKEN', '');
      mockDb.setRows([]);

      const provider = createProvider();
      const config = await provider.resolve();

      expect(config.registrationToken).toBeNull();
      expect(config.registrationTokenSource).toBeNull();
    });

    it('skips invalid DB IP override and falls through', async () => {
      vi.stubEnv('TAILSCALE_IP', '');
      mockDb.setRows([{ key: 'tailscale_ip_override', value: '127.0.0.1' }]);

      const provider = createProvider({ autoDetectedIp: '100.64.0.5' });
      const config = await provider.resolve();

      // Should skip the loopback DB value and use auto-detect
      expect(config.tailscaleIp).toBe('100.64.0.5');
      expect(config.tailscaleIpSource).toBe('auto-detect');
    });
  });

  describe('update', () => {
    it('calls resolve after upsert', async () => {
      vi.stubEnv('TAILSCALE_IP', '');
      vi.stubEnv('CONTROL_PLANE_URL', '');
      mockDb.setRows([]);

      const provider = createProvider({ autoDetectedIp: '100.64.0.5' });
      const config = await provider.update({
        tailscaleIpOverride: '100.64.0.20',
      });

      // After update, resolve() is called — but mock DB still returns []
      // so the resolved config uses auto-detect
      expect(config.tailscaleIp).toBe('100.64.0.5');
      expect(config.tailscaleIpSource).toBe('auto-detect');
    });

    it('deletes DB row when null is passed', async () => {
      mockDb.setRows([]);

      const provider = createProvider();
      await provider.update({ tailscaleIpOverride: null });

      // Verify delete was called (chain method)
      expect(mockDb.db.delete).toHaveBeenCalled();
    });

    it('upserts DB row when value is provided', async () => {
      mockDb.setRows([]);

      const provider = createProvider();
      await provider.update({ registrationToken: 'new-token' });

      // Verify insert + onConflictDoUpdate were called
      expect(mockDb.db.insert).toHaveBeenCalled();
      expect(mockDb.db.onConflictDoUpdate).toHaveBeenCalled();
    });
  });
});
