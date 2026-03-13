import {
  ControlPlaneError,
  type CrossSpaceQueryResponse,
  type CrossSpaceQueryResultEvent,
  type Space,
} from '@agentctl/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventStore } from '../../collaboration/event-store.js';
import type { SpaceStore } from '../../collaboration/space-store.js';
import { mcpToolsRoutes } from './mcp-tools.js';

// ── Helpers ─────────────────────────────────────────────────

const NOW = new Date().toISOString();

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: 'space-1',
    name: 'Test Space',
    description: 'A space for testing',
    type: 'collaboration',
    visibility: 'team',
    createdBy: 'user-1',
    createdAt: NOW,
    ...overrides,
  };
}

function makeResultEvent(
  overrides: Partial<CrossSpaceQueryResultEvent> = {},
): CrossSpaceQueryResultEvent {
  return {
    id: 'event-1',
    spaceId: 'space-1',
    spaceName: 'Test Space',
    threadId: 'thread-1',
    sequenceNum: 1,
    type: 'message',
    senderType: 'agent',
    senderId: 'agent-1',
    payload: { text: 'Hello world' },
    visibility: 'public',
    createdAt: NOW,
    ...overrides,
  };
}

// ── Test Setup ──────────────────────────────────────────────

describe('mcp-tools routes', () => {
  let app: FastifyInstance;

  const mockEventStore = {
    queryAcrossSpaces: vi.fn().mockResolvedValue({
      events: [makeResultEvent()],
      totalMatched: 1,
    }),
  } as unknown as EventStore;

  const mockSpaceStore = {
    getSpace: vi.fn().mockResolvedValue(makeSpace()),
  } as unknown as SpaceStore;

  beforeAll(async () => {
    app = Fastify();

    // Minimal error handler matching the real server's pattern
    app.setErrorHandler((err, _request, reply) => {
      if (err instanceof ControlPlaneError) {
        return reply.status(500).send({ error: err.code, message: err.message });
      }
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Unexpected error' });
    });

    await app.register(mcpToolsRoutes, {
      prefix: '/api/mcp-tools',
      eventStore: mockEventStore,
      spaceStore: mockSpaceStore,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (mockEventStore.queryAcrossSpaces as ReturnType<typeof vi.fn>).mockResolvedValue({
      events: [makeResultEvent()],
      totalMatched: 1,
    });
    (mockSpaceStore.getSpace as ReturnType<typeof vi.fn>).mockResolvedValue(makeSpace());
  });

  // ── GET /api/mcp-tools/tools ──────────────────────────────

  describe('GET /api/mcp-tools/tools', () => {
    it('returns the list of available MCP tools', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mcp-tools/tools',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].name).toBe('cross_space_query');
      expect(body.tools[0].inputSchema).toBeDefined();
      expect(body.tools[0].inputSchema.required).toContain('spaceIds');
    });
  });

  // ── POST /api/mcp-tools/cross-space-query ─────────────────

  describe('POST /api/mcp-tools/cross-space-query', () => {
    it('returns matching events for valid request', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp-tools/cross-space-query',
        payload: { spaceIds: ['space-1'] },
      });

      expect(res.statusCode).toBe(200);
      const body: CrossSpaceQueryResponse = res.json();
      expect(body.events).toHaveLength(1);
      expect(body.events[0].spaceId).toBe('space-1');
      expect(body.totalMatched).toBe(1);
      expect(body.truncated).toBe(false);
    });

    it('passes all filter parameters to eventStore', async () => {
      const timeRange = { start: '2026-01-01T00:00:00Z', end: '2026-12-31T23:59:59Z' };

      await app.inject({
        method: 'POST',
        url: '/api/mcp-tools/cross-space-query',
        payload: {
          spaceIds: ['space-1'],
          eventTypes: ['message', 'artifact'],
          timeRange,
          textQuery: 'hello',
          limit: 10,
        },
      });

      expect(mockEventStore.queryAcrossSpaces).toHaveBeenCalledWith({
        spaceIds: ['space-1'],
        eventTypes: ['message', 'artifact'],
        timeRange,
        textQuery: 'hello',
        limit: 10,
      });
    });

    it('sets truncated=true when totalMatched exceeds limit', async () => {
      (mockEventStore.queryAcrossSpaces as ReturnType<typeof vi.fn>).mockResolvedValue({
        events: [makeResultEvent()],
        totalMatched: 100,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp-tools/cross-space-query',
        payload: { spaceIds: ['space-1'], limit: 10 },
      });

      const body: CrossSpaceQueryResponse = res.json();
      expect(body.truncated).toBe(true);
      expect(body.totalMatched).toBe(100);
    });

    it('clamps limit to MAX_LIMIT (200)', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/mcp-tools/cross-space-query',
        payload: { spaceIds: ['space-1'], limit: 999 },
      });

      expect(mockEventStore.queryAcrossSpaces).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 200 }),
      );
    });

    // ── Validation errors ───────────────────────────────────

    it('rejects empty spaceIds array', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp-tools/cross-space-query',
        payload: { spaceIds: [] },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_SPACE_IDS');
    });

    it('rejects missing spaceIds', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp-tools/cross-space-query',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_SPACE_IDS');
    });

    it('rejects too many spaceIds', async () => {
      const spaceIds = Array.from({ length: 21 }, (_, i) => `space-${i}`);
      // Mock all spaces as existing
      (mockSpaceStore.getSpace as ReturnType<typeof vi.fn>).mockResolvedValue(makeSpace());

      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp-tools/cross-space-query',
        payload: { spaceIds },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('TOO_MANY_SPACE_IDS');
    });

    it('rejects invalid event type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp-tools/cross-space-query',
        payload: { spaceIds: ['space-1'], eventTypes: ['not-a-type'] },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_EVENT_TYPE');
    });

    it('rejects invalid timeRange.start', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp-tools/cross-space-query',
        payload: { spaceIds: ['space-1'], timeRange: { start: 'not-a-date' } },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_TIME_RANGE_START');
    });

    it('rejects invalid timeRange.end', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp-tools/cross-space-query',
        payload: { spaceIds: ['space-1'], timeRange: { end: 'not-a-date' } },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_TIME_RANGE_END');
    });

    it('rejects negative limit', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp-tools/cross-space-query',
        payload: { spaceIds: ['space-1'], limit: -5 },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_LIMIT');
    });

    // ── Space validation ────────────────────────────────────

    it('returns 404 when a requested space does not exist', async () => {
      (mockSpaceStore.getSpace as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp-tools/cross-space-query',
        payload: { spaceIds: ['nonexistent-space'] },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('SPACES_NOT_FOUND');
    });

    it('lists all missing spaces in the error message', async () => {
      (mockSpaceStore.getSpace as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp-tools/cross-space-query',
        payload: { spaceIds: ['missing-1', 'missing-2'] },
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.message).toContain('missing-1');
      expect(body.message).toContain('missing-2');
    });

    // ── Error handling ──────────────────────────────────────

    it('wraps unexpected errors in a typed ControlPlaneError', async () => {
      (mockEventStore.queryAcrossSpaces as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('DB connection lost'),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp-tools/cross-space-query',
        payload: { spaceIds: ['space-1'] },
      });

      // The global error handler converts ControlPlaneError to 500
      expect(res.statusCode).toBe(500);
      expect(res.json().error).toBe('CROSS_SPACE_QUERY_FAILED');
    });
  });
});
