import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock child_process.execFile ──────────────────────────────────
// vi.hoisted() ensures these are initialized before the hoisted vi.mock call.

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
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

function setupSuccessfulList(procs: unknown[]): void {
  mockExecFile.mockImplementation(
    (
      _file: string,
      args: readonly string[],
      _options: Record<string, unknown>,
      cb: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      if (args[0] === 'jlist') {
        cb(null, JSON.stringify(procs), '');
        return;
      }
      cb(null, '', '');
    },
  );
}

function setupSuccessfulRestart(): void {
  mockExecFile.mockImplementation(
    (
      _file: string,
      _args: readonly string[],
      _options: Record<string, unknown>,
      cb: (error: Error | null, stdout: string, stderr: string) => void,
    ) => cb(null, '', ''),
  );
}

const silentLogger = {
  error: vi.fn(),
  warn: vi.fn(),
};

// ── Tests ───────────────────────────────────────────────────────

describe('pm2-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('pm2List', () => {
    it('returns process info for running processes', async () => {
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
      setupSuccessfulList([{ monit: {}, pm2_env: {} }]);

      const result = await pm2List();

      expect(result[0].name).toBe('unknown');
    });

    it('returns empty array when pm2 connect fails', async () => {
      mockExecFile.mockImplementation(
        (
          _file: string,
          _args: readonly string[],
          _options: Record<string, unknown>,
          cb: (error: Error | null, stdout: string, stderr: string) => void,
        ) => cb(new Error('spawn pm2 ENOENT'), '', 'PM2 daemon not found'),
      );

      const result = await pm2List(silentLogger);

      expect(result).toEqual([]);
      expect(silentLogger.warn).toHaveBeenCalled();
    });

    it('returns empty array when pm2 list fails', async () => {
      mockExecFile.mockImplementation(
        (
          _file: string,
          _args: readonly string[],
          _options: Record<string, unknown>,
          cb: (error: Error | null, stdout: string, stderr: string) => void,
        ) => cb(new Error('list failed'), '', 'list failed'),
      );

      const result = await pm2List(silentLogger);

      expect(result).toEqual([]);
    });

    it('returns empty array when pm2 output is not valid JSON', async () => {
      mockExecFile.mockImplementation(
        (
          _file: string,
          _args: readonly string[],
          _options: Record<string, unknown>,
          cb: (error: Error | null, stdout: string, stderr: string) => void,
        ) => cb(null, 'not-json', ''),
      );

      const result = await pm2List(silentLogger);

      expect(result).toEqual([]);
      expect(silentLogger.warn).toHaveBeenCalled();
    });

    it('calculates uptime from pm_uptime', async () => {
      const now = Date.now();
      const uptimeMs = 300_000; // 5 minutes
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
      setupSuccessfulRestart();

      await pm2Restart('agentctl-beta-cp');

      expect(mockExecFile).toHaveBeenCalledWith(
        'pm2',
        ['restart', 'agentctl-beta-cp'],
        expect.objectContaining({ timeout: 5_000 }),
        expect.any(Function),
      );
    });

    it('logs error but does not throw when restart fails', async () => {
      mockExecFile.mockImplementation(
        (
          _file: string,
          _args: readonly string[],
          _options: Record<string, unknown>,
          cb: (error: Error | null, stdout: string, stderr: string) => void,
        ) => cb(new Error('process not found'), '', 'process not found'),
      );

      // Should not throw
      await pm2Restart('nonexistent', silentLogger);

      expect(silentLogger.error).toHaveBeenCalled();
    });

    it('logs error when connect fails during restart', async () => {
      mockExecFile.mockImplementation(
        (
          _file: string,
          _args: readonly string[],
          _options: Record<string, unknown>,
          cb: (error: Error | null, stdout: string, stderr: string) => void,
        ) => cb(new Error('connect failed'), '', 'connect failed'),
      );

      await pm2Restart('agentctl-beta-cp', silentLogger);

      expect(silentLogger.error).toHaveBeenCalled();
    });

    it('serializes concurrent pm2 operations', async () => {
      const callOrder: string[] = [];

      mockExecFile.mockImplementation(
        (
          _file: string,
          args: readonly string[],
          _options: Record<string, unknown>,
          cb: (error: Error | null, stdout: string, stderr: string) => void,
        ) => {
          callOrder.push(args[0]);
          cb(null, args[0] === 'jlist' ? '[]' : '', '');
        },
      );

      // Fire both concurrently
      const [listResult] = await Promise.all([pm2List(), pm2Restart('test')]);

      expect(listResult).toEqual([]);
      expect(callOrder).toEqual(['jlist', 'restart']);
    });
  });
});
