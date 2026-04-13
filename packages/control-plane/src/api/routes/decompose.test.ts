import type { DecompositionResponse, DecompositionResult } from '@agentctl/shared';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskDecomposer } from '../../intelligence/task-decomposer.js';
import { decomposeRoutes } from './decompose.js';

// ── Mock TaskDecomposer ──────────────────────────────────────────

const MOCK_RESULT: DecompositionResult = {
  tasks: [
    {
      tempId: 't1',
      type: 'task',
      name: 'Build auth',
      description: 'Implement OAuth',
      requiredCapabilities: ['typescript'],
      estimatedTokens: 50_000,
      timeoutMs: 3_600_000,
    },
  ],
  edges: [],
  suggestedApprovalGates: [],
  reasoning: 'Single task decomposition',
  estimatedTotalTokens: 50_000,
  estimatedTotalCostUsd: 0.15,
};

const MOCK_RESPONSE: DecompositionResponse = {
  graphId: 'graph-1',
  definitionIdMap: { t1: 'def-1' },
  result: MOCK_RESULT,
  validationErrors: [],
};

function createMockDecomposer(): TaskDecomposer {
  return {
    decompose: vi.fn().mockResolvedValue(MOCK_RESPONSE),
    preview: vi.fn().mockResolvedValue({
      result: MOCK_RESULT,
      validationErrors: [],
    }),
  } as unknown as TaskDecomposer;
}

// ── Tests ────────────────────────────────────────────────────────

describe('decompose routes', () => {
  let app: ReturnType<typeof Fastify>;
  let mockDecomposer: TaskDecomposer;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    mockDecomposer = createMockDecomposer();

    await app.register(decomposeRoutes, {
      prefix: '/api/decompose',
      taskDecomposer: mockDecomposer,
    });

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /api/decompose', () => {
    it('should decompose a valid request and return 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/decompose',
        payload: { description: 'Refactor the auth module' },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.graphId).toBe('graph-1');
      expect(body.result.tasks).toHaveLength(1);
      expect(mockDecomposer.decompose).toHaveBeenCalledWith({
        description: 'Refactor the auth module',
        spaceId: undefined,
        constraints: undefined,
      });
    });

    it('should pass spaceId and constraints through', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/decompose',
        payload: {
          description: 'Build feature',
          spaceId: 'space-1',
          constraints: { maxSubTasks: 5 },
        },
      });

      expect(mockDecomposer.decompose).toHaveBeenCalledWith({
        description: 'Build feature',
        spaceId: 'space-1',
        constraints: { maxSubTasks: 5 },
      });
    });

    it('should return 400 for empty description', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/decompose',
        payload: { description: '' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('INVALID_DESCRIPTION');
    });

    it('should return 400 for missing description', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/decompose',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('INVALID_DESCRIPTION');
    });
  });

  describe('POST /api/decompose/preview', () => {
    it('should preview decomposition and return 200', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/decompose/preview',
        payload: { description: 'Refactor auth' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.result.tasks).toHaveLength(1);
      expect(body.validationErrors).toHaveLength(0);
      expect(mockDecomposer.preview).toHaveBeenCalled();
    });

    it('should return 400 for empty description', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/decompose/preview',
        payload: { description: '   ' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('INVALID_DESCRIPTION');
    });
  });
});

// ---------------------------------------------------------------------------
// Rate limiting — every decompose call triggers an LLM request (token cost
// plus outbound provider traffic). A flood is a direct cost-abuse vector.
// ---------------------------------------------------------------------------

describe('Decompose rate limiting — /api/decompose', () => {
  const originalMax = process.env.DECOMPOSE_RATE_LIMIT_MAX;
  const originalWindow = process.env.DECOMPOSE_RATE_LIMIT_WINDOW_MS;

  beforeAll(() => {
    process.env.DECOMPOSE_RATE_LIMIT_MAX = '3';
    process.env.DECOMPOSE_RATE_LIMIT_WINDOW_MS = '60000';
  });

  afterAll(() => {
    if (originalMax === undefined) delete process.env.DECOMPOSE_RATE_LIMIT_MAX;
    else process.env.DECOMPOSE_RATE_LIMIT_MAX = originalMax;
    if (originalWindow === undefined) delete process.env.DECOMPOSE_RATE_LIMIT_WINDOW_MS;
    else process.env.DECOMPOSE_RATE_LIMIT_WINDOW_MS = originalWindow;
  });

  it('returns 429 after exceeding the configured limit on POST /', async () => {
    const app = Fastify({ logger: false });
    const mockDecomposer = {
      decompose: vi.fn().mockResolvedValue(MOCK_RESPONSE),
      preview: vi.fn().mockResolvedValue({ result: MOCK_RESULT, validationErrors: [] }),
    } as unknown as TaskDecomposer;
    await app.register(decomposeRoutes, {
      prefix: '/api/decompose',
      taskDecomposer: mockDecomposer,
    });
    await app.ready();

    try {
      const payload = { description: 'Refactor auth module' };
      for (let i = 0; i < 3; i += 1) {
        const ok = await app.inject({
          method: 'POST',
          url: '/api/decompose',
          payload,
          headers: { 'x-forwarded-for': '10.0.0.80' },
          remoteAddress: '10.0.0.80',
        });
        expect(ok.statusCode).toBe(201);
      }

      const blocked = await app.inject({
        method: 'POST',
        url: '/api/decompose',
        payload,
        headers: { 'x-forwarded-for': '10.0.0.80' },
        remoteAddress: '10.0.0.80',
      });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error).toBe('RATE_LIMITED');
    } finally {
      await app.close();
    }
  });
});
