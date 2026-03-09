import type { Agent, Machine, ManagedSessionStatus } from '@agentctl/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HealthResponse, RuntimeSessionInfo } from '../services/api-client.js';
import { MobileClientError } from '../services/api-client.js';
import type { DashboardState } from './dashboard-presenter.js';
import { DashboardPresenter } from './dashboard-presenter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApiClient(overrides: Record<string, unknown> = {}): {
  health: ReturnType<typeof vi.fn>;
  listMachines: ReturnType<typeof vi.fn>;
  listAgents: ReturnType<typeof vi.fn>;
  listRuntimeSessions: ReturnType<typeof vi.fn>;
} {
  return {
    health: vi.fn().mockResolvedValue({ status: 'ok', timestamp: '2024-01-01T00:00:00Z' }),
    listMachines: vi.fn().mockResolvedValue([]),
    listAgents: vi.fn().mockResolvedValue([]),
    listRuntimeSessions: vi.fn().mockResolvedValue({ sessions: [], count: 0 }),
    ...overrides,
  };
}

function makeAgent(partial: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    machineId: 'machine-1',
    name: 'test-agent',
    type: 'manual',
    status: 'registered',
    schedule: null,
    projectPath: null,
    worktreeBranch: null,
    currentSessionId: null,
    config: {},
    lastRunAt: null,
    lastCostUsd: null,
    totalCostUsd: 0,
    createdAt: new Date('2024-01-01'),
    ...partial,
  };
}

function makeMachine(partial: Partial<Machine> = {}): Machine {
  return {
    id: 'machine-1',
    hostname: 'ec2-1',
    tailscaleIp: '100.1.1.1',
    os: 'linux',
    arch: 'x64',
    status: 'online',
    lastHeartbeat: null,
    capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
    createdAt: new Date('2024-01-01'),
    ...partial,
  };
}

