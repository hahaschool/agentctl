import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContextBridgeStore } from '../../collaboration/context-bridge-store.js';
import type { EventStore } from '../../collaboration/event-store.js';
import type { SpaceStore } from '../../collaboration/space-store.js';

import { contextBridgeRoutes } from './context-bridge.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const NOW = new Date().toISOString();

const TARGET_SPACE_ID = 'space-target-001';
const SOURCE_SPACE_ID = 'space-source-002';
const REF_ID = 'ref-001';
const SUB_ID = 'sub-001';
const THREAD_ID = 'thread-001';

function makeSpace(id: string) {
  return {
    id,
    name: `Space ${id}`,
    description: '',
    type: 'collaboration',
    visibility: 'private',
    createdBy: 'user-1',
    createdAt: NOW,
  };
}

function makeContextRef(overrides: Record<string, unknown> = {}) {
  return {
    id: REF_ID,
    sourceSpaceId: SOURCE_SPACE_ID,
    sourceThreadId: THREAD_ID,
    sourceEventId: null,
    targetSpaceId: TARGET_SPACE_ID,
    targetThreadId: 'thread-target-001',
    mode: 'reference',
    snapshotPayload: null,
    metadata: {},
    createdBy: 'user-1',
    createdAt: NOW,
    ...overrides,
  };
}

function makeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: SUB_ID,
    sourceSpaceId: SOURCE_SPACE_ID,
    targetSpaceId: TARGET_SPACE_ID,
    filterCriteria: {},
    active: true,
    createdBy: 'user-1',
    createdAt: NOW,
    ...overrides,
  };
}

// ── Mock stores ─────────────────────────────────────────────────────────────

function createMockContextBridgeStore(): ContextBridgeStore {
  return {
    createRef: vi.fn(),
    getRef: vi.fn(),
    listRefsByTargetSpace: vi.fn(),
    deleteRef: vi.fn(),
    createSubscription: vi.fn(),
    getSubscription: vi.fn(),
    listSubscriptionsByTarget: vi.fn(),
    updateSubscriptionActive: vi.fn(),
    deleteSubscription: vi.fn(),
  } as unknown as ContextBridgeStore;
}

function createMockSpaceStore(): SpaceStore {
  return {
    getSpace: vi.fn(),
    createSpace: vi.fn(),
    listSpaces: vi.fn(),
    deleteSpace: vi.fn(),
    addMember: vi.fn(),
    removeMember: vi.fn(),
    getMembers: vi.fn(),
    updateMemberFilter: vi.fn(),
  } as unknown as SpaceStore;
}

