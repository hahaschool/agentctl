import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SchedulerJob } from '../services/api-client.js';
import { MobileClientError } from '../services/api-client.js';
import type { SchedulerState } from './scheduler-presenter.js';
import { SchedulerPresenter } from './scheduler-presenter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(partial: Partial<SchedulerJob> = {}): SchedulerJob {
  return {
    key: 'heartbeat:agent-1',
    name: 'agent:start',
    id: null,
    endDate: null,
    tz: null,
    pattern: '*/5 * * * *',
    next: Date.now() + 300_000,
    ...partial,
  };
}

function makeApiClient(overrides: Record<string, unknown> = {}) {
  return {
    getSchedulerJobs: vi.fn().mockResolvedValue({ jobs: [makeJob()] }),
    createHeartbeatJob: vi
      .fn()
      .mockResolvedValue({ ok: true, agentId: 'a1', machineId: 'm1', intervalMs: 60_000 }),
    createCronJob: vi.fn().mockResolvedValue({
      ok: true,
      agentId: 'a1',
      machineId: 'm1',
      pattern: '* * * * *',
      model: null,
    }),
    removeSchedulerJob: vi
      .fn()
      .mockResolvedValue({ ok: true, key: 'heartbeat:a1', removedCount: 1 }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SchedulerPresenter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe('initial state', () => {
    it('returns empty state before loading', () => {
      const api = makeApiClient();
      const presenter = new SchedulerPresenter({ apiClient: api as never });
      const state = presenter.getState();

      expect(state.jobs).toEqual([]);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.lastUpdated).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // loadJobs
  // -------------------------------------------------------------------------

  describe('loadJobs', () => {
    it('fetches and stores scheduler jobs', async () => {
      const jobs = [makeJob(), makeJob({ key: 'cron:agent-2', pattern: '0 9 * * 1' })];
      const api = makeApiClient({
        getSchedulerJobs: vi.fn().mockResolvedValue({ jobs }),
      });
      const presenter = new SchedulerPresenter({ apiClient: api as never });

      await presenter.loadJobs();
      const state = presenter.getState();

      expect(state.jobs).toEqual(jobs);
      expect(state.isLoading).toBe(false);
      expect(state.lastUpdated).toEqual(new Date('2024-06-15T12:00:00Z'));
    });

    it('sets isLoading=true during load', () => {
      const states: boolean[] = [];
      const api = makeApiClient();
      const presenter = new SchedulerPresenter({
        apiClient: api as never,
        onChange: (s: SchedulerState) => states.push(s.isLoading),
      });

      void presenter.loadJobs();
      expect(states[0]).toBe(true);
    });

    it('sets isLoading=false after load completes', async () => {
      const api = makeApiClient();
      const presenter = new SchedulerPresenter({ apiClient: api as never });

      await presenter.loadJobs();
      expect(presenter.getState().isLoading).toBe(false);
    });

    it('sets error on load failure', async () => {
      const api = makeApiClient({
        getSchedulerJobs: vi
          .fn()
          .mockRejectedValue(new MobileClientError('HTTP_501', 'Not configured')),
      });
      const presenter = new SchedulerPresenter({ apiClient: api as never });

      await presenter.loadJobs();
      const state = presenter.getState();

      expect(state.error?.code).toBe('HTTP_501');
      expect(state.isLoading).toBe(false);
    });

    it('wraps non-MobileClientError in SCHEDULER_LOAD_FAILED', async () => {
      const api = makeApiClient({
        getSchedulerJobs: vi.fn().mockRejectedValue(new TypeError('fetch failed')),
      });
      const presenter = new SchedulerPresenter({ apiClient: api as never });

      await presenter.loadJobs();
      const state = presenter.getState();

      expect(state.error?.code).toBe('SCHEDULER_LOAD_FAILED');
      expect(state.error?.message).toBe('fetch failed');
    });

    it('wraps non-Error values in SCHEDULER_LOAD_FAILED', async () => {
      const api = makeApiClient({
        getSchedulerJobs: vi.fn().mockRejectedValue('string error'),
      });
      const presenter = new SchedulerPresenter({ apiClient: api as never });

      await presenter.loadJobs();
      const state = presenter.getState();

      expect(state.error?.code).toBe('SCHEDULER_LOAD_FAILED');
      expect(state.error?.message).toBe('string error');
    });

    it('clears previous error on successful load', async () => {
      const api = makeApiClient({
        getSchedulerJobs: vi
          .fn()
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValueOnce({ jobs: [] }),
      });
      const presenter = new SchedulerPresenter({ apiClient: api as never });

      await presenter.loadJobs();
      expect(presenter.getState().error).not.toBeNull();

      await presenter.loadJobs();
      expect(presenter.getState().error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // createHeartbeatJob
  // -------------------------------------------------------------------------

  describe('createHeartbeatJob', () => {
    it('creates a heartbeat job and refreshes jobs list', async () => {
      const api = makeApiClient();
      const presenter = new SchedulerPresenter({ apiClient: api as never });

      const result = await presenter.createHeartbeatJob({
        agentId: 'a1',
        machineId: 'm1',
        intervalMs: 60_000,
      });

      expect(result.ok).toBe(true);
      expect(api.createHeartbeatJob).toHaveBeenCalledWith({
        agentId: 'a1',
        machineId: 'm1',
        intervalMs: 60_000,
      });
      // Should refresh jobs after creation
      expect(api.getSchedulerJobs).toHaveBeenCalled();
    });

    it('throws INVALID_AGENT_ID for empty agentId', async () => {
      const api = makeApiClient();
      const presenter = new SchedulerPresenter({ apiClient: api as never });

      await expect(
        presenter.createHeartbeatJob({ agentId: '', machineId: 'm1', intervalMs: 60_000 }),
      ).rejects.toThrow(MobileClientError);

      try {
        await presenter.createHeartbeatJob({ agentId: '', machineId: 'm1', intervalMs: 60_000 });
      } catch (err) {
        expect((err as MobileClientError).code).toBe('INVALID_AGENT_ID');
      }
    });

    it('throws INVALID_MACHINE_ID for empty machineId', async () => {
      const api = makeApiClient();
      const presenter = new SchedulerPresenter({ apiClient: api as never });

      try {
        await presenter.createHeartbeatJob({ agentId: 'a1', machineId: '', intervalMs: 60_000 });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect((err as MobileClientError).code).toBe('INVALID_MACHINE_ID');
      }
    });

    it('throws INVALID_INTERVAL for non-positive intervalMs', async () => {
      const api = makeApiClient();
      const presenter = new SchedulerPresenter({ apiClient: api as never });

      try {
        await presenter.createHeartbeatJob({ agentId: 'a1', machineId: 'm1', intervalMs: 0 });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect((err as MobileClientError).code).toBe('INVALID_INTERVAL');
      }
    });

    it('throws INVALID_INTERVAL for NaN intervalMs', async () => {
      const api = makeApiClient();
      const presenter = new SchedulerPresenter({ apiClient: api as never });

      try {
        await presenter.createHeartbeatJob({
          agentId: 'a1',
          machineId: 'm1',
          intervalMs: Number.NaN,
        });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect((err as MobileClientError).code).toBe('INVALID_INTERVAL');
      }
    });

    it('throws NOT_IMPLEMENTED when createHeartbeatJob is unavailable', async () => {
      const api = makeApiClient({ createHeartbeatJob: undefined });
      const presenter = new SchedulerPresenter({ apiClient: api as never });

      try {
        await presenter.createHeartbeatJob({ agentId: 'a1', machineId: 'm1', intervalMs: 60_000 });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect((err as MobileClientError).code).toBe('NOT_IMPLEMENTED');
      }
    });
  });

  // -------------------------------------------------------------------------
  // createCronJob
  // -------------------------------------------------------------------------

  describe('createCronJob', () => {
    it('creates a cron job and refreshes jobs list', async () => {
      const api = makeApiClient();
      const presenter = new SchedulerPresenter({ apiClient: api as never });

      const result = await presenter.createCronJob({
        agentId: 'a1',
        machineId: 'm1',
        pattern: '0 9 * * 1-5',
      });

      expect(result.ok).toBe(true);
      expect(api.createCronJob).toHaveBeenCalledWith({
        agentId: 'a1',
        machineId: 'm1',
        pattern: '0 9 * * 1-5',
      });
      expect(api.getSchedulerJobs).toHaveBeenCalled();
    });

    it('passes optional model parameter', async () => {
      const api = makeApiClient();
      const presenter = new SchedulerPresenter({ apiClient: api as never });

      await presenter.createCronJob({
        agentId: 'a1',
        machineId: 'm1',
        pattern: '*/5 * * * *',
        model: 'claude-sonnet-4-20250514',
      });

      expect(api.createCronJob).toHaveBeenCalledWith({
        agentId: 'a1',
        machineId: 'm1',
        pattern: '*/5 * * * *',
        model: 'claude-sonnet-4-20250514',
      });
    });

    it('throws INVALID_AGENT_ID for empty agentId', async () => {
      const api = makeApiClient();
      const presenter = new SchedulerPresenter({ apiClient: api as never });

      try {
        await presenter.createCronJob({ agentId: '', machineId: 'm1', pattern: '* * * * *' });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect((err as MobileClientError).code).toBe('INVALID_AGENT_ID');
      }
    });

    it('throws INVALID_CRON_PATTERN for empty pattern', async () => {
      const api = makeApiClient();
      const presenter = new SchedulerPresenter({ apiClient: api as never });

      try {
        await presenter.createCronJob({ agentId: 'a1', machineId: 'm1', pattern: '' });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect((err as MobileClientError).code).toBe('INVALID_CRON_PATTERN');
      }
    });

    it('throws NOT_IMPLEMENTED when createCronJob is unavailable', async () => {
      const api = makeApiClient({ createCronJob: undefined });
      const presenter = new SchedulerPresenter({ apiClient: api as never });

      try {
        await presenter.createCronJob({ agentId: 'a1', machineId: 'm1', pattern: '* * * * *' });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect((err as MobileClientError).code).toBe('NOT_IMPLEMENTED');
      }
    });
  });

  // -------------------------------------------------------------------------
  // removeJob
  // -------------------------------------------------------------------------

  describe('removeJob', () => {
    it('removes a job by key and refreshes', async () => {
      const api = makeApiClient();
      const presenter = new SchedulerPresenter({ apiClient: api as never });

      const result = await presenter.removeJob('heartbeat:a1');

      expect(result.ok).toBe(true);
      expect(api.removeSchedulerJob).toHaveBeenCalledWith('heartbeat:a1');
      expect(api.getSchedulerJobs).toHaveBeenCalled();
    });

    it('throws INVALID_JOB_KEY for empty key', async () => {
      const api = makeApiClient();
      const presenter = new SchedulerPresenter({ apiClient: api as never });

      try {
        await presenter.removeJob('');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect((err as MobileClientError).code).toBe('INVALID_JOB_KEY');
      }
    });

    it('throws NOT_IMPLEMENTED when removeSchedulerJob is unavailable', async () => {
      const api = makeApiClient({ removeSchedulerJob: undefined });
      const presenter = new SchedulerPresenter({ apiClient: api as never });

      try {
        await presenter.removeJob('heartbeat:a1');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect((err as MobileClientError).code).toBe('NOT_IMPLEMENTED');
      }
    });
  });

  // -------------------------------------------------------------------------
  // onChange callback
  // -------------------------------------------------------------------------

  describe('onChange callback', () => {
    it('fires on state changes during loadJobs', async () => {
      const onChange = vi.fn();
      const api = makeApiClient();
      const presenter = new SchedulerPresenter({ apiClient: api as never, onChange });

      await presenter.loadJobs();

      // loading=true, then final state
      expect(onChange).toHaveBeenCalledTimes(2);
    });

    it('passes immutable state copies', async () => {
      const states: SchedulerState[] = [];
      const api = makeApiClient();
      const presenter = new SchedulerPresenter({
        apiClient: api as never,
        onChange: (s: SchedulerState) => states.push(s),
      });

      await presenter.loadJobs();
      expect(states[0]).not.toBe(states[1]);
    });
  });

  // -------------------------------------------------------------------------
  // Immutability
  // -------------------------------------------------------------------------

  describe('immutability', () => {
    it('getState returns a new object each time', () => {
      const api = makeApiClient();
      const presenter = new SchedulerPresenter({ apiClient: api as never });

      const s1 = presenter.getState();
      const s2 = presenter.getState();

      expect(s1).not.toBe(s2);
      expect(s1).toEqual(s2);
    });

    it('getState returns a new jobs array each time', async () => {
      const api = makeApiClient();
      const presenter = new SchedulerPresenter({ apiClient: api as never });
      await presenter.loadJobs();

      const s1 = presenter.getState();
      const s2 = presenter.getState();

      expect(s1.jobs).not.toBe(s2.jobs);
    });

    it('mutating returned state does not affect internal state', async () => {
      const api = makeApiClient();
      const presenter = new SchedulerPresenter({ apiClient: api as never });
      await presenter.loadJobs();

      const state = presenter.getState();
      state.jobs.push(makeJob({ key: 'injected' }));

      expect(presenter.getState().jobs).toHaveLength(1);
    });
  });
});
