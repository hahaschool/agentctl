import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContextBridgeStore } from '../../collaboration/context-bridge-store.js';
import type { EventStore } from '../../collaboration/event-store.js';
import type { SpaceStore } from '../../collaboration/space-store.js';
import { contextBridgeRoutes } from './context-bridge.js';

const TARGET_SPACE_ID = 'space-target-00000000-0000-4000-a000-000000000001';
const SOURCE_SPACE_ID = 'space-source-00000000-0000-4000-a000-000000000002';
const TARGET_THREAD_ID = 'thread-target-00000000-0000-4000-a000-000000000003';
const SOURCE_THREAD_ID = 'thread-source-00000000-0000-4000-a000-000000000004';
const REF_ID = 'ref-00000000-0000-4000-a000-000000000005';
const SUBSCRIPTION_ID = 'sub-00000000-0000-4000-a000-000000000006';
const NOW = '2026-03-19T00:00:00.000Z';

function makeSpace(overrides: Record<string, unknown> = {}) {
  return {
    id: TARGET_SPACE_ID,
    name: 'Target Space',
    description: 'Space for context bridge tests',
    type: 'collaboration',
    visibility: 'private',
    createdBy: 'tester',
    createdAt: NOW,
    ...overrides,
  };
}

function makeContextRef(overrides: Record<string, unknown> = {}) {
  return {
    id: REF_ID,
    sourceSpaceId: SOURCE_SPACE_ID,
    sourceThreadId: SOURCE_THREAD_ID,
    sourceEventId: null,
    targetSpaceId: TARGET_SPACE_ID,
    targetThreadId: TARGET_THREAD_ID,
    mode: 'reference',
    snapshotPayload: null,
    metadata: {},
    createdBy: 'tester',
    createdAt: NOW,
    ...overrides,
  };
}

function makeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: SUBSCRIPTION_ID,
    sourceSpaceId: SOURCE_SPACE_ID,
    targetSpaceId: TARGET_SPACE_ID,
    filterCriteria: {},
    active: true,
    createdBy: 'tester',
    createdAt: NOW,
    ...overrides,
  };
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-00000000-0000-4000-a000-000000000010',
    spaceId: SOURCE_SPACE_ID,
    threadId: SOURCE_THREAD_ID,
    sequenceNum: 1,
    type: 'message',
    senderType: 'human',
    senderId: 'tester',
    payload: { text: 'hello from source' },
    visibility: 'public',
    createdAt: NOW,
    ...overrides,
  };
}

function createMockContextBridgeStore(): ContextBridgeStore {
  return {
    createRef: vi.fn().mockResolvedValue(makeContextRef()),
    listRefsByTargetSpace: vi.fn().mockResolvedValue([]),
    getRef: vi.fn().mockResolvedValue(undefined),
    deleteRef: vi.fn().mockResolvedValue(undefined),
    createSubscription: vi.fn().mockResolvedValue(makeSubscription()),
    listSubscriptionsByTarget: vi.fn().mockResolvedValue([]),
    getSubscription: vi.fn().mockResolvedValue(undefined),
    updateSubscriptionActive: vi.fn().mockResolvedValue(makeSubscription()),
    deleteSubscription: vi.fn().mockResolvedValue(undefined),
  } as unknown as ContextBridgeStore;
}

function createMockSpaceStore(): SpaceStore {
  return {
    getSpace: vi
      .fn()
      .mockImplementation(async (spaceId: string) =>
        spaceId === TARGET_SPACE_ID
          ? makeSpace()
          : spaceId === SOURCE_SPACE_ID
            ? makeSpace({ id: SOURCE_SPACE_ID, name: 'Source Space' })
            : undefined,
      ),
  } as unknown as SpaceStore;
}

function createMockEventStore(): EventStore {
  return {
    getEvents: vi.fn().mockResolvedValue([makeEvent()]),
  } as unknown as EventStore;
}

async function buildApp(
  contextBridgeStore: ContextBridgeStore,
  spaceStore: SpaceStore,
  eventStore: EventStore,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(contextBridgeRoutes, {
    prefix: '/api/spaces',
    contextBridgeStore,
    spaceStore,
    eventStore,
  });
  await app.ready();
  return app;
}

