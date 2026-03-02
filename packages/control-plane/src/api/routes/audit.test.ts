import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbAgentRegistry } from '../../registry/db-registry.js';
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

function createMockDbRegistry(overrides: Partial<DbAgentRegistry> = {}): DbAgentRegistry {
  return {
    registerMachine: vi.fn(),
    heartbeat: vi.fn(),
    listMachines: vi.fn().mockResolvedValue([]),
    createAgent: vi.fn().mockResolvedValue('agent-new'),
    getAgent: vi.fn().mockResolvedValue(undefined),
    updateAgentStatus: vi.fn(),
    listAgents: vi.fn().mockResolvedValue([]),
    getRecentRuns: vi.fn().mockResolvedValue([]),
    completeRun: vi.fn(),
    createRun: vi.fn().mockResolvedValue('run-001'),
    insertActions: vi.fn().mockResolvedValue(3),
    getMachine: vi.fn(),
    ...overrides,
  } as unknown as DbAgentRegistry;
}

// =============================================================================
// Tests WITH dbRegistry configured — audit routes are registered
// =============================================================================

describe('Audit routes — /api/audit (configured)', () => {
  let app: FastifyInstance;
  let mockDbRegistry: DbAgentRegistry;

  beforeAll(async () => {
    mockDbRegistry = createMockDbRegistry();
    app = await createServer({ logger, dbRegistry: mockDbRegistry });
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default mock implementations after clearAllMocks
    vi.mocked(mockDbRegistry.insertActions).mockResolvedValue(3);
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // POST /api/audit/actions — Happy path
  // ---------------------------------------------------------------------------

  describe('POST /api/audit/actions — happy path', () => {
    it('ingests a batch of actions and returns insertedCount', async () => {
      vi.mocked(mockDbRegistry.insertActions).mockResolvedValueOnce(2);

      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-001',
          actions: [
            { actionType: 'tool_use', toolName: 'Read', durationMs: 150 },
            { actionType: 'tool_use', toolName: 'Write', durationMs: 200 },
          ],
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.insertedCount).toBe(2);
    });

    it('calls dbRegistry.insertActions with the correct arguments', async () => {
      const actions = [
        {
          actionType: 'tool_use',
          toolName: 'Bash',
          toolInput: { command: 'ls' },
          toolOutputHash: 'sha256-abc123',
          durationMs: 500,
          approvedBy: 'user-1',
        },
      ];

      await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: { runId: 'run-xyz', actions },
      });

      expect(mockDbRegistry.insertActions).toHaveBeenCalledWith('run-xyz', actions);
    });

    it('accepts actions with only the required actionType field', async () => {
      vi.mocked(mockDbRegistry.insertActions).mockResolvedValueOnce(1);

      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-002',
          actions: [{ actionType: 'agent_start' }],
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.insertedCount).toBe(1);
    });

    it('accepts actions with null optional fields', async () => {
      vi.mocked(mockDbRegistry.insertActions).mockResolvedValueOnce(1);

      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-003',
          actions: [
            {
              actionType: 'tool_use',
              toolName: null,
              toolInput: null,
              toolOutputHash: null,
              durationMs: null,
              approvedBy: null,
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/audit/actions — Validation errors
  // ---------------------------------------------------------------------------

  describe('POST /api/audit/actions — validation', () => {
    it('returns 400 when runId is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          actions: [{ actionType: 'tool_use' }],
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toMatch(/runId/i);
    });

    it('returns 400 when runId is an empty string', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: '',
          actions: [{ actionType: 'tool_use' }],
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toMatch(/runId/i);
    });

    it('returns 400 when runId is not a string', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 12345,
          actions: [{ actionType: 'tool_use' }],
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toMatch(/runId/i);
    });

    it('returns 400 when actions is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-001',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toMatch(/actions/i);
    });

    it('returns 400 when actions is an empty array', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-001',
          actions: [],
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toMatch(/actions/i);
    });

    it('returns 400 when actions is not an array', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-001',
          actions: 'not-an-array',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toMatch(/actions/i);
    });

    it('returns 400 when batch size exceeds maximum of 1000', async () => {
      const oversizedActions = Array.from({ length: 1001 }, (_, i) => ({
        actionType: `action-${i}`,
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-001',
          actions: oversizedActions,
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toMatch(/1001/);
      expect(body.error).toMatch(/1000/);
      expect(body.code).toBe('BATCH_SIZE_EXCEEDED');
    });

    it('accepts exactly 1000 actions (boundary)', async () => {
      vi.mocked(mockDbRegistry.insertActions).mockResolvedValueOnce(1000);

      const maxActions = Array.from({ length: 1000 }, (_, i) => ({
        actionType: `action-${i}`,
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-boundary',
          actions: maxActions,
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.insertedCount).toBe(1000);
    });

    it('returns 400 when an action has missing actionType', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-001',
          actions: [{ toolName: 'Read' }],
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toMatch(/actionType/i);
    });

    it('returns 400 when an action has empty string actionType', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-001',
          actions: [{ actionType: '' }],
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toMatch(/actionType/i);
    });

    it('returns 400 when an action has non-string actionType', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-001',
          actions: [{ actionType: 42 }],
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toMatch(/actionType/i);
    });

    it('returns 400 on first invalid action in a mixed batch', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-001',
          actions: [
            { actionType: 'tool_use', toolName: 'Read' },
            { actionType: '' }, // invalid
            { actionType: 'tool_use', toolName: 'Write' },
          ],
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toMatch(/actionType/i);

      // dbRegistry.insertActions should NOT have been called
      expect(mockDbRegistry.insertActions).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/audit/actions — Error handling
  // ---------------------------------------------------------------------------

  describe('POST /api/audit/actions — error handling', () => {
    it('returns 502 when dbRegistry throws ControlPlaneError', async () => {
      vi.mocked(mockDbRegistry.insertActions).mockRejectedValueOnce(
        new ControlPlaneError(
          'AUDIT_INSERT_FAILED',
          'Failed to insert audit actions: connection refused',
          {
            runId: 'run-001',
            actionCount: 1,
          },
        ),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-001',
          actions: [{ actionType: 'tool_use' }],
        },
      });

      expect(response.statusCode).toBe(502);

      const body = response.json();
      expect(body.code).toBe('AUDIT_INSERT_FAILED');
      expect(body.error).toMatch(/insert/i);
    });

    it('returns 500 when dbRegistry throws an unexpected error', async () => {
      vi.mocked(mockDbRegistry.insertActions).mockRejectedValueOnce(new Error('connection reset'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-001',
          actions: [{ actionType: 'tool_use' }],
        },
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.error).toBe('Failed to ingest audit actions');
    });

    it('returns 500 when dbRegistry throws a non-Error value', async () => {
      vi.mocked(mockDbRegistry.insertActions).mockRejectedValueOnce('string error');

      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-001',
          actions: [{ actionType: 'tool_use' }],
        },
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.error).toBe('Failed to ingest audit actions');
    });
  });
});

// =============================================================================
// Tests WITHOUT dbRegistry — audit routes are NOT registered (404)
// =============================================================================

describe('Audit routes — /api/audit (not configured)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({ logger });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/audit/actions returns 404 when dbRegistry is not provided', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/audit/actions',
      payload: {
        runId: 'run-001',
        actions: [{ actionType: 'tool_use' }],
      },
    });

    expect(response.statusCode).toBe(404);
  });
});
