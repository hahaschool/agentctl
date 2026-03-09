import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthReporter } from './health-reporter.js';
import type { AgentPool } from './runtime/agent-pool.js';
import { createMockLogger } from './test-helpers.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockReturnValue('100.64.0.1\n'),
}));

const mockLogger = createMockLogger();

function makeMockAgentPool(
  agents: Array<{ agentId: string; status: string; sessionId: string | null }> = [],
): AgentPool {
  return {
    listAgents: vi.fn().mockReturnValue(agents),
  } as unknown as AgentPool;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONTROL_PLANE_URL = 'http://localhost:4000';

function makeReporter(
  overrides?: Partial<{
    agentPool: AgentPool;
    intervalMs: number;
  }>,
): HealthReporter {
  return new HealthReporter({
    machineId: 'test-machine-001',
    controlPlaneUrl: CONTROL_PLANE_URL,
    intervalMs: overrides?.intervalMs ?? 10_000,
    logger: mockLogger,
    agentPool: overrides?.agentPool,
  });
}

function mockFetchOk(body: Record<string, unknown> = { ok: true }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    }),
  );
}

function mockFetchError(status: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: () => Promise.resolve({ error: 'mock error' }),
    }),
  );
}

function mockFetchReject(error: Error): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HealthReporter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    delete process.env.TAILSCALE_IP;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ── register() ──────────────────────────────────────────────────────

  describe('register()', () => {
    it('sends POST to /api/agents/register with machine metadata', async () => {
      mockFetchOk();
      const reporter = makeReporter();

      await reporter.register();

      expect(fetch).toHaveBeenCalledTimes(1);

      const [url, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe(`${CONTROL_PLANE_URL}/api/agents/register`);
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(options.body);
      expect(body.machineId).toBe('test-machine-001');
      expect(body.hostname).toBeDefined();
      expect(body.tailscaleIp).toBeDefined();
      expect(body.os).toBeDefined();
      expect(body.arch).toBeDefined();
      expect(body.capabilities).toEqual({
        gpu: false,
        docker: false,
        maxConcurrentAgents: 3,
      });
    });

    it('logs success on 200 response', async () => {
      mockFetchOk();
      const reporter = makeReporter();

      await reporter.register();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ machineId: 'test-machine-001' }),
        'Registered with control plane',
      );
    });

    it('logs warning and does not throw on non-ok response', async () => {
      mockFetchError(500);
      const reporter = makeReporter();

      // Should not throw
      await reporter.register();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ machineId: 'test-machine-001' }),
        'Failed to register (will retry via heartbeat)',
      );
    });

    it('logs warning and does not throw on network failure', async () => {
      mockFetchReject(new Error('ECONNREFUSED'));
      const reporter = makeReporter();

      // Should not throw
      await reporter.register();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ machineId: 'test-machine-001' }),
        'Failed to register (will retry via heartbeat)',
      );
    });

    it('uses TAILSCALE_IP env var when set', async () => {
      process.env.TAILSCALE_IP = '100.99.0.42';
      mockFetchOk();
      const reporter = makeReporter();

      await reporter.register();

      const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.tailscaleIp).toBe('100.99.0.42');
    });

    it('falls back to CLI when TAILSCALE_IP is not set', async () => {
      // execSync mock returns '100.64.0.1\n' (see module-level mock)
      mockFetchOk();
      const reporter = makeReporter();

      await reporter.register();

      const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.tailscaleIp).toBe('100.64.0.1');
    });

    it('falls back to 127.0.0.1 when CLI fails', async () => {
      const { execSync } = await import('node:child_process');
      (execSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('tailscale not found');
      });
      mockFetchOk();
      const reporter = makeReporter();

      await reporter.register();

      const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.tailscaleIp).toBe('127.0.0.1');
    });
  });

  // ── start() / heartbeat timer ───────────────────────────────────────

  describe('heartbeat timer', () => {
    it('start() begins periodic heartbeats at the configured interval', async () => {
      mockFetchOk();
      const reporter = makeReporter({ intervalMs: 5_000 });

      reporter.start();

      // No heartbeat yet at t=0
      expect(fetch).not.toHaveBeenCalled();

      // Advance to first tick
      await vi.advanceTimersByTimeAsync(5_000);
      expect(fetch).toHaveBeenCalledTimes(1);

      // Advance to second tick
      await vi.advanceTimersByTimeAsync(5_000);
      expect(fetch).toHaveBeenCalledTimes(2);

      reporter.stop();
    });

    it('heartbeat sends POST to /api/agents/:machineId/heartbeat', async () => {
      mockFetchOk();
      const reporter = makeReporter({ intervalMs: 1_000 });

      reporter.start();
      await vi.advanceTimersByTimeAsync(1_000);

      const [url, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe(`${CONTROL_PLANE_URL}/api/agents/test-machine-001/heartbeat`);
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');

      reporter.stop();
    });

    it('heartbeat includes machine stats in the body', async () => {
      mockFetchOk();
      const reporter = makeReporter({ intervalMs: 1_000 });

      reporter.start();
      await vi.advanceTimersByTimeAsync(1_000);

      const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.machineId).toBe('test-machine-001');
      expect(typeof body.cpuPercent).toBe('number');
      expect(typeof body.memoryPercent).toBe('number');
      expect(Array.isArray(body.runningAgents)).toBe(true);

      reporter.stop();
    });

    it('heartbeat includes running agents from agent pool', async () => {
      mockFetchOk();
      const pool = makeMockAgentPool([
        { agentId: 'agent-1', status: 'running', sessionId: 'sess-1' },
        { agentId: 'agent-2', status: 'stopped', sessionId: null },
        { agentId: 'agent-3', status: 'running', sessionId: 'sess-3' },
      ]);
      const reporter = makeReporter({ agentPool: pool, intervalMs: 1_000 });

      reporter.start();
      await vi.advanceTimersByTimeAsync(1_000);

      const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      // Only running agents should be included
      expect(body.runningAgents).toEqual([
        { agentId: 'agent-1', sessionId: 'sess-1' },
        { agentId: 'agent-3', sessionId: 'sess-3' },
      ]);

      reporter.stop();
    });

    it('heartbeat returns empty runningAgents when no agent pool is provided', async () => {
      mockFetchOk();
      const reporter = makeReporter({ intervalMs: 1_000 });

      reporter.start();
      await vi.advanceTimersByTimeAsync(1_000);

      const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.runningAgents).toEqual([]);

      reporter.stop();
    });
  });

  // ── stop() ──────────────────────────────────────────────────────────

  describe('stop()', () => {
    it('clears the heartbeat interval so no further heartbeats are sent', async () => {
      mockFetchOk();
      const reporter = makeReporter({ intervalMs: 1_000 });

      reporter.start();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(fetch).toHaveBeenCalledTimes(1);

      reporter.stop();

      // Further ticks should not produce additional calls
      await vi.advanceTimersByTimeAsync(5_000);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('is safe to call stop() multiple times', () => {
      mockFetchOk();
      const reporter = makeReporter();

      reporter.start();
      reporter.stop();
      reporter.stop(); // should not throw
    });

    it('is safe to call stop() without calling start()', () => {
      const reporter = makeReporter();

      // Should not throw
      reporter.stop();
    });
  });

  // ── Error handling ──────────────────────────────────────────────────

  describe('error handling', () => {
    it('heartbeat fetch failure is logged, not thrown', async () => {
      mockFetchReject(new Error('Network down'));
      const reporter = makeReporter({ intervalMs: 1_000 });

      reporter.start();

      // This should not cause an unhandled rejection
      await vi.advanceTimersByTimeAsync(1_000);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ machineId: 'test-machine-001' }),
        'Heartbeat failed',
      );

      reporter.stop();
    });

    it('heartbeat continues after a transient failure', async () => {
      const mockFetch = vi
        .fn()
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce({ ok: true, status: 200 });
      vi.stubGlobal('fetch', mockFetch);

      const reporter = makeReporter({ intervalMs: 1_000 });

      reporter.start();

      // First tick fails
      await vi.advanceTimersByTimeAsync(1_000);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second tick should still fire (interval is not cleared by failure)
      await vi.advanceTimersByTimeAsync(1_000);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      reporter.stop();
    });

    it('register failure does not prevent start() from working', async () => {
      mockFetchError(503);
      const reporter = makeReporter({ intervalMs: 1_000 });

      // Register fails silently
      await reporter.register();
      expect(mockLogger.warn).toHaveBeenCalled();

      // Switch to successful fetch for heartbeats
      mockFetchOk();

      reporter.start();
      await vi.advanceTimersByTimeAsync(1_000);

      // Heartbeat should still fire
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toContain('/heartbeat');

      reporter.stop();
    });
  });

  // ── Retry logic (register retries via heartbeat) ────────────────────

  describe('retry logic', () => {
    it('register catches errors so heartbeat can serve as implicit retry', async () => {
      // First call = register fails
      const mockFetch = vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', mockFetch);

      const reporter = makeReporter({ intervalMs: 2_000 });

      // register() should not throw
      await reporter.register();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Start heartbeat which acts as an implicit retry mechanism
      reporter.start();
      await vi.advanceTimersByTimeAsync(2_000);

      // Second call is the first heartbeat — it succeeds
      expect(mockFetch).toHaveBeenCalledTimes(2);

      reporter.stop();
    });

    it('multiple register failures are all caught', async () => {
      mockFetchReject(new Error('Unreachable'));
      const reporter = makeReporter();

      await reporter.register();
      await reporter.register();
      await reporter.register();

      // All three failures should be logged as warnings, none thrown
      const warnCalls = (mockLogger.warn as ReturnType<typeof vi.fn>).mock.calls;
      const registerWarns = warnCalls.filter(
        (call) => call[1] === 'Failed to register (will retry via heartbeat)',
      );
      expect(registerWarns).toHaveLength(3);
    });
  });
});