function createMockEventStore(): EventStore {
  return {
    appendEvent: vi.fn(),
    getEvents: vi.fn(),
    getEventByIdempotencyKey: vi.fn(),
    queryAcrossSpaces: vi.fn(),
  } as unknown as EventStore;
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe('context-bridge routes', () => {
  let app: FastifyInstance;
  let contextBridgeStore: ContextBridgeStore;
  let spaceStore: SpaceStore;
  let eventStore: EventStore;

  beforeEach(async () => {
    contextBridgeStore = createMockContextBridgeStore();
    spaceStore = createMockSpaceStore();
    eventStore = createMockEventStore();

    app = Fastify({ logger: false });
    await app.register(contextBridgeRoutes, {
      prefix: '/api',
      contextBridgeStore,
      spaceStore,
      eventStore,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  // ── POST /:spaceId/context-refs ─────────────────────────────────────────

  describe('POST /api/:spaceId/context-refs', () => {
    const validBody = {
      sourceSpaceId: SOURCE_SPACE_ID,
      targetThreadId: 'thread-target-001',
      mode: 'reference',
      createdBy: 'user-1',
    };

    it('creates a context ref and returns 201', async () => {
      vi.mocked(spaceStore.getSpace)
        .mockResolvedValueOnce(makeSpace(TARGET_SPACE_ID))
        .mockResolvedValueOnce(makeSpace(SOURCE_SPACE_ID));
      vi.mocked(contextBridgeStore.createRef).mockResolvedValueOnce(makeContextRef());

      const res = await app.inject({
        method: 'POST',
        url: `/api/${TARGET_SPACE_ID}/context-refs`,
        payload: validBody,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBe(REF_ID);
      expect(body.mode).toBe('reference');
    });

    it('passes optional fields to createRef', async () => {
      const withOptionals = {
        ...validBody,
        sourceThreadId: THREAD_ID,
        sourceEventId: 'event-001',
        snapshotPayload: { key: 'value' },
        metadata: { tag: 'test' },
      };

      vi.mocked(spaceStore.getSpace)
        .mockResolvedValueOnce(makeSpace(TARGET_SPACE_ID))
        .mockResolvedValueOnce(makeSpace(SOURCE_SPACE_ID));
      vi.mocked(contextBridgeStore.createRef).mockResolvedValueOnce(
        makeContextRef({ snapshotPayload: { key: 'value' } }),
      );

      const res = await app.inject({
        method: 'POST',
        url: `/api/${TARGET_SPACE_ID}/context-refs`,
        payload: withOptionals,
      });

      expect(res.statusCode).toBe(201);
      expect(vi.mocked(contextBridgeStore.createRef)).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceThreadId: THREAD_ID,
          sourceEventId: 'event-001',
          snapshotPayload: { key: 'value' },
          metadata: { tag: 'test' },
        }),
      );
    });

    it('returns 404 when target space not found', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'POST',
        url: `/api/${TARGET_SPACE_ID}/context-refs`,
        payload: validBody,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('SPACE_NOT_FOUND');
    });

    it('returns 400 when source space not found', async () => {
      vi.mocked(spaceStore.getSpace)
        .mockResolvedValueOnce(makeSpace(TARGET_SPACE_ID))
        .mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'POST',
        url: `/api/${TARGET_SPACE_ID}/context-refs`,
        payload: validBody,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('SOURCE_SPACE_NOT_FOUND');
    });

    it('returns 400 when mode is invalid', async () => {
      vi.mocked(spaceStore.getSpace)
        .mockResolvedValueOnce(makeSpace(TARGET_SPACE_ID))
        .mockResolvedValueOnce(makeSpace(SOURCE_SPACE_ID));

      const res = await app.inject({
        method: 'POST',
        url: `/api/${TARGET_SPACE_ID}/context-refs`,
        payload: { ...validBody, mode: 'invalid-mode' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_MODE');
    });

    it('returns 400 when createdBy is empty', async () => {
      vi.mocked(spaceStore.getSpace)
        .mockResolvedValueOnce(makeSpace(TARGET_SPACE_ID))
        .mockResolvedValueOnce(makeSpace(SOURCE_SPACE_ID));

      const res = await app.inject({
        method: 'POST',
        url: `/api/${TARGET_SPACE_ID}/context-refs`,
        payload: { ...validBody, createdBy: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_CREATED_BY');
    });

    it('returns 400 when targetThreadId is empty', async () => {
      vi.mocked(spaceStore.getSpace)
        .mockResolvedValueOnce(makeSpace(TARGET_SPACE_ID))
        .mockResolvedValueOnce(makeSpace(SOURCE_SPACE_ID));

      const res = await app.inject({
        method: 'POST',
        url: `/api/${TARGET_SPACE_ID}/context-refs`,
        payload: { ...validBody, targetThreadId: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_TARGET_THREAD_ID');
    });

    it('accepts all valid mode values', async () => {
      const validModes = ['reference', 'copy', 'query', 'subscription'];

      for (const mode of validModes) {
        vi.mocked(spaceStore.getSpace)
          .mockResolvedValueOnce(makeSpace(TARGET_SPACE_ID))
          .mockResolvedValueOnce(makeSpace(SOURCE_SPACE_ID));
        vi.mocked(contextBridgeStore.createRef).mockResolvedValueOnce(makeContextRef({ mode }));

        const res = await app.inject({
          method: 'POST',
          url: `/api/${TARGET_SPACE_ID}/context-refs`,
          payload: { ...validBody, mode },
        });

        expect(res.statusCode).toBe(201);
      }
    });
  });

  // ── GET /:spaceId/context-refs ───────────────────────────────────────────

  describe('GET /api/:spaceId/context-refs', () => {
    it('returns list of context refs for a space', async () => {
      const refs = [makeContextRef(), makeContextRef({ id: 'ref-002' })];
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(makeSpace(TARGET_SPACE_ID));
      vi.mocked(contextBridgeStore.listRefsByTargetSpace).mockResolvedValueOnce(refs);

      const res = await app.inject({
        method: 'GET',
        url: `/api/${TARGET_SPACE_ID}/context-refs`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(2);
    });

    it('returns empty array when no refs exist', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(makeSpace(TARGET_SPACE_ID));
      vi.mocked(contextBridgeStore.listRefsByTargetSpace).mockResolvedValueOnce([]);

      const res = await app.inject({
        method: 'GET',
        url: `/api/${TARGET_SPACE_ID}/context-refs`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(0);
    });

    it('returns 404 when space not found', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'GET',
        url: `/api/${TARGET_SPACE_ID}/context-refs`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('SPACE_NOT_FOUND');
    });
  });

  // ── GET /:spaceId/context-refs/budgeted ─────────────────────────────────

  describe('GET /api/:spaceId/context-refs/budgeted', () => {
    it('returns budgeted refs with defaults when no query params', async () => {
      const refs = [makeContextRef()];
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(makeSpace(TARGET_SPACE_ID));
      vi.mocked(contextBridgeStore.listRefsByTargetSpace).mockResolvedValueOnce(refs);

      const res = await app.inject({
        method: 'GET',
        url: `/api/${TARGET_SPACE_ID}/context-refs/budgeted`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('refs');
      expect(body).toHaveProperty('excluded');
      expect(body).toHaveProperty('budget');
    });

    it('applies perSpaceLimit and totalLimit from query params', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(makeSpace(TARGET_SPACE_ID));
      vi.mocked(contextBridgeStore.listRefsByTargetSpace).mockResolvedValueOnce([]);

      const res = await app.inject({
        method: 'GET',
        url: `/api/${TARGET_SPACE_ID}/context-refs/budgeted?perSpaceLimit=1000&totalLimit=5000`,
      });

      expect(res.statusCode).toBe(200);
    });

    it('accepts valid overflowStrategy values', async () => {
      const strategies = ['truncate', 'prioritize', 'reject'];

      for (const overflowStrategy of strategies) {
        vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(makeSpace(TARGET_SPACE_ID));
        vi.mocked(contextBridgeStore.listRefsByTargetSpace).mockResolvedValueOnce([]);

        const res = await app.inject({
          method: 'GET',
          url: `/api/${TARGET_SPACE_ID}/context-refs/budgeted?overflowStrategy=${overflowStrategy}`,
        });

        expect(res.statusCode).toBe(200);
      }
    });

    it('returns 404 when space not found', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'GET',
        url: `/api/${TARGET_SPACE_ID}/context-refs/budgeted`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('SPACE_NOT_FOUND');
    });

    it('returns 400 for invalid overflowStrategy', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(makeSpace(TARGET_SPACE_ID));

      const res = await app.inject({
        method: 'GET',
        url: `/api/${TARGET_SPACE_ID}/context-refs/budgeted?overflowStrategy=bad-value`,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_OVERFLOW_STRATEGY');
    });

    it('returns 400 when perSpaceLimit is negative', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(makeSpace(TARGET_SPACE_ID));

      const res = await app.inject({
        method: 'GET',
        url: `/api/${TARGET_SPACE_ID}/context-refs/budgeted?perSpaceLimit=-1`,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_PER_SPACE_LIMIT');
    });

    it('returns 400 when totalLimit is negative', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(makeSpace(TARGET_SPACE_ID));

      const res = await app.inject({
        method: 'GET',
        url: `/api/${TARGET_SPACE_ID}/context-refs/budgeted?totalLimit=-5`,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_TOTAL_LIMIT');
    });

    it('returns 400 when perSpaceLimit is NaN', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(makeSpace(TARGET_SPACE_ID));

      const res = await app.inject({
        method: 'GET',
        url: `/api/${TARGET_SPACE_ID}/context-refs/budgeted?perSpaceLimit=not-a-number`,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_PER_SPACE_LIMIT');
    });

    it('returns 400 when totalLimit is NaN', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(makeSpace(TARGET_SPACE_ID));

      const res = await app.inject({
        method: 'GET',
        url: `/api/${TARGET_SPACE_ID}/context-refs/budgeted?totalLimit=abc`,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_TOTAL_LIMIT');
    });
  });

  // ── GET /:spaceId/context-refs/:refId/resolve ────────────────────────────

  describe('GET /api/:spaceId/context-refs/:refId/resolve', () => {
    it('resolves a copy mode ref from snapshot payload', async () => {
      const snapshotRef = makeContextRef({
        mode: 'copy',
        snapshotPayload: { content: 'frozen snapshot' },
      });
      vi.mocked(contextBridgeStore.getRef).mockResolvedValueOnce(snapshotRef);

      const res = await app.inject({
        method: 'GET',
        url: `/api/${TARGET_SPACE_ID}/context-refs/${REF_ID}/resolve`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ref.mode).toBe('copy');
      expect(body.resolved).toEqual({ content: 'frozen snapshot' });
      expect(body.resolvedAt).toBeDefined();
    });

    it('resolves a reference mode ref by fetching live events', async () => {
      const referenceRef = makeContextRef({ mode: 'reference', sourceThreadId: THREAD_ID });
      const events = [{ id: 'evt-1', type: 'message' }];

      vi.mocked(contextBridgeStore.getRef).mockResolvedValueOnce(referenceRef);
      vi.mocked(eventStore.getEvents).mockResolvedValueOnce(events as never);

      const res = await app.inject({
        method: 'GET',
        url: `/api/${TARGET_SPACE_ID}/context-refs/${REF_ID}/resolve`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ref.mode).toBe('reference');
      expect(body.resolved).toEqual(events);
      expect(vi.mocked(eventStore.getEvents)).toHaveBeenCalledWith(THREAD_ID, { limit: 100 });
    });

    it('returns 502 when source thread is unavailable for reference mode', async () => {
      const referenceRef = makeContextRef({ mode: 'reference', sourceThreadId: THREAD_ID });

      vi.mocked(contextBridgeStore.getRef).mockResolvedValueOnce(referenceRef);
      vi.mocked(eventStore.getEvents).mockRejectedValueOnce(new Error('DB connection failed'));

      const res = await app.inject({
        method: 'GET',
        url: `/api/${TARGET_SPACE_ID}/context-refs/${REF_ID}/resolve`,
      });

      expect(res.statusCode).toBe(502);
      expect(res.json().error).toBe('SOURCE_UNAVAILABLE');
    });

    it('resolves a query mode ref with a hint', async () => {
      const queryRef = makeContextRef({ mode: 'query', sourceThreadId: null });
      vi.mocked(contextBridgeStore.getRef).mockResolvedValueOnce(queryRef);

      const res = await app.inject({
        method: 'GET',
        url: `/api/${TARGET_SPACE_ID}/context-refs/${REF_ID}/resolve`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.resolved).toBeNull();
      expect(body.hint).toContain('cross_space_query');
    });

    it('resolves a subscription mode ref with a hint', async () => {
      const subRef = makeContextRef({ mode: 'subscription', sourceThreadId: null });
      vi.mocked(contextBridgeStore.getRef).mockResolvedValueOnce(subRef);

      const res = await app.inject({
        method: 'GET',
        url: `/api/${TARGET_SPACE_ID}/context-refs/${REF_ID}/resolve`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.resolved).toBeNull();
      expect(body.hint).toContain('Subscription');
    });

    it('returns 404 when ref does not exist', async () => {
      vi.mocked(contextBridgeStore.getRef).mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'GET',
        url: `/api/${TARGET_SPACE_ID}/context-refs/${REF_ID}/resolve`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('CONTEXT_REF_NOT_FOUND');
    });

    it('returns 404 when ref belongs to a different space', async () => {
      const refForOtherSpace = makeContextRef({ targetSpaceId: 'space-other' });
      vi.mocked(contextBridgeStore.getRef).mockResolvedValueOnce(refForOtherSpace);

      const res = await app.inject({
        method: 'GET',
        url: `/api/${TARGET_SPACE_ID}/context-refs/${REF_ID}/resolve`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('CONTEXT_REF_NOT_FOUND');
    });
  });

  // ── DELETE /:spaceId/context-refs/:refId ────────────────────────────────

  describe('DELETE /api/:spaceId/context-refs/:refId', () => {
    it('deletes a context ref and returns ok', async () => {
      vi.mocked(contextBridgeStore.getRef).mockResolvedValueOnce(makeContextRef());
      vi.mocked(contextBridgeStore.deleteRef).mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/${TARGET_SPACE_ID}/context-refs/${REF_ID}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
    });

    it('returns 404 when ref does not exist', async () => {
      vi.mocked(contextBridgeStore.getRef).mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/${TARGET_SPACE_ID}/context-refs/${REF_ID}`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('CONTEXT_REF_NOT_FOUND');
    });

    it('returns 404 when ref belongs to a different space', async () => {
      const refForOtherSpace = makeContextRef({ targetSpaceId: 'space-other' });
      vi.mocked(contextBridgeStore.getRef).mockResolvedValueOnce(refForOtherSpace);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/${TARGET_SPACE_ID}/context-refs/${REF_ID}`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('CONTEXT_REF_NOT_FOUND');
    });

    it('returns 404 when deleteRef throws CONTEXT_REF_NOT_FOUND', async () => {
      vi.mocked(contextBridgeStore.getRef).mockResolvedValueOnce(makeContextRef());
      vi.mocked(contextBridgeStore.deleteRef).mockRejectedValueOnce(
        new ControlPlaneError('CONTEXT_REF_NOT_FOUND', 'not found'),
      );

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/${TARGET_SPACE_ID}/context-refs/${REF_ID}`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('CONTEXT_REF_NOT_FOUND');
    });

    it('rethrows unexpected errors from deleteRef', async () => {
      vi.mocked(contextBridgeStore.getRef).mockResolvedValueOnce(makeContextRef());
      vi.mocked(contextBridgeStore.deleteRef).mockRejectedValueOnce(new Error('DB crash'));

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/${TARGET_SPACE_ID}/context-refs/${REF_ID}`,
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /:spaceId/subscriptions ─────────────────────────────────────────

  describe('POST /api/:spaceId/subscriptions', () => {
    const validBody = {
      sourceSpaceId: SOURCE_SPACE_ID,
      createdBy: 'user-1',
    };

    it('creates a subscription and returns 201', async () => {
      vi.mocked(spaceStore.getSpace)
        .mockResolvedValueOnce(makeSpace(TARGET_SPACE_ID))
        .mockResolvedValueOnce(makeSpace(SOURCE_SPACE_ID));
      vi.mocked(contextBridgeStore.createSubscription).mockResolvedValueOnce(makeSubscription());

      const res = await app.inject({
        method: 'POST',
        url: `/api/${TARGET_SPACE_ID}/subscriptions`,
        payload: validBody,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBe(SUB_ID);
      expect(body.active).toBe(true);
    });

    it('passes filterCriteria when provided', async () => {
      const withFilter = {
        ...validBody,
        filterCriteria: { eventType: 'message' },
      };

      vi.mocked(spaceStore.getSpace)
        .mockResolvedValueOnce(makeSpace(TARGET_SPACE_ID))
        .mockResolvedValueOnce(makeSpace(SOURCE_SPACE_ID));
      vi.mocked(contextBridgeStore.createSubscription).mockResolvedValueOnce(
        makeSubscription({ filterCriteria: { eventType: 'message' } }),
      );

      const res = await app.inject({
        method: 'POST',
        url: `/api/${TARGET_SPACE_ID}/subscriptions`,
        payload: withFilter,
      });

      expect(res.statusCode).toBe(201);
      expect(vi.mocked(contextBridgeStore.createSubscription)).toHaveBeenCalledWith(
        expect.objectContaining({ filterCriteria: { eventType: 'message' } }),
      );
    });

    it('returns 404 when target space not found', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'POST',
        url: `/api/${TARGET_SPACE_ID}/subscriptions`,
        payload: validBody,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('SPACE_NOT_FOUND');
    });

    it('returns 400 when source space not found', async () => {
      vi.mocked(spaceStore.getSpace)
        .mockResolvedValueOnce(makeSpace(TARGET_SPACE_ID))
        .mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'POST',
        url: `/api/${TARGET_SPACE_ID}/subscriptions`,
        payload: validBody,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('SOURCE_SPACE_NOT_FOUND');
    });

    it('returns 400 when createdBy is empty', async () => {
      vi.mocked(spaceStore.getSpace)
        .mockResolvedValueOnce(makeSpace(TARGET_SPACE_ID))
        .mockResolvedValueOnce(makeSpace(SOURCE_SPACE_ID));

      const res = await app.inject({
        method: 'POST',
        url: `/api/${TARGET_SPACE_ID}/subscriptions`,
        payload: { ...validBody, createdBy: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_CREATED_BY');
    });
  });

  // ── GET /:spaceId/subscriptions ──────────────────────────────────────────

  describe('GET /api/:spaceId/subscriptions', () => {
    it('returns list of subscriptions for a space', async () => {
      const subs = [makeSubscription(), makeSubscription({ id: 'sub-002' })];
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(makeSpace(TARGET_SPACE_ID));
      vi.mocked(contextBridgeStore.listSubscriptionsByTarget).mockResolvedValueOnce(subs);

      const res = await app.inject({
        method: 'GET',
        url: `/api/${TARGET_SPACE_ID}/subscriptions`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(2);
    });

    it('returns empty array when no subscriptions exist', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(makeSpace(TARGET_SPACE_ID));
      vi.mocked(contextBridgeStore.listSubscriptionsByTarget).mockResolvedValueOnce([]);

      const res = await app.inject({
        method: 'GET',
        url: `/api/${TARGET_SPACE_ID}/subscriptions`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(0);
    });

    it('returns 404 when space not found', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'GET',
        url: `/api/${TARGET_SPACE_ID}/subscriptions`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('SPACE_NOT_FOUND');
    });
  });

  // ── PATCH /:spaceId/subscriptions/:subId ────────────────────────────────

  describe('PATCH /api/:spaceId/subscriptions/:subId', () => {
    it('deactivates an active subscription', async () => {
      const updatedSub = makeSubscription({ active: false });

      vi.mocked(contextBridgeStore.getSubscription).mockResolvedValueOnce(makeSubscription());
      vi.mocked(contextBridgeStore.updateSubscriptionActive).mockResolvedValueOnce(updatedSub);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/${TARGET_SPACE_ID}/subscriptions/${SUB_ID}`,
        payload: { active: false },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().active).toBe(false);
    });

    it('reactivates an inactive subscription', async () => {
      const inactiveSub = makeSubscription({ active: false });
      const reactivated = makeSubscription({ active: true });

      vi.mocked(contextBridgeStore.getSubscription).mockResolvedValueOnce(inactiveSub);
      vi.mocked(contextBridgeStore.updateSubscriptionActive).mockResolvedValueOnce(reactivated);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/${TARGET_SPACE_ID}/subscriptions/${SUB_ID}`,
        payload: { active: true },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().active).toBe(true);
    });

    it('returns 400 when active is not a boolean', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/${TARGET_SPACE_ID}/subscriptions/${SUB_ID}`,
        payload: { active: 'yes' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_ACTIVE');
    });

    it('returns 404 when subscription does not exist', async () => {
      vi.mocked(contextBridgeStore.getSubscription).mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/${TARGET_SPACE_ID}/subscriptions/${SUB_ID}`,
        payload: { active: false },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('SUBSCRIPTION_NOT_FOUND');
    });

    it('returns 404 when subscription belongs to a different space', async () => {
      const subForOtherSpace = makeSubscription({ targetSpaceId: 'space-other' });
      vi.mocked(contextBridgeStore.getSubscription).mockResolvedValueOnce(subForOtherSpace);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/${TARGET_SPACE_ID}/subscriptions/${SUB_ID}`,
        payload: { active: false },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('SUBSCRIPTION_NOT_FOUND');
    });

    it('returns 404 when updateSubscriptionActive throws SUBSCRIPTION_NOT_FOUND', async () => {
      vi.mocked(contextBridgeStore.getSubscription).mockResolvedValueOnce(makeSubscription());
      vi.mocked(contextBridgeStore.updateSubscriptionActive).mockRejectedValueOnce(
        new ControlPlaneError('SUBSCRIPTION_NOT_FOUND', 'not found'),
      );

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/${TARGET_SPACE_ID}/subscriptions/${SUB_ID}`,
        payload: { active: false },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('SUBSCRIPTION_NOT_FOUND');
    });

    it('rethrows unexpected errors from updateSubscriptionActive', async () => {
      vi.mocked(contextBridgeStore.getSubscription).mockResolvedValueOnce(makeSubscription());
      vi.mocked(contextBridgeStore.updateSubscriptionActive).mockRejectedValueOnce(
        new Error('DB crash'),
      );

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/${TARGET_SPACE_ID}/subscriptions/${SUB_ID}`,
        payload: { active: false },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── DELETE /:spaceId/subscriptions/:subId ───────────────────────────────

  describe('DELETE /api/:spaceId/subscriptions/:subId', () => {
    it('deletes a subscription and returns ok', async () => {
      vi.mocked(contextBridgeStore.getSubscription).mockResolvedValueOnce(makeSubscription());
      vi.mocked(contextBridgeStore.deleteSubscription).mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/${TARGET_SPACE_ID}/subscriptions/${SUB_ID}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
    });

    it('returns 404 when subscription does not exist', async () => {
      vi.mocked(contextBridgeStore.getSubscription).mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/${TARGET_SPACE_ID}/subscriptions/${SUB_ID}`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('SUBSCRIPTION_NOT_FOUND');
    });

    it('returns 404 when subscription belongs to a different space', async () => {
      const subForOtherSpace = makeSubscription({ targetSpaceId: 'space-other' });
      vi.mocked(contextBridgeStore.getSubscription).mockResolvedValueOnce(subForOtherSpace);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/${TARGET_SPACE_ID}/subscriptions/${SUB_ID}`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('SUBSCRIPTION_NOT_FOUND');
    });

    it('returns 404 when deleteSubscription throws SUBSCRIPTION_NOT_FOUND', async () => {
      vi.mocked(contextBridgeStore.getSubscription).mockResolvedValueOnce(makeSubscription());
      vi.mocked(contextBridgeStore.deleteSubscription).mockRejectedValueOnce(
        new ControlPlaneError('SUBSCRIPTION_NOT_FOUND', 'not found'),
      );

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/${TARGET_SPACE_ID}/subscriptions/${SUB_ID}`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('SUBSCRIPTION_NOT_FOUND');
    });

    it('rethrows unexpected errors from deleteSubscription', async () => {
      vi.mocked(contextBridgeStore.getSubscription).mockResolvedValueOnce(makeSubscription());
      vi.mocked(contextBridgeStore.deleteSubscription).mockRejectedValueOnce(new Error('DB crash'));

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/${TARGET_SPACE_ID}/subscriptions/${SUB_ID}`,
      });

      expect(res.statusCode).toBe(500);
    });
  });
});