function makeRuntimeSession(
  partial: Partial<RuntimeSessionInfo> & { status?: ManagedSessionStatus } = {},
): RuntimeSessionInfo {
  return {
    id: 'ms-1',
    runtime: 'codex',
    nativeSessionId: 'codex-native-1',
    machineId: 'machine-1',
    agentId: 'agent-1',
    projectPath: '/tmp/project',
    worktreePath: '/tmp/project/.trees/runtime',
    status: 'active',
    configRevision: 1,
    handoffStrategy: null,
    handoffSourceSessionId: null,
    metadata: {},
    startedAt: '2024-01-01T00:00:00Z',
    lastHeartbeat: '2024-01-01T00:05:00Z',
    endedAt: null,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DashboardPresenter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe('initial state', () => {
    it('returns empty state before any refresh', () => {
      const api = makeApiClient();
      const presenter = new DashboardPresenter({ apiClient: api as never });
      const state = presenter.getState();

      expect(state.health).toBeNull();
      expect(state.machines).toEqual([]);
      expect(state.agents).toEqual([]);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.lastUpdated).toBeNull();
    });

    it('returns zero stats initially', () => {
      const api = makeApiClient();
      const presenter = new DashboardPresenter({ apiClient: api as never });
      const { stats } = presenter.getState();

      expect(stats.totalAgents).toBe(0);
      expect(stats.running).toBe(0);
      expect(stats.idle).toBe(0);
      expect(stats.error).toBe(0);
      expect(stats.totalMachines).toBe(0);
      expect(stats.onlineMachines).toBe(0);
      expect(stats.totalManagedRuntimes).toBe(0);
      expect(stats.activeManagedRuntimes).toBe(0);
      expect(stats.switchingManagedRuntimes).toBe(0);
    });

    it('is not polling before start()', () => {
      const api = makeApiClient();
      const presenter = new DashboardPresenter({ apiClient: api as never });

      expect(presenter.isPolling).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  describe('loading state', () => {
    it('sets isLoading=true during refresh', () => {
      const states: boolean[] = [];
      const api = makeApiClient();
      const presenter = new DashboardPresenter({
        apiClient: api as never,
        onChange: (s: DashboardState) => {
          states.push(s.isLoading);
        },
      });

      void presenter.refresh();

      // First onChange fires with isLoading=true
      expect(states[0]).toBe(true);
    });

    it('sets isLoading=false after refresh completes', async () => {
      const api = makeApiClient();
      const presenter = new DashboardPresenter({ apiClient: api as never });

      await presenter.refresh();
      const state = presenter.getState();

      expect(state.isLoading).toBe(false);
    });

    it('sets isLoading=false after refresh fails', async () => {
      const api = makeApiClient({
        health: vi.fn().mockRejectedValue(new Error('network down')),
      });
      const presenter = new DashboardPresenter({ apiClient: api as never });

      await presenter.refresh();
      const state = presenter.getState();

      expect(state.isLoading).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Successful refresh
  // -------------------------------------------------------------------------

  describe('successful refresh', () => {
    it('populates health, machines, and agents after refresh', async () => {
      const health: HealthResponse = { status: 'ok', timestamp: '2024-01-01T00:00:00Z' };
      const machines = [makeMachine()];
      const agents = [makeAgent({ status: 'running' })];
      const runtimeSessions = [makeRuntimeSession({ status: 'active' })];

      const api = makeApiClient({
        health: vi.fn().mockResolvedValue(health),
        listMachines: vi.fn().mockResolvedValue(machines),
        listAgents: vi.fn().mockResolvedValue(agents),
        listRuntimeSessions: vi.fn().mockResolvedValue({ sessions: runtimeSessions, count: 1 }),
      });

      const presenter = new DashboardPresenter({ apiClient: api as never });
      await presenter.refresh();
      const state = presenter.getState();

      expect(state.health).toEqual(health);
      expect(state.machines).toEqual(machines);
      expect(state.agents).toEqual(agents);
      expect(state.runtimeSessions).toEqual(runtimeSessions);
    });

    it('sets lastUpdated after successful refresh', async () => {
      const api = makeApiClient();
      const presenter = new DashboardPresenter({ apiClient: api as never });

      vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
      await presenter.refresh();

      const state = presenter.getState();
      expect(state.lastUpdated).toEqual(new Date('2024-06-15T12:00:00Z'));
    });

    it('clears previous error after successful refresh', async () => {
      const api = makeApiClient({
        health: vi
          .fn()
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValueOnce({ status: 'ok', timestamp: '' }),
      });

      const presenter = new DashboardPresenter({ apiClient: api as never });

      await presenter.refresh();
      expect(presenter.getState().error).not.toBeNull();

      await presenter.refresh();
      expect(presenter.getState().error).toBeNull();
    });

    it('calls health with detail=true', async () => {
      const api = makeApiClient();
      const presenter = new DashboardPresenter({ apiClient: api as never });
      await presenter.refresh();

      expect(api.health).toHaveBeenCalledWith(true);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('stores MobileClientError from API calls', async () => {
      const apiError = new MobileClientError('NETWORK_ERROR', 'Connection refused');
      const api = makeApiClient({
        health: vi.fn().mockRejectedValue(apiError),
      });

      const presenter = new DashboardPresenter({ apiClient: api as never });
      await presenter.refresh();

      const state = presenter.getState();
      expect(state.error).toBeInstanceOf(MobileClientError);
      expect(state.error?.code).toBe('NETWORK_ERROR');
    });

    it('wraps non-MobileClientError in DASHBOARD_REFRESH_FAILED', async () => {
      const api = makeApiClient({
        listMachines: vi.fn().mockRejectedValue(new TypeError('unexpected')),
      });

      const presenter = new DashboardPresenter({ apiClient: api as never });
      await presenter.refresh();

      const state = presenter.getState();
      expect(state.error).toBeInstanceOf(MobileClientError);
      expect(state.error?.code).toBe('DASHBOARD_REFRESH_FAILED');
      expect(state.error?.message).toBe('unexpected');
    });

    it('wraps non-Error values in DASHBOARD_REFRESH_FAILED', async () => {
      const api = makeApiClient({
        listAgents: vi.fn().mockRejectedValue('string error'),
      });

      const presenter = new DashboardPresenter({ apiClient: api as never });
      await presenter.refresh();

      const state = presenter.getState();
      expect(state.error?.code).toBe('DASHBOARD_REFRESH_FAILED');
      expect(state.error?.message).toBe('string error');
    });

    it('preserves existing data on refresh error', async () => {
      const machines = [makeMachine()];
      const agents = [makeAgent({ status: 'running' })];

      const api = makeApiClient({
        health: vi
          .fn()
          .mockResolvedValueOnce({ status: 'ok', timestamp: '' })
          .mockRejectedValueOnce(new Error('fail')),
        listMachines: vi.fn().mockResolvedValue(machines),
        listAgents: vi.fn().mockResolvedValue(agents),
      });

      const presenter = new DashboardPresenter({ apiClient: api as never });

      await presenter.refresh();
      expect(presenter.getState().machines).toEqual(machines);

      await presenter.refresh();
      // Machines remain from previous successful fetch
      expect(presenter.getState().machines).toEqual(machines);
      expect(presenter.getState().error).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Stats computation
  // -------------------------------------------------------------------------

  describe('stats computation', () => {
    it('counts running agents (running + starting + restarting)', () => {
      const agents = [
        makeAgent({ id: '1', status: 'running' }),
        makeAgent({ id: '2', status: 'starting' }),
        makeAgent({ id: '3', status: 'restarting' }),
        makeAgent({ id: '4', status: 'stopped' }),
      ];

      const stats = DashboardPresenter.computeStats(agents, []);
      expect(stats.running).toBe(3);
    });

    it('counts error agents (error + timeout)', () => {
      const agents = [
        makeAgent({ id: '1', status: 'error' }),
        makeAgent({ id: '2', status: 'timeout' }),
        makeAgent({ id: '3', status: 'running' }),
      ];

      const stats = DashboardPresenter.computeStats(agents, []);
      expect(stats.error).toBe(2);
    });

    it('counts idle agents as total minus running minus error', () => {
      const agents = [
        makeAgent({ id: '1', status: 'running' }),
        makeAgent({ id: '2', status: 'error' }),
        makeAgent({ id: '3', status: 'stopped' }),
        makeAgent({ id: '4', status: 'registered' }),
        makeAgent({ id: '5', status: 'stopping' }),
      ];

      const stats = DashboardPresenter.computeStats(agents, []);
      expect(stats.totalAgents).toBe(5);
      expect(stats.running).toBe(1);
      expect(stats.error).toBe(1);
      expect(stats.idle).toBe(3);
    });

    it('counts online machines', () => {
      const machines = [
        makeMachine({ id: 'm1', status: 'online' }),
        makeMachine({ id: 'm2', status: 'offline' }),
        makeMachine({ id: 'm3', status: 'online' }),
        makeMachine({ id: 'm4', status: 'degraded' }),
      ];

      const stats = DashboardPresenter.computeStats([], machines);
      expect(stats.totalMachines).toBe(4);
      expect(stats.onlineMachines).toBe(2);
    });

    it('counts managed runtime totals, active, and switching sessions', () => {
      const runtimeSessions = [
        makeRuntimeSession({ id: 'ms-1', status: 'active' }),
        makeRuntimeSession({ id: 'ms-2', status: 'handing_off' }),
        makeRuntimeSession({ id: 'ms-3', status: 'paused' }),
      ];

      const stats = DashboardPresenter.computeStats([], [], runtimeSessions);
      expect(stats.totalManagedRuntimes).toBe(3);
      expect(stats.activeManagedRuntimes).toBe(1);
      expect(stats.switchingManagedRuntimes).toBe(1);
    });

    it('returns zero stats for empty arrays', () => {
      const stats = DashboardPresenter.computeStats([], []);
      expect(stats).toEqual({
        totalAgents: 0,
        running: 0,
        idle: 0,
        error: 0,
        totalMachines: 0,
        onlineMachines: 0,
        totalManagedRuntimes: 0,
        activeManagedRuntimes: 0,
        switchingManagedRuntimes: 0,
      });
    });

    it('integrates stats into state after refresh', async () => {
      const agents = [
        makeAgent({ id: '1', status: 'running' }),
        makeAgent({ id: '2', status: 'error' }),
      ];
      const machines = [makeMachine({ status: 'online' })];
      const runtimeSessions = [
        makeRuntimeSession({ id: 'ms-1', status: 'active' }),
        makeRuntimeSession({ id: 'ms-2', status: 'handing_off' }),
      ];

      const api = makeApiClient({
        listAgents: vi.fn().mockResolvedValue(agents),
        listMachines: vi.fn().mockResolvedValue(machines),
        listRuntimeSessions: vi.fn().mockResolvedValue({ sessions: runtimeSessions, count: 2 }),
      });

      const presenter = new DashboardPresenter({ apiClient: api as never });
      await presenter.refresh();
      const { stats } = presenter.getState();

      expect(stats.totalAgents).toBe(2);
      expect(stats.running).toBe(1);
      expect(stats.error).toBe(1);
      expect(stats.idle).toBe(0);
      expect(stats.totalMachines).toBe(1);
      expect(stats.onlineMachines).toBe(1);
      expect(stats.totalManagedRuntimes).toBe(2);
      expect(stats.activeManagedRuntimes).toBe(1);
      expect(stats.switchingManagedRuntimes).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Auto-refresh (polling)
  // -------------------------------------------------------------------------

  describe('auto-refresh', () => {
    it('calls refresh immediately on start()', () => {
      const api = makeApiClient();
      const presenter = new DashboardPresenter({
        apiClient: api as never,
        pollIntervalMs: 10_000,
      });

      presenter.start();

      expect(api.health).toHaveBeenCalledOnce();

      presenter.stop();
    });

    it('sets isPolling=true after start()', () => {
      const api = makeApiClient();
      const presenter = new DashboardPresenter({ apiClient: api as never });

      presenter.start();
      expect(presenter.isPolling).toBe(true);

      presenter.stop();
    });

    it('calls refresh at the configured interval', async () => {
      const api = makeApiClient();
      const presenter = new DashboardPresenter({
        apiClient: api as never,
        pollIntervalMs: 5_000,
      });

      presenter.start();

      // Initial call
      expect(api.health).toHaveBeenCalledTimes(1);

      // After one interval
      vi.advanceTimersByTime(5_000);
      expect(api.health).toHaveBeenCalledTimes(2);

      // After another interval
      vi.advanceTimersByTime(5_000);
      expect(api.health).toHaveBeenCalledTimes(3);

      presenter.stop();
    });

    it('stops polling when stop() is called', () => {
      const api = makeApiClient();
      const presenter = new DashboardPresenter({
        apiClient: api as never,
        pollIntervalMs: 5_000,
      });

      presenter.start();
      expect(presenter.isPolling).toBe(true);

      presenter.stop();
      expect(presenter.isPolling).toBe(false);

      vi.advanceTimersByTime(10_000);
      // Only the initial call should have happened
      expect(api.health).toHaveBeenCalledTimes(1);
    });

    it('uses default poll interval of 15000ms', () => {
      const api = makeApiClient();
      const presenter = new DashboardPresenter({ apiClient: api as never });

      presenter.start();
      expect(api.health).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(14_999);
      expect(api.health).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1);
      expect(api.health).toHaveBeenCalledTimes(2);

      presenter.stop();
    });

    it('resets polling when start() is called again', () => {
      const api = makeApiClient();
      const presenter = new DashboardPresenter({
        apiClient: api as never,
        pollIntervalMs: 5_000,
      });

      presenter.start();
      vi.advanceTimersByTime(3_000);

      // Restart resets the timer
      presenter.start();
      vi.advanceTimersByTime(3_000);
      // Should be: 1 initial + 1 second start initial = 2
      // (the 3s advance did NOT trigger a poll because timer was reset)
      expect(api.health).toHaveBeenCalledTimes(2);

      presenter.stop();
    });
  });

  // -------------------------------------------------------------------------
  // onChange callback
  // -------------------------------------------------------------------------

  describe('onChange callback', () => {
    it('fires onChange on each state update during refresh', async () => {
      const onChange = vi.fn();
      const api = makeApiClient();
      const presenter = new DashboardPresenter({
        apiClient: api as never,
        onChange,
      });

      await presenter.refresh();

      // At least two calls: loading=true, then final state
      expect(onChange).toHaveBeenCalledTimes(2);
    });

    it('passes immutable state copies to onChange', async () => {
      const states: DashboardState[] = [];
      const api = makeApiClient();
      const presenter = new DashboardPresenter({
        apiClient: api as never,
        onChange: (s: DashboardState) => {
          states.push(s);
        },
      });

      await presenter.refresh();

      // First call (loading) and second call (complete) should be different objects
      expect(states[0]).not.toBe(states[1]);
    });
  });

  // -------------------------------------------------------------------------
  // Immutability
  // -------------------------------------------------------------------------

  describe('immutability', () => {
    it('getState returns a new object each time', () => {
      const api = makeApiClient();
      const presenter = new DashboardPresenter({ apiClient: api as never });

      const s1 = presenter.getState();
      const s2 = presenter.getState();

      expect(s1).not.toBe(s2);
      expect(s1).toEqual(s2);
    });

    it('getState returns a new stats object each time', () => {
      const api = makeApiClient();
      const presenter = new DashboardPresenter({ apiClient: api as never });

      const s1 = presenter.getState();
      const s2 = presenter.getState();

      expect(s1.stats).not.toBe(s2.stats);
    });

    it('mutating returned state does not affect internal state', async () => {
      const api = makeApiClient({
        listAgents: vi.fn().mockResolvedValue([makeAgent({ status: 'running' })]),
      });
      const presenter = new DashboardPresenter({ apiClient: api as never });
      await presenter.refresh();

      const state = presenter.getState();
      state.agents.push(makeAgent({ id: 'injected' }));
      state.stats.running = 999;

      const fresh = presenter.getState();
      expect(fresh.agents).toHaveLength(1);
      expect(fresh.stats.running).toBe(1);
      expect(fresh.runtimeSessions).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  describe('cleanup', () => {
    it('stop() is safe to call when not polling', () => {
      const api = makeApiClient();
      const presenter = new DashboardPresenter({ apiClient: api as never });

      // Should not throw
      presenter.stop();
      expect(presenter.isPolling).toBe(false);
    });

    it('stop() is safe to call multiple times', () => {
      const api = makeApiClient();
      const presenter = new DashboardPresenter({ apiClient: api as never });

      presenter.start();
      presenter.stop();
      presenter.stop();
      expect(presenter.isPolling).toBe(false);
    });
  });
});
