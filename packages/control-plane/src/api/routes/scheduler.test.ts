import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RepeatableJobInfo, RepeatableJobManager } from '../../scheduler/repeatable-jobs.js';
import { createServer } from '../server.js';

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
} as unknown as Logger;

const SAMPLE_JOBS: RepeatableJobInfo[] = [
  {
    key: 'heartbeat:agent-1',
    name: 'agent:heartbeat',
    pattern: null,
    every: '30000',
    next: 1709400000000,
  },
  {
    key: 'cron:agent-2',
    name: 'agent:cron',
    pattern: '*/5 * * * *',
    every: null,
    next: 1709400300000,
  },
];

function createMockRepeatableJobManager(
  overrides: Partial<RepeatableJobManager> = {},
): RepeatableJobManager {
  return {
    addHeartbeatJob: vi.fn().mockResolvedValue(undefined),
    addCronJob: vi.fn().mockResolvedValue(undefined),
    removeJobsByAgentId: vi.fn().mockResolvedValue(1),
    listRepeatableJobs: vi.fn().mockResolvedValue(SAMPLE_JOBS),
    ...overrides,
  };
}

// =============================================================================
// Tests WITH repeatableJobManager configured
// =============================================================================

describe('Scheduler routes — /api/scheduler (configured)', () => {
  let app: FastifyInstance;
  let mockManager: RepeatableJobManager;

  beforeAll(async () => {
    mockManager = createMockRepeatableJobManager();
    app = await createServer({ logger, repeatableJobs: mockManager });
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-assign default mock implementations after clearAllMocks
    vi.mocked(mockManager.listRepeatableJobs).mockResolvedValue(SAMPLE_JOBS);
    vi.mocked(mockManager.addHeartbeatJob).mockResolvedValue(undefined);
    vi.mocked(mockManager.addCronJob).mockResolvedValue(undefined);
    vi.mocked(mockManager.removeJobsByAgentId).mockResolvedValue(1);
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // GET /api/scheduler/jobs — List all repeatable jobs
  // -------------------------------------------------------------------------

  describe('GET /api/scheduler/jobs', () => {
    it('returns the list of repeatable jobs', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/scheduler/jobs',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.jobs).toBeDefined();
      expect(Array.isArray(body.jobs)).toBe(true);
      expect(body.jobs.length).toBe(2);
      expect(body.jobs[0].key).toBe('heartbeat:agent-1');
      expect(body.jobs[0].name).toBe('agent:heartbeat');
      expect(body.jobs[0].every).toBe('30000');
      expect(body.jobs[1].key).toBe('cron:agent-2');
      expect(body.jobs[1].pattern).toBe('*/5 * * * *');
      expect(mockManager.listRepeatableJobs).toHaveBeenCalled();
    });

    it('returns 500 when listRepeatableJobs throws ControlPlaneError', async () => {
      vi.mocked(mockManager.listRepeatableJobs).mockRejectedValueOnce(
        new ControlPlaneError('REPEATABLE_JOB_LIST_FAILED', 'Redis connection lost', {}),
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/scheduler/jobs',
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.error).toBe('REPEATABLE_JOB_LIST_FAILED');
    });

    it('returns 500 when listRepeatableJobs throws unexpected error', async () => {
      vi.mocked(mockManager.listRepeatableJobs).mockRejectedValueOnce(new Error('unexpected'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/scheduler/jobs',
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.message).toBe('Failed to list repeatable jobs');
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/scheduler/jobs/heartbeat — Add a heartbeat job
  // -------------------------------------------------------------------------

  describe('POST /api/scheduler/jobs/heartbeat', () => {
    it('adds a heartbeat job with valid input', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/scheduler/jobs/heartbeat',
        payload: {
          agentId: 'agent-1',
          machineId: 'ec2-us-east-1',
          intervalMs: 30000,
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.agentId).toBe('agent-1');
      expect(body.machineId).toBe('ec2-us-east-1');
      expect(body.intervalMs).toBe(30000);
      expect(mockManager.addHeartbeatJob).toHaveBeenCalledWith(
        'agent-1',
        30000,
        expect.objectContaining({
          agentId: 'agent-1',
          machineId: 'ec2-us-east-1',
          trigger: 'heartbeat',
        }),
      );
    });

    it('returns 400 when agentId is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/scheduler/jobs/heartbeat',
        payload: {
          machineId: 'ec2-us-east-1',
          intervalMs: 30000,
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_AGENT_ID');
    });

    it('returns 400 when machineId is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/scheduler/jobs/heartbeat',
        payload: {
          agentId: 'agent-1',
          intervalMs: 30000,
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_MACHINE_ID');
    });

    it('returns 400 when intervalMs is not a positive number', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/scheduler/jobs/heartbeat',
        payload: {
          agentId: 'agent-1',
          machineId: 'ec2-us-east-1',
          intervalMs: -100,
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_INTERVAL');
    });

    it('returns 400 when intervalMs is zero', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/scheduler/jobs/heartbeat',
        payload: {
          agentId: 'agent-1',
          machineId: 'ec2-us-east-1',
          intervalMs: 0,
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_INTERVAL');
    });

    it('returns 400 when intervalMs is not a number', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/scheduler/jobs/heartbeat',
        payload: {
          agentId: 'agent-1',
          machineId: 'ec2-us-east-1',
          intervalMs: 'not-a-number',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_INTERVAL');
    });

    it('returns 500 when addHeartbeatJob throws ControlPlaneError', async () => {
      vi.mocked(mockManager.addHeartbeatJob).mockRejectedValueOnce(
        new ControlPlaneError('HEARTBEAT_JOB_ADD_FAILED', 'Queue error', {}),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/scheduler/jobs/heartbeat',
        payload: {
          agentId: 'agent-1',
          machineId: 'ec2-us-east-1',
          intervalMs: 30000,
        },
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.error).toBe('HEARTBEAT_JOB_ADD_FAILED');
    });

    it('returns 500 when addHeartbeatJob throws unexpected error', async () => {
      vi.mocked(mockManager.addHeartbeatJob).mockRejectedValueOnce(new Error('unexpected'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/scheduler/jobs/heartbeat',
        payload: {
          agentId: 'agent-1',
          machineId: 'ec2-us-east-1',
          intervalMs: 30000,
        },
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.message).toBe('Failed to add heartbeat job');
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/scheduler/jobs/cron — Add a cron job
  // -------------------------------------------------------------------------

  describe('POST /api/scheduler/jobs/cron', () => {
    it('adds a cron job with valid input', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/scheduler/jobs/cron',
        payload: {
          agentId: 'agent-2',
          machineId: 'mac-mini-studio',
          pattern: '*/5 * * * *',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.agentId).toBe('agent-2');
      expect(body.machineId).toBe('mac-mini-studio');
      expect(body.pattern).toBe('*/5 * * * *');
      expect(body.model).toBeNull();
      expect(mockManager.addCronJob).toHaveBeenCalledWith(
        'agent-2',
        '*/5 * * * *',
        expect.objectContaining({
          agentId: 'agent-2',
          machineId: 'mac-mini-studio',
          trigger: 'schedule',
          model: null,
        }),
      );
    });

    it('adds a cron job with optional model', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/scheduler/jobs/cron',
        payload: {
          agentId: 'agent-2',
          machineId: 'mac-mini-studio',
          pattern: '0 */6 * * *',
          model: 'claude-sonnet-4-20250514',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.model).toBe('claude-sonnet-4-20250514');
      expect(mockManager.addCronJob).toHaveBeenCalledWith(
        'agent-2',
        '0 */6 * * *',
        expect.objectContaining({
          model: 'claude-sonnet-4-20250514',
        }),
      );
    });

    it('returns 400 when agentId is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/scheduler/jobs/cron',
        payload: {
          machineId: 'mac-mini-studio',
          pattern: '*/5 * * * *',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_AGENT_ID');
    });

    it('returns 400 when machineId is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/scheduler/jobs/cron',
        payload: {
          agentId: 'agent-2',
          pattern: '*/5 * * * *',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_MACHINE_ID');
    });

    it('returns 400 when pattern is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/scheduler/jobs/cron',
        payload: {
          agentId: 'agent-2',
          machineId: 'mac-mini-studio',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_CRON_PATTERN');
    });

    it('returns 400 when pattern is empty string', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/scheduler/jobs/cron',
        payload: {
          agentId: 'agent-2',
          machineId: 'mac-mini-studio',
          pattern: '',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_CRON_PATTERN');
    });

    it('returns 500 when addCronJob throws ControlPlaneError', async () => {
      vi.mocked(mockManager.addCronJob).mockRejectedValueOnce(
        new ControlPlaneError('CRON_JOB_ADD_FAILED', 'Queue error', {}),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/scheduler/jobs/cron',
        payload: {
          agentId: 'agent-2',
          machineId: 'mac-mini-studio',
          pattern: '*/5 * * * *',
        },
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.error).toBe('CRON_JOB_ADD_FAILED');
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /api/scheduler/jobs/:key — Remove a specific job
  // -------------------------------------------------------------------------

  describe('DELETE /api/scheduler/jobs/:key', () => {
    it('removes a job by key and returns removed count', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/scheduler/jobs/agent-1',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.key).toBe('agent-1');
      expect(body.removedCount).toBe(1);
      expect(mockManager.removeJobsByAgentId).toHaveBeenCalledWith('agent-1');
    });

    it('returns 500 when removeJobsByAgentId throws ControlPlaneError', async () => {
      vi.mocked(mockManager.removeJobsByAgentId).mockRejectedValueOnce(
        new ControlPlaneError('REPEATABLE_JOB_REMOVE_FAILED', 'Redis error', {}),
      );

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/scheduler/jobs/agent-1',
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.error).toBe('REPEATABLE_JOB_REMOVE_FAILED');
    });

    it('returns 500 when removeJobsByAgentId throws unexpected error', async () => {
      vi.mocked(mockManager.removeJobsByAgentId).mockRejectedValueOnce(new Error('unexpected'));

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/scheduler/jobs/agent-1',
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.message).toBe('Failed to remove repeatable job');
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /api/scheduler/jobs — Remove ALL repeatable jobs
  // -------------------------------------------------------------------------

  describe('DELETE /api/scheduler/jobs', () => {
    it('removes all jobs when confirm=true', async () => {
      vi.mocked(mockManager.listRepeatableJobs).mockResolvedValueOnce(SAMPLE_JOBS);
      vi.mocked(mockManager.removeJobsByAgentId).mockResolvedValue(1);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/scheduler/jobs?confirm=true',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.removedCount).toBeGreaterThanOrEqual(0);
    });

    it('returns 400 when confirm param is missing', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/scheduler/jobs',
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('CONFIRMATION_REQUIRED');
    });

    it('returns 400 when confirm param is not "true"', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/scheduler/jobs?confirm=false',
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('CONFIRMATION_REQUIRED');
    });

    it('returns 500 when listRepeatableJobs throws during removeAll', async () => {
      vi.mocked(mockManager.listRepeatableJobs).mockRejectedValueOnce(
        new ControlPlaneError('REPEATABLE_JOB_LIST_FAILED', 'Redis error', {}),
      );

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/scheduler/jobs?confirm=true',
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.error).toBe('REPEATABLE_JOB_LIST_FAILED');
    });
  });
});

// =============================================================================
// Tests WITHOUT repeatableJobManager (null — routes should return 501)
// =============================================================================

describe('Scheduler routes — /api/scheduler (not configured)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({ logger });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/scheduler/jobs returns 501', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/scheduler/jobs',
    });

    expect(response.statusCode).toBe(501);

    const body = response.json();
    expect(body.error).toBe('SCHEDULER_NOT_CONFIGURED');
  });

  it('POST /api/scheduler/jobs/heartbeat returns 501', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/scheduler/jobs/heartbeat',
      payload: {
        agentId: 'agent-1',
        machineId: 'ec2-us-east-1',
        intervalMs: 30000,
      },
    });

    expect(response.statusCode).toBe(501);

    const body = response.json();
    expect(body.error).toBe('SCHEDULER_NOT_CONFIGURED');
  });

  it('POST /api/scheduler/jobs/cron returns 501', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/scheduler/jobs/cron',
      payload: {
        agentId: 'agent-2',
        machineId: 'mac-mini-studio',
        pattern: '*/5 * * * *',
      },
    });

    expect(response.statusCode).toBe(501);

    const body = response.json();
    expect(body.error).toBe('SCHEDULER_NOT_CONFIGURED');
  });

  it('DELETE /api/scheduler/jobs/some-key returns 501', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/scheduler/jobs/some-key',
    });

    expect(response.statusCode).toBe(501);

    const body = response.json();
    expect(body.error).toBe('SCHEDULER_NOT_CONFIGURED');
  });

  it('DELETE /api/scheduler/jobs?confirm=true returns 501', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/scheduler/jobs?confirm=true',
    });

    expect(response.statusCode).toBe(501);

    const body = response.json();
    expect(body.error).toBe('SCHEDULER_NOT_CONFIGURED');
  });
});