describe('contextBridgeRoutes', () => {
  let app: FastifyInstance;
  let contextBridgeStore: ReturnType<typeof createMockContextBridgeStore>;
  let spaceStore: ReturnType<typeof createMockSpaceStore>;
  let eventStore: ReturnType<typeof createMockEventStore>;

  beforeEach(async () => {
    contextBridgeStore = createMockContextBridgeStore();
    spaceStore = createMockSpaceStore();
    eventStore = createMockEventStore();
    app = await buildApp(contextBridgeStore, spaceStore, eventStore);
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  describe('POST /api/spaces/:spaceId/context-refs', () => {
    const validBody = {
      sourceSpaceId: SOURCE_SPACE_ID,
      sourceThreadId: SOURCE_THREAD_ID,
      sourceEventId: 'event-123',
      targetThreadId: TARGET_THREAD_ID,
      mode: 'reference',
      snapshotPayload: { copied: false },
      metadata: { scope: 'thread' },
      createdBy: 'tester',
    };

    it('creates a context ref and normalizes optional defaults', async () => {
      vi.mocked(contextBridgeStore.createRef).mockResolvedValueOnce(
        makeContextRef({
          sourceThreadId: null,
          sourceEventId: null,
          snapshotPayload: null,
          metadata: {},
        }) as never,
      );

      const response = await app.inject({
        method: 'POST',
        url: `/api/spaces/${TARGET_SPACE_ID}/context-refs`,
        payload: {
          sourceSpaceId: SOURCE_SPACE_ID,
          targetThreadId: TARGET_THREAD_ID,
          mode: 'copy',
          createdBy: 'tester',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(contextBridgeStore.createRef).toHaveBeenCalledWith({
        sourceSpaceId: SOURCE_SPACE_ID,
        sourceThreadId: null,
        sourceEventId: null,
        targetSpaceId: TARGET_SPACE_ID,
        targetThreadId: TARGET_THREAD_ID,
        mode: 'copy',
        snapshotPayload: null,
        metadata: {},
        createdBy: 'tester',
      });
    });

    it('returns 404 when the target space does not exist', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/api/spaces/missing-space/context-refs',
        payload: validBody,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: 'SPACE_NOT_FOUND' });
      expect(contextBridgeStore.createRef).not.toHaveBeenCalled();
    });

    it('returns 400 when the source space does not exist', async () => {
      vi.mocked(spaceStore.getSpace)
        .mockResolvedValueOnce(makeSpace() as never)
        .mockResolvedValueOnce(undefined);

      const response = await app.inject({
        method: 'POST',
        url: `/api/spaces/${TARGET_SPACE_ID}/context-refs`,
        payload: validBody,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'SOURCE_SPACE_NOT_FOUND' });
    });

    it('returns 400 for an invalid mode', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/spaces/${TARGET_SPACE_ID}/context-refs`,
        payload: { ...validBody, mode: 'mirror' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'INVALID_MODE' });
    });

    it('returns 400 when createdBy is only whitespace', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/spaces/${TARGET_SPACE_ID}/context-refs`,
        payload: { ...validBody, createdBy: '   ' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'INVALID_CREATED_BY' });
    });

    it('returns 400 when targetThreadId is only whitespace', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/spaces/${TARGET_SPACE_ID}/context-refs`,
        payload: { ...validBody, targetThreadId: '   ' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'INVALID_TARGET_THREAD_ID' });
    });
  });

  describe('GET /api/spaces/:spaceId/context-refs', () => {
    it('returns 404 when the space does not exist', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(undefined);

      const response = await app.inject({
        method: 'GET',
        url: '/api/spaces/missing-space/context-refs',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: 'SPACE_NOT_FOUND' });
    });

    it('returns all context refs for the target space', async () => {
      vi.mocked(contextBridgeStore.listRefsByTargetSpace).mockResolvedValueOnce([
        makeContextRef(),
        makeContextRef({ id: 'ref-2', mode: 'copy' }),
      ] as never);

      const response = await app.inject({
        method: 'GET',
        url: `/api/spaces/${TARGET_SPACE_ID}/context-refs`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveLength(2);
      expect(contextBridgeStore.listRefsByTargetSpace).toHaveBeenCalledWith(TARGET_SPACE_ID);
    });
  });

  describe('GET /api/spaces/:spaceId/context-refs/budgeted', () => {
    it('returns 400 for an invalid overflow strategy', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/spaces/${TARGET_SPACE_ID}/context-refs/budgeted?overflowStrategy=drop`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'INVALID_OVERFLOW_STRATEGY' });
    });

    it('returns 400 for an invalid perSpaceLimit', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/spaces/${TARGET_SPACE_ID}/context-refs/budgeted?perSpaceLimit=-1`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'INVALID_PER_SPACE_LIMIT' });
    });

    it('returns 400 for an invalid totalLimit', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/spaces/${TARGET_SPACE_ID}/context-refs/budgeted?totalLimit=-1`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'INVALID_TOTAL_LIMIT' });
    });

    it('applies budget constraints and reports included + excluded refs', async () => {
      vi.mocked(contextBridgeStore.listRefsByTargetSpace).mockResolvedValueOnce([
        makeContextRef({
          id: 'small-ref',
          snapshotPayload: { text: 'tiny' },
          metadata: {},
        }),
        makeContextRef({
          id: 'large-ref',
          snapshotPayload: { text: 'x'.repeat(60) },
          metadata: {},
        }),
      ] as never);

      const response = await app.inject({
        method: 'GET',
        url: `/api/spaces/${TARGET_SPACE_ID}/context-refs/budgeted?perSpaceLimit=5&totalLimit=5&overflowStrategy=reject`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        refs: Array<{ id: string }>;
        excluded: Array<{ id: string }>;
        budget: { total: { usedTokens: number; maxTokens: number } };
      }>();
      expect(body.refs.map((ref) => ref.id)).toEqual(['small-ref']);
      expect(body.excluded.map((ref) => ref.id)).toEqual(['large-ref']);
      expect(body.budget.total).toMatchObject({ usedTokens: 4, maxTokens: 5 });
    });
  });

  describe('GET /api/spaces/:spaceId/context-refs/:refId/resolve', () => {
    it('returns 404 when the context ref does not exist in the target space', async () => {
      vi.mocked(contextBridgeStore.getRef).mockResolvedValueOnce(undefined);

      const response = await app.inject({
        method: 'GET',
        url: `/api/spaces/${TARGET_SPACE_ID}/context-refs/${REF_ID}/resolve`,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: 'CONTEXT_REF_NOT_FOUND' });
    });

    it('returns the frozen snapshot for copy mode refs', async () => {
      vi.mocked(contextBridgeStore.getRef).mockResolvedValueOnce(
        makeContextRef({
          mode: 'copy',
          snapshotPayload: { threadSummary: 'snapshot value' },
        }) as never,
      );

      const response = await app.inject({
        method: 'GET',
        url: `/api/spaces/${TARGET_SPACE_ID}/context-refs/${REF_ID}/resolve`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        ref: expect.objectContaining({ mode: 'copy' }),
        resolved: { threadSummary: 'snapshot value' },
      });
      expect(eventStore.getEvents).not.toHaveBeenCalled();
    });

    it('resolves live events for reference mode refs', async () => {
      vi.mocked(contextBridgeStore.getRef).mockResolvedValueOnce(makeContextRef() as never);
      vi.mocked(eventStore.getEvents).mockResolvedValueOnce([
        makeEvent(),
        makeEvent({ id: 'event-2', sequenceNum: 2 }),
      ] as never);

      const response = await app.inject({
        method: 'GET',
        url: `/api/spaces/${TARGET_SPACE_ID}/context-refs/${REF_ID}/resolve`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().resolved).toHaveLength(2);
      expect(eventStore.getEvents).toHaveBeenCalledWith(SOURCE_THREAD_ID, { limit: 100 });
    });

    it('returns 502 when live reference resolution fails', async () => {
      vi.mocked(contextBridgeStore.getRef).mockResolvedValueOnce(makeContextRef() as never);
      vi.mocked(eventStore.getEvents).mockRejectedValueOnce(new Error('source offline'));

      const response = await app.inject({
        method: 'GET',
        url: `/api/spaces/${TARGET_SPACE_ID}/context-refs/${REF_ID}/resolve`,
      });

      expect(response.statusCode).toBe(502);
      expect(response.json()).toMatchObject({ error: 'SOURCE_UNAVAILABLE' });
    });

    it('returns a hint for query mode refs', async () => {
      vi.mocked(contextBridgeStore.getRef).mockResolvedValueOnce(
        makeContextRef({ mode: 'query', sourceThreadId: null }) as never,
      );

      const response = await app.inject({
        method: 'GET',
        url: `/api/spaces/${TARGET_SPACE_ID}/context-refs/${REF_ID}/resolve`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        resolved: null,
        hint: 'Use cross_space_query MCP tool to query source space on demand',
      });
    });
  });

  describe('DELETE /api/spaces/:spaceId/context-refs/:refId', () => {
    it('deletes an existing context ref', async () => {
      vi.mocked(contextBridgeStore.getRef).mockResolvedValueOnce(makeContextRef() as never);

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/spaces/${TARGET_SPACE_ID}/context-refs/${REF_ID}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
      expect(contextBridgeStore.deleteRef).toHaveBeenCalledWith(REF_ID);
    });

    it('translates a missing context ref error from the store', async () => {
      vi.mocked(contextBridgeStore.getRef).mockResolvedValueOnce(makeContextRef() as never);
      vi.mocked(contextBridgeStore.deleteRef).mockRejectedValueOnce(
        new ControlPlaneError('CONTEXT_REF_NOT_FOUND', 'gone'),
      );

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/spaces/${TARGET_SPACE_ID}/context-refs/${REF_ID}`,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: 'CONTEXT_REF_NOT_FOUND' });
    });
  });

  describe('POST /api/spaces/:spaceId/subscriptions', () => {
    const validBody = {
      sourceSpaceId: SOURCE_SPACE_ID,
      filterCriteria: { eventTypes: ['message'] },
      createdBy: 'tester',
    };

    it('creates a subscription and defaults filterCriteria to an empty object', async () => {
      vi.mocked(contextBridgeStore.createSubscription).mockResolvedValueOnce(
        makeSubscription({ filterCriteria: {} }) as never,
      );

      const response = await app.inject({
        method: 'POST',
        url: `/api/spaces/${TARGET_SPACE_ID}/subscriptions`,
        payload: { sourceSpaceId: SOURCE_SPACE_ID, createdBy: 'tester' },
      });

      expect(response.statusCode).toBe(201);
      expect(contextBridgeStore.createSubscription).toHaveBeenCalledWith({
        sourceSpaceId: SOURCE_SPACE_ID,
        targetSpaceId: TARGET_SPACE_ID,
        filterCriteria: {},
        createdBy: 'tester',
      });
    });

    it('returns 404 when the target space does not exist', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/api/spaces/missing-space/subscriptions',
        payload: validBody,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: 'SPACE_NOT_FOUND' });
    });

    it('returns 400 when the source space does not exist', async () => {
      vi.mocked(spaceStore.getSpace)
        .mockResolvedValueOnce(makeSpace() as never)
        .mockResolvedValueOnce(undefined);

      const response = await app.inject({
        method: 'POST',
        url: `/api/spaces/${TARGET_SPACE_ID}/subscriptions`,
        payload: validBody,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'SOURCE_SPACE_NOT_FOUND' });
    });

    it('returns 400 when createdBy is only whitespace', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/spaces/${TARGET_SPACE_ID}/subscriptions`,
        payload: { ...validBody, createdBy: '   ' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'INVALID_CREATED_BY' });
    });
  });

  describe('GET /api/spaces/:spaceId/subscriptions', () => {
    it('returns 404 when the space does not exist', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(undefined);

      const response = await app.inject({
        method: 'GET',
        url: '/api/spaces/missing-space/subscriptions',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: 'SPACE_NOT_FOUND' });
    });

    it('returns all subscriptions for the target space', async () => {
      vi.mocked(contextBridgeStore.listSubscriptionsByTarget).mockResolvedValueOnce([
        makeSubscription(),
        makeSubscription({ id: 'sub-2', active: false }),
      ] as never);

      const response = await app.inject({
        method: 'GET',
        url: `/api/spaces/${TARGET_SPACE_ID}/subscriptions`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveLength(2);
      expect(contextBridgeStore.listSubscriptionsByTarget).toHaveBeenCalledWith(TARGET_SPACE_ID);
    });
  });

  describe('PATCH /api/spaces/:spaceId/subscriptions/:subId', () => {
    it('returns 400 when active is not a boolean', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/spaces/${TARGET_SPACE_ID}/subscriptions/${SUBSCRIPTION_ID}`,
        payload: { active: 'yes' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'INVALID_ACTIVE' });
    });

    it('returns 404 when the subscription does not belong to the space', async () => {
      vi.mocked(contextBridgeStore.getSubscription).mockResolvedValueOnce(undefined);

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/spaces/${TARGET_SPACE_ID}/subscriptions/${SUBSCRIPTION_ID}`,
        payload: { active: false },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: 'SUBSCRIPTION_NOT_FOUND' });
    });

    it('updates the subscription active state', async () => {
      vi.mocked(contextBridgeStore.getSubscription).mockResolvedValueOnce(
        makeSubscription() as never,
      );
      vi.mocked(contextBridgeStore.updateSubscriptionActive).mockResolvedValueOnce(
        makeSubscription({ active: false }) as never,
      );

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/spaces/${TARGET_SPACE_ID}/subscriptions/${SUBSCRIPTION_ID}`,
        payload: { active: false },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ active: false });
      expect(contextBridgeStore.updateSubscriptionActive).toHaveBeenCalledWith(
        SUBSCRIPTION_ID,
        false,
      );
    });

    it('translates a missing subscription error from the store', async () => {
      vi.mocked(contextBridgeStore.getSubscription).mockResolvedValueOnce(
        makeSubscription() as never,
      );
      vi.mocked(contextBridgeStore.updateSubscriptionActive).mockRejectedValueOnce(
        new ControlPlaneError('SUBSCRIPTION_NOT_FOUND', 'gone'),
      );

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/spaces/${TARGET_SPACE_ID}/subscriptions/${SUBSCRIPTION_ID}`,
        payload: { active: false },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: 'SUBSCRIPTION_NOT_FOUND' });
    });
  });

  describe('DELETE /api/spaces/:spaceId/subscriptions/:subId', () => {
    it('returns 404 when the subscription does not belong to the space', async () => {
      vi.mocked(contextBridgeStore.getSubscription).mockResolvedValueOnce(undefined);

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/spaces/${TARGET_SPACE_ID}/subscriptions/${SUBSCRIPTION_ID}`,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: 'SUBSCRIPTION_NOT_FOUND' });
    });

    it('deletes an existing subscription', async () => {
      vi.mocked(contextBridgeStore.getSubscription).mockResolvedValueOnce(
        makeSubscription() as never,
      );

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/spaces/${TARGET_SPACE_ID}/subscriptions/${SUBSCRIPTION_ID}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
      expect(contextBridgeStore.deleteSubscription).toHaveBeenCalledWith(SUBSCRIPTION_ID);
    });

    it('translates a missing subscription error from the store', async () => {
      vi.mocked(contextBridgeStore.getSubscription).mockResolvedValueOnce(
        makeSubscription() as never,
      );
      vi.mocked(contextBridgeStore.deleteSubscription).mockRejectedValueOnce(
        new ControlPlaneError('SUBSCRIPTION_NOT_FOUND', 'gone'),
      );

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/spaces/${TARGET_SPACE_ID}/subscriptions/${SUBSCRIPTION_ID}`,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: 'SUBSCRIPTION_NOT_FOUND' });
    });
  });
});
