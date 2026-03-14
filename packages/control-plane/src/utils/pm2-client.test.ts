import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock pm2 module ──────────────────────────────────────────────
// vi.hoisted() ensures these are initialized before the hoisted vi.mock call.

const { mockConnect, mockDisconnect, mockList, mockRestart } = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockDisconnect: vi.fn(),
  mockList: vi.fn(),
  mockRestart: vi.fn(),
}));

vi.mock('pm2', () => ({
  default: {
    connect: mockConnect,
    disconnect: mockDisconnect,
    list: mockList,
    restart: mockRestart,
  },
}));

// Import AFTER mock is wired
import { pm2List, pm2Restart } from './pm2-client.js';

// ── Test fixtures ───────────────────────────────────────────────

const MOCK_PROCESSES = [
  {
    name: 'agentctl-beta-cp',
    pid: 12345,
    monit: { memory: 104857600 }, // ~100 MB
    pm2_env: { status: 'online', pm_uptime: Date.now() - 60_000, restart_time: 2 },
  },
  {
    name: 'agentctl-beta-worker',
    pid: 12346,
    monit: { memory: 52428800 }, // ~50 MB
    pm2_env: { status: 'online', pm_uptime: Date.now() - 120_000, restart_time: 0 },
  },
];

const MOCK_STOPPED_PROCESS = {
  name: 'agentctl-beta-web',
  pid: undefined,
  monit: { memory: 0 },
  pm2_env: { status: 'stopped', pm_uptime: undefined, restart_time: 5 },
};

// ── Helpers ─────────────────────────────────────────────────────

function setupSuccessfulConnect(): void {
  mockConnect.mockImplementation((cb: (err: Error | null) => void) => cb(null));
}

function setupSuccessfulList(procs: unknown[]): void {
  mockList.mockImplementation((cb: (err: Error | null, list: unknown[]) => void) =>
    cb(null, procs),
  );
}

function setupSuccessfulRestart(): void {
  mockRestart.mockImplementation((_name: string, cb: (err: Error | null) => void) => cb(null));
}

const silentLogger = {
  error: vi.fn(),
  warn: vi.fn(),
};

// ── Tests ───────────────────────────────────────────────────────

describe('pm2-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDisconnect.mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('pm2List', () => {
    it('returns process info for running processes', async () => {
      setupSuccessfulConnect();
      setupSuccessfulList(MOCK_PROCESSES);

      const result = await pm2List();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('agentctl-beta-cp');
      expect(result[0].pid).toBe(12345);
      expect(result[0].status).toBe('online');
      expect(result[0].memoryMb).toBeCloseTo(100, 0);
      expect(result[0].restarts).toBe(2);
    });

    it('handles processes with missing optional fields', async () => {
      setupSuccessfulConnect();
      setupSuccessfulList([MOCK_STOPPED_PROCESS]);

      const result = await pm2List();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('agentctl-beta-web');
      expect(result[0].pid).toBeNull();
      expect(result[0].status).toBe('stopped');
      expect(result[0].memoryMb).toBe(0);
      expect(result[0].restarts).toBe(5);
    });

    it('handles process with no name', async () => {
      setupSuccessfulConnect();
      setupSuccessfulList([{ monit: {}, pm2_env: {} }]);

      const result = await pm2List();

      expect(result[0].name).toBe('unknown');
    });

    it('returns empty array when pm2 connect fails', async () => {
      mockConnect.mockImplementation((cb: (err: Error | null) => void) =>
        cb(new Error('PM2 daemon not found')),
      );

      const result = await pm2List(silentLogger);

      expect(result).toEqual([]);
      expect(silentLogger.warn).toHaveBeenCalled();
    });

    it('returns empty array when pm2 list fails', async () => {
      setupSuccessfulConnect();
      mockList.mockImplementation((cb: (err: Error | null, list: unknown[]) => void) =>
        cb(new Error('list failed'), []),
      );

      const result = await pm2List(silentLogger);

      expect(result).toEqual([]);
    });

    it('always disconnects after listing', async () => {
      setupSuccessfulConnect();
      setupSuccessfulList(MOCK_PROCESSES);

      await pm2List();

      expect(mockDisconnect).toHaveBeenCalled();
    });

    it('disconnects even after an error', async () => {
      setupSuccessfulConnect();
      mockList.mockImplementation((cb: (err: Error | null, list: unknown[]) => void) =>
        cb(new Error('list failed'), []),
      );

      await pm2List(silentLogger);

      expect(mockDisconnect).toHaveBeenCalled();
    });

    it('calculates uptime from pm_uptime', async () => {
      const now = Date.now();
      const uptimeMs = 300_000; // 5 minutes
      setupSuccessfulConnect();
      setupSuccessfulList([
        {
          name: 'test',
          pid: 1,
          monit: { memory: 0 },
          pm2_env: { status: 'online', pm_uptime: now - uptimeMs, restart_time: 0 },
        },
      ]);

      const result = await pm2List();

      // Allow some tolerance for time elapsed during the test
      expect(result[0].uptimeMs).toBeGreaterThanOrEqual(uptimeMs - 100);
      expect(result[0].uptimeMs).toBeLessThan(uptimeMs + 1000);
    });
  });

  describe('pm2Restart', () => {
    it('restarts a named process', async () => {
      setupSuccessfulConnect();
      setupSuccessfulRestart();

      await pm2Restart('agentctl-beta-cp');

      expect(mockRestart).toHaveBeenCalledWith('agentctl-beta-cp', expect.any(Function));
    });

    it('disconnects after restart', async () => {
      setupSuccessfulConnect();
      setupSuccessfulRestart();

      await pm2Restart('agentctl-beta-cp');

      expect(mockDisconnect).toHaveBeenCalled();
    });

    it('logs error but does not throw when restart fails', async () => {
      setupSuccessfulConnect();
      mockRestart.mockImplementation((_name: string, cb: (err: Error | null) => void) =>
        cb(new Error('process not found')),
      );

      // Should not throw
      await pm2Restart('nonexistent', silentLogger);

      expect(silentLogger.error).toHaveBeenCalled();
    });

    it('logs error when connect fails during restart', async () => {
      mockConnect.mockImplementation((cb: (err: Error | null) => void) =>
        cb(new Error('connect failed')),
      );

      await pm2Restart('agentctl-beta-cp', silentLogger);

      expect(silentLogger.error).toHaveBeenCalled();
    });

    it('serializes concurrent pm2 operations', async () => {
      const callOrder: string[] = [];

      mockConnect.mockImplementation((cb: (err: Error | null) => void) => {
        callOrder.push('connect');
        cb(null);
      });

      mockList.mockImplementation((cb: (err: Error | null, list: unknown[]) => void) => {
        callOrder.push('list');
        cb(null, []);
      });

      mockRestart.mockImplementation((_name: string, cb: (err: Error | null) => void) => {
        callOrder.push('restart');
        cb(null);
      });

      // Fire both concurrently
      const [listResult] = await Promise.all([pm2List(), pm2Restart('test')]);

      expect(listResult).toEqual([]);
      // Operations should be serialized: connect+list+disconnect, then connect+restart+disconnect
      expect(callOrder.filter((c) => c === 'connect')).toHaveLength(2);
    });
  });
});
