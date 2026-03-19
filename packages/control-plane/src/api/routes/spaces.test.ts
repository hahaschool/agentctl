import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventStore } from '../../collaboration/event-store.js';
import type { SpaceStore } from '../../collaboration/space-store.js';
import type { ThreadStore } from '../../collaboration/thread-store.js';
import { spaceRoutes } from './spaces.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const SPACE_ID = 'space-00000000-0000-4000-a000-000000000001';
const THREAD_ID = 'thread-00000000-0000-4000-a000-000000000002';
const EVENT_ID = 'event-00000000-0000-4000-a000-000000000003';
const MEMBER_ID = 'member-user-001';
const NOW = new Date().toISOString();

function makeSpace(overrides: Record<string, unknown> = {}) {
  return {
    id: SPACE_ID,
    name: 'Test Space',
    description: 'A test space',
    type: 'collaboration',
    visibility: 'private',
    createdBy: 'user-1',
    createdAt: NOW,
    ...overrides,
  };
}

function makeThread(overrides: Record<string, unknown> = {}) {
  return {
    id: THREAD_ID,
    spaceId: SPACE_ID,
    title: 'Test Thread',
    type: 'discussion',
    createdAt: NOW,
    ...overrides,
  };
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    spaceId: SPACE_ID,
    threadId: THREAD_ID,
    sequenceNum: 1,
    type: 'message',
    senderType: 'human',
    senderId: 'user-1',
    payload: { text: 'hello' },
    visibility: 'public',
    createdAt: NOW,
    ...overrides,
  };
}

function makeMember(overrides: Record<string, unknown> = {}) {
  return {
    spaceId: SPACE_ID,
    memberType: 'human',
    memberId: MEMBER_ID,
    role: 'member',
    ...overrides,
  };
}

// ── Store Mocks ─────────────────────────────────────────────────────────────

function createMockSpaceStore(): SpaceStore {
  return {
    listSpaces: vi.fn().mockResolvedValue([]),
    createSpace: vi.fn().mockResolvedValue(makeSpace()),
    getSpace: vi.fn().mockResolvedValue(makeSpace()),
    deleteSpace: vi.fn().mockResolvedValue(undefined),
    addMember: vi.fn().mockResolvedValue(makeMember()),
    removeMember: vi.fn().mockResolvedValue(undefined),
    updateMemberFilter: vi.fn().mockResolvedValue(makeMember()),
    getMembers: vi.fn().mockResolvedValue([]),
  } as unknown as SpaceStore;
}

function createMockThreadStore(): ThreadStore {
  return {
    createThread: vi.fn().mockResolvedValue(makeThread()),
    getThread: vi.fn().mockResolvedValue(makeThread()),
    listThreads: vi.fn().mockResolvedValue([]),
    deleteThread: vi.fn().mockResolvedValue(undefined),
  } as unknown as ThreadStore;
}

function createMockEventStore(): EventStore {
  return {
    appendEvent: vi.fn().mockResolvedValue(makeEvent()),
    getEvents: vi.fn().mockResolvedValue([]),
    getEventByIdempotencyKey: vi.fn().mockResolvedValue(undefined),
    queryAcrossSpaces: vi.fn().mockResolvedValue({ events: [], totalMatched: 0 }),
  } as unknown as EventStore;
}

// ── Test Suite ──────────────────────────────────────────────────────────────

describe('spaces routes', () => {
  let app: FastifyInstance;
  let spaceStore: ReturnType<typeof createMockSpaceStore>;
  let threadStore: ReturnType<typeof createMockThreadStore>;
  let eventStore: ReturnType<typeof createMockEventStore>;

  beforeEach(async () => {
    spaceStore = createMockSpaceStore();
    threadStore = createMockThreadStore();
    eventStore = createMockEventStore();

    app = Fastify({ logger: false });
    await app.register(spaceRoutes, {
      prefix: '/api/spaces',
      spaceStore,
      threadStore,
      eventStore,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  // ── GET / ─────────────────────────────────────────────────────────────────

  describe('GET /api/spaces', () => {
    it('returns an empty array when no spaces exist', async () => {
      vi.mocked(spaceStore.listSpaces).mockResolvedValueOnce([]);

      const res = await app.inject({ method: 'GET', url: '/api/spaces' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('returns all spaces', async () => {
      const spaces = [makeSpace(), makeSpace({ id: 'space-2', name: 'Second Space' })];
      vi.mocked(spaceStore.listSpaces).mockResolvedValueOnce(spaces as never);

      const res = await app.inject({ method: 'GET', url: '/api/spaces' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(2);
      expect(res.json()[0].name).toBe('Test Space');
    });
  });

  // ── POST / ────────────────────────────────────────────────────────────────

  describe('POST /api/spaces', () => {
    const validBody = {
      name: 'My Space',
      description: 'Some description',
      type: 'collaboration',
      visibility: 'private',
      createdBy: 'user-1',
    };

    it('creates a space and returns 201', async () => {
      const created = makeSpace({ name: 'My Space' });
      vi.mocked(spaceStore.createSpace).mockResolvedValueOnce(created as never);

      const res = await app.inject({
        method: 'POST',
        url: '/api/spaces',
        payload: validBody,
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().name).toBe('My Space');
      expect(spaceStore.createSpace).toHaveBeenCalledOnce();
    });

    it('trims whitespace from name before creating', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/spaces',
        payload: { ...validBody, name: '  Trimmed  ' },
      });

      expect(res.statusCode).toBe(201);
      expect(spaceStore.createSpace).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Trimmed' }),
      );
    });

    it('uses defaults for optional fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/spaces',
        payload: { name: 'Minimal', createdBy: 'user-1' },
      });

      expect(res.statusCode).toBe(201);
      expect(spaceStore.createSpace).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'collaboration', visibility: 'private' }),
      );
    });

    it('returns 400 when name is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/spaces',
        payload: { ...validBody, name: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_NAME');
    });

    it('returns 400 when name is only whitespace', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/spaces',
        payload: { ...validBody, name: '   ' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_NAME');
    });

    it('returns 400 when name exceeds 256 characters', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/spaces',
        payload: { ...validBody, name: 'a'.repeat(257) },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('NAME_TOO_LONG');
    });

    it('returns 400 when createdBy is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/spaces',
        payload: { ...validBody, createdBy: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_CREATED_BY');
    });

    it('returns 400 for invalid type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/spaces',
        payload: { ...validBody, type: 'unknown-type' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_TYPE');
    });

    it('returns 400 for invalid visibility', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/spaces',
        payload: { ...validBody, visibility: 'super-secret' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_VISIBILITY');
    });

    it('accepts all valid space types', async () => {
      for (const type of ['collaboration', 'solo', 'fleet-overview']) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/spaces',
          payload: { ...validBody, type },
        });
        expect(res.statusCode).toBe(201);
      }
    });

    it('accepts all valid visibilities', async () => {
      for (const visibility of ['private', 'team', 'public']) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/spaces',
          payload: { ...validBody, visibility },
        });
        expect(res.statusCode).toBe(201);
      }
    });
  });

  // ── GET /:id ──────────────────────────────────────────────────────────────

  describe('GET /api/spaces/:id', () => {
    it('returns the space with members', async () => {
      const space = makeSpace();
      const members = [makeMember()];
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(space as never);
      vi.mocked(spaceStore.getMembers).mockResolvedValueOnce(members as never);

      const res = await app.inject({ method: 'GET', url: `/api/spaces/${SPACE_ID}` });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(SPACE_ID);
      expect(body.members).toHaveLength(1);
      expect(body.members[0].memberId).toBe(MEMBER_ID);
    });

    it('includes empty members array when no members', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(makeSpace() as never);
      vi.mocked(spaceStore.getMembers).mockResolvedValueOnce([]);

      const res = await app.inject({ method: 'GET', url: `/api/spaces/${SPACE_ID}` });

      expect(res.statusCode).toBe(200);
      expect(res.json().members).toEqual([]);
    });

    it('returns 404 when space does not exist', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(undefined);

      const res = await app.inject({ method: 'GET', url: '/api/spaces/nonexistent' });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('SPACE_NOT_FOUND');
    });
  });

  // ── DELETE /:id ───────────────────────────────────────────────────────────

  describe('DELETE /api/spaces/:id', () => {
    it('deletes the space and returns ok', async () => {
      vi.mocked(spaceStore.deleteSpace).mockResolvedValueOnce(undefined);

      const res = await app.inject({ method: 'DELETE', url: `/api/spaces/${SPACE_ID}` });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(spaceStore.deleteSpace).toHaveBeenCalledWith(SPACE_ID);
    });

    it('returns 404 when space does not exist', async () => {
      vi.mocked(spaceStore.deleteSpace).mockRejectedValueOnce(
        new ControlPlaneError('SPACE_NOT_FOUND', 'Space not found', { id: 'nonexistent' }),
      );

      const res = await app.inject({ method: 'DELETE', url: '/api/spaces/nonexistent' });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('SPACE_NOT_FOUND');
    });

    it('rethrows unexpected errors', async () => {
      vi.mocked(spaceStore.deleteSpace).mockRejectedValueOnce(new Error('DB connection lost'));

      const res = await app.inject({ method: 'DELETE', url: `/api/spaces/${SPACE_ID}` });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /:id/members ─────────────────────────────────────────────────────

  describe('POST /api/spaces/:id/members', () => {
    const validMemberBody = {
      memberType: 'human',
      memberId: MEMBER_ID,
      role: 'member',
    };

    it('adds a member and returns 201', async () => {
      const member = makeMember();
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(makeSpace() as never);
      vi.mocked(spaceStore.addMember).mockResolvedValueOnce(member as never);

      const res = await app.inject({
        method: 'POST',
        url: `/api/spaces/${SPACE_ID}/members`,
        payload: validMemberBody,
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().memberId).toBe(MEMBER_ID);
    });

    it('returns 400 for invalid memberType', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/spaces/${SPACE_ID}/members`,
        payload: { ...validMemberBody, memberType: 'robot' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_MEMBER_TYPE');
    });

    it('returns 400 when memberId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/spaces/${SPACE_ID}/members`,
        payload: { ...validMemberBody, memberId: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_MEMBER_ID');
    });

    it('returns 400 for invalid role', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/spaces/${SPACE_ID}/members`,
        payload: { ...validMemberBody, role: 'superuser' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_ROLE');
    });

    it('returns 404 when space does not exist', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'POST',
        url: `/api/spaces/${SPACE_ID}/members`,
        payload: validMemberBody,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('SPACE_NOT_FOUND');
    });

    it('accepts agent memberType', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(makeSpace() as never);
      vi.mocked(spaceStore.addMember).mockResolvedValueOnce(
        makeMember({ memberType: 'agent' }) as never,
      );

      const res = await app.inject({
        method: 'POST',
        url: `/api/spaces/${SPACE_ID}/members`,
        payload: { ...validMemberBody, memberType: 'agent' },
      });

      expect(res.statusCode).toBe(201);
    });

    it('accepts all valid roles', async () => {
      for (const role of ['owner', 'member', 'observer']) {
        vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(makeSpace() as never);
        vi.mocked(spaceStore.addMember).mockResolvedValueOnce(makeMember({ role }) as never);

        const res = await app.inject({
          method: 'POST',
          url: `/api/spaces/${SPACE_ID}/members`,
          payload: { ...validMemberBody, role },
        });

        expect(res.statusCode).toBe(201);
      }
    });

    it('accepts optional subscriptionFilter', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(makeSpace() as never);
      vi.mocked(spaceStore.addMember).mockResolvedValueOnce(makeMember() as never);

      const res = await app.inject({
        method: 'POST',
        url: `/api/spaces/${SPACE_ID}/members`,
        payload: {
          ...validMemberBody,
          subscriptionFilter: { threadTypes: ['discussion'], minVisibility: 'public' },
        },
      });

      expect(res.statusCode).toBe(201);
    });
  });

  // ── PATCH /:id/members/:memberId/filter ───────────────────────────────────

  describe('PATCH /api/spaces/:id/members/:memberId/filter', () => {
    const filterUrl = `/api/spaces/${SPACE_ID}/members/${MEMBER_ID}/filter`;
    const validBody = {
      subscriptionFilter: { threadTypes: ['discussion'], minVisibility: 'public' },
    };

    it('updates member filter and returns updated member', async () => {
      const updated = makeMember({ subscriptionFilter: validBody.subscriptionFilter });
      vi.mocked(spaceStore.updateMemberFilter).mockResolvedValueOnce(updated as never);

      const res = await app.inject({ method: 'PATCH', url: filterUrl, payload: validBody });

      expect(res.statusCode).toBe(200);
      expect(spaceStore.updateMemberFilter).toHaveBeenCalledWith(
        SPACE_ID,
        'human',
        MEMBER_ID,
        validBody.subscriptionFilter,
      );
    });

    it('uses memberType from query string when provided', async () => {
      vi.mocked(spaceStore.updateMemberFilter).mockResolvedValueOnce(makeMember() as never);

      await app.inject({
        method: 'PATCH',
        url: `${filterUrl}?memberType=agent`,
        payload: validBody,
      });

      expect(spaceStore.updateMemberFilter).toHaveBeenCalledWith(
        SPACE_ID,
        'agent',
        MEMBER_ID,
        expect.any(Object),
      );
    });

    it('defaults memberType to human when not provided', async () => {
      vi.mocked(spaceStore.updateMemberFilter).mockResolvedValueOnce(makeMember() as never);

      await app.inject({ method: 'PATCH', url: filterUrl, payload: validBody });

      expect(spaceStore.updateMemberFilter).toHaveBeenCalledWith(
        SPACE_ID,
        'human',
        MEMBER_ID,
        expect.any(Object),
      );
    });

    it('returns 404 when member not found', async () => {
      vi.mocked(spaceStore.updateMemberFilter).mockRejectedValueOnce(
        new ControlPlaneError('MEMBER_NOT_FOUND', 'Member not found', {}),
      );

      const res = await app.inject({ method: 'PATCH', url: filterUrl, payload: validBody });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('MEMBER_NOT_FOUND');
    });

    it('rethrows unexpected errors from updateMemberFilter', async () => {
      vi.mocked(spaceStore.updateMemberFilter).mockRejectedValueOnce(new Error('DB error'));

      const res = await app.inject({ method: 'PATCH', url: filterUrl, payload: validBody });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── DELETE /:id/members/:memberId ─────────────────────────────────────────

  describe('DELETE /api/spaces/:id/members/:memberId', () => {
    const memberUrl = `/api/spaces/${SPACE_ID}/members/${MEMBER_ID}`;

    it('removes a member and returns ok', async () => {
      vi.mocked(spaceStore.removeMember).mockResolvedValueOnce(undefined);

      const res = await app.inject({ method: 'DELETE', url: memberUrl });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(spaceStore.removeMember).toHaveBeenCalledWith(SPACE_ID, 'human', MEMBER_ID);
    });

    it('uses memberType from query string', async () => {
      vi.mocked(spaceStore.removeMember).mockResolvedValueOnce(undefined);

      await app.inject({ method: 'DELETE', url: `${memberUrl}?memberType=agent` });

      expect(spaceStore.removeMember).toHaveBeenCalledWith(SPACE_ID, 'agent', MEMBER_ID);
    });

    it('returns 404 when member not found', async () => {
      vi.mocked(spaceStore.removeMember).mockRejectedValueOnce(
        new ControlPlaneError('MEMBER_NOT_FOUND', 'Member not found', {}),
      );

      const res = await app.inject({ method: 'DELETE', url: memberUrl });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('MEMBER_NOT_FOUND');
    });

    it('rethrows unexpected errors from removeMember', async () => {
      vi.mocked(spaceStore.removeMember).mockRejectedValueOnce(new Error('DB error'));

      const res = await app.inject({ method: 'DELETE', url: memberUrl });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── GET /:id/threads ──────────────────────────────────────────────────────

  describe('GET /api/spaces/:id/threads', () => {
    it('returns threads for a space', async () => {
      const threads = [makeThread(), makeThread({ id: 'thread-2', title: 'Second' })];
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(makeSpace() as never);
      vi.mocked(threadStore.listThreads).mockResolvedValueOnce(threads as never);

      const res = await app.inject({ method: 'GET', url: `/api/spaces/${SPACE_ID}/threads` });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(2);
    });

    it('returns empty array when space has no threads', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(makeSpace() as never);
      vi.mocked(threadStore.listThreads).mockResolvedValueOnce([]);

      const res = await app.inject({ method: 'GET', url: `/api/spaces/${SPACE_ID}/threads` });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('returns 404 when space does not exist', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(undefined);

      const res = await app.inject({ method: 'GET', url: '/api/spaces/nonexistent/threads' });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('SPACE_NOT_FOUND');
    });
  });

  // ── POST /:id/threads ─────────────────────────────────────────────────────

  describe('POST /api/spaces/:id/threads', () => {
    it('creates a thread and returns 201', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(makeSpace() as never);
      vi.mocked(threadStore.createThread).mockResolvedValueOnce(makeThread() as never);

      const res = await app.inject({
        method: 'POST',
        url: `/api/spaces/${SPACE_ID}/threads`,
        payload: { type: 'discussion', title: 'Test Thread' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().spaceId).toBe(SPACE_ID);
    });

    it('uses discussion as default type', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(makeSpace() as never);
      vi.mocked(threadStore.createThread).mockResolvedValueOnce(makeThread() as never);

      await app.inject({
        method: 'POST',
        url: `/api/spaces/${SPACE_ID}/threads`,
        payload: {},
      });

      expect(threadStore.createThread).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'discussion' }),
      );
    });

    it('accepts null title when not provided', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(makeSpace() as never);
      vi.mocked(threadStore.createThread).mockResolvedValueOnce(
        makeThread({ title: null }) as never,
      );

      const res = await app.inject({
        method: 'POST',
        url: `/api/spaces/${SPACE_ID}/threads`,
        payload: { type: 'discussion' },
      });

      expect(res.statusCode).toBe(201);
    });

    it('returns 400 for invalid thread type', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(makeSpace() as never);

      const res = await app.inject({
        method: 'POST',
        url: `/api/spaces/${SPACE_ID}/threads`,
        payload: { type: 'invalid-type' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_THREAD_TYPE');
    });

    it('returns 404 when space does not exist', async () => {
      vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'POST',
        url: '/api/spaces/nonexistent/threads',
        payload: { type: 'discussion' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('SPACE_NOT_FOUND');
    });

    it('accepts all valid thread types', async () => {
      for (const type of ['discussion', 'execution', 'review', 'approval']) {
        vi.mocked(spaceStore.getSpace).mockResolvedValueOnce(makeSpace() as never);
        vi.mocked(threadStore.createThread).mockResolvedValueOnce(makeThread({ type }) as never);

        const res = await app.inject({
          method: 'POST',
          url: `/api/spaces/${SPACE_ID}/threads`,
          payload: { type },
        });

        expect(res.statusCode).toBe(201);
      }
    });
  });

  // ── GET /:id/threads/:threadId ────────────────────────────────────────────

  describe('GET /api/spaces/:id/threads/:threadId', () => {
    const threadUrl = `/api/spaces/${SPACE_ID}/threads/${THREAD_ID}`;

    it('returns the thread', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(makeThread() as never);

      const res = await app.inject({ method: 'GET', url: threadUrl });

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(THREAD_ID);
    });

    it('returns 404 when thread does not exist', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(undefined);

      const res = await app.inject({ method: 'GET', url: threadUrl });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('THREAD_NOT_FOUND');
    });

    it('returns 404 when thread belongs to a different space', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(
        makeThread({ spaceId: 'different-space' }) as never,
      );

      const res = await app.inject({ method: 'GET', url: threadUrl });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('THREAD_NOT_FOUND');
    });
  });

  // ── DELETE /:id/threads/:threadId ─────────────────────────────────────────

  describe('DELETE /api/spaces/:id/threads/:threadId', () => {
    const threadUrl = `/api/spaces/${SPACE_ID}/threads/${THREAD_ID}`;

    it('deletes the thread and returns ok', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(makeThread() as never);
      vi.mocked(threadStore.deleteThread).mockResolvedValueOnce(undefined);

      const res = await app.inject({ method: 'DELETE', url: threadUrl });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(threadStore.deleteThread).toHaveBeenCalledWith(THREAD_ID);
    });

    it('returns 404 when thread does not exist', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(undefined);

      const res = await app.inject({ method: 'DELETE', url: threadUrl });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('THREAD_NOT_FOUND');
    });

    it('returns 404 when thread belongs to a different space', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(
        makeThread({ spaceId: 'other-space' }) as never,
      );

      const res = await app.inject({ method: 'DELETE', url: threadUrl });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('THREAD_NOT_FOUND');
    });

    it('handles THREAD_NOT_FOUND error from deleteThread', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(makeThread() as never);
      vi.mocked(threadStore.deleteThread).mockRejectedValueOnce(
        new ControlPlaneError('THREAD_NOT_FOUND', 'Thread not found', {}),
      );

      const res = await app.inject({ method: 'DELETE', url: threadUrl });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('THREAD_NOT_FOUND');
    });

    it('rethrows unexpected errors from deleteThread', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(makeThread() as never);
      vi.mocked(threadStore.deleteThread).mockRejectedValueOnce(new Error('Unexpected'));

      const res = await app.inject({ method: 'DELETE', url: threadUrl });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── GET /:id/threads/:threadId/events ─────────────────────────────────────

  describe('GET /api/spaces/:id/threads/:threadId/events', () => {
    const eventsUrl = `/api/spaces/${SPACE_ID}/threads/${THREAD_ID}/events`;

    it('returns events for the thread', async () => {
      const events = [makeEvent(), makeEvent({ id: 'event-2', sequenceNum: 2 })];
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(makeThread() as never);
      vi.mocked(eventStore.getEvents).mockResolvedValueOnce(events as never);

      const res = await app.inject({ method: 'GET', url: eventsUrl });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(2);
    });

    it('returns empty array when no events', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(makeThread() as never);
      vi.mocked(eventStore.getEvents).mockResolvedValueOnce([]);

      const res = await app.inject({ method: 'GET', url: eventsUrl });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('passes after and limit query params to getEvents', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(makeThread() as never);
      vi.mocked(eventStore.getEvents).mockResolvedValueOnce([makeEvent()] as never);

      await app.inject({ method: 'GET', url: `${eventsUrl}?after=5&limit=20` });

      expect(eventStore.getEvents).toHaveBeenCalledWith(THREAD_ID, { after: 5, limit: 20 });
    });

    it('returns 404 when thread does not exist', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(undefined);

      const res = await app.inject({ method: 'GET', url: eventsUrl });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('THREAD_NOT_FOUND');
    });

    it('returns 404 when thread belongs to different space', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(
        makeThread({ spaceId: 'other-space' }) as never,
      );

      const res = await app.inject({ method: 'GET', url: eventsUrl });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('THREAD_NOT_FOUND');
    });

    it('returns 400 when after is negative', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(makeThread() as never);

      const res = await app.inject({ method: 'GET', url: `${eventsUrl}?after=-1` });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_PARAMS');
    });

    it('returns 400 when limit is zero', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(makeThread() as never);

      const res = await app.inject({ method: 'GET', url: `${eventsUrl}?limit=0` });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_PARAMS');
    });

    it('returns 400 when after is not a number', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(makeThread() as never);

      const res = await app.inject({ method: 'GET', url: `${eventsUrl}?after=abc` });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_PARAMS');
    });

    it('returns 400 when limit is not a number', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(makeThread() as never);

      const res = await app.inject({ method: 'GET', url: `${eventsUrl}?limit=abc` });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_PARAMS');
    });
  });

  // ── POST /:id/threads/:threadId/events ────────────────────────────────────

  describe('POST /api/spaces/:id/threads/:threadId/events', () => {
    const eventsUrl = `/api/spaces/${SPACE_ID}/threads/${THREAD_ID}/events`;

    const validEventBody = {
      idempotencyKey: 'idem-key-001',
      type: 'message',
      senderType: 'human',
      senderId: 'user-1',
      payload: { text: 'hello world' },
      visibility: 'public',
    };

    it('appends an event and returns 201', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(makeThread() as never);
      vi.mocked(eventStore.appendEvent).mockResolvedValueOnce(makeEvent() as never);

      const res = await app.inject({
        method: 'POST',
        url: eventsUrl,
        payload: validEventBody,
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().type).toBe('message');
    });

    it('passes all fields to appendEvent', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(makeThread() as never);
      vi.mocked(eventStore.appendEvent).mockResolvedValueOnce(makeEvent() as never);

      await app.inject({ method: 'POST', url: eventsUrl, payload: validEventBody });

      expect(eventStore.appendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          spaceId: SPACE_ID,
          threadId: THREAD_ID,
          idempotencyKey: 'idem-key-001',
          type: 'message',
          senderType: 'human',
          senderId: 'user-1',
        }),
      );
    });

    it('defaults payload to empty object when not provided', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(makeThread() as never);
      vi.mocked(eventStore.appendEvent).mockResolvedValueOnce(makeEvent() as never);

      const { payload: _payload, ...bodyWithoutPayload } = validEventBody;

      await app.inject({ method: 'POST', url: eventsUrl, payload: bodyWithoutPayload });

      expect(eventStore.appendEvent).toHaveBeenCalledWith(expect.objectContaining({ payload: {} }));
    });

    it('accepts optional correlationId', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(makeThread() as never);
      vi.mocked(eventStore.appendEvent).mockResolvedValueOnce(makeEvent() as never);

      const res = await app.inject({
        method: 'POST',
        url: eventsUrl,
        payload: { ...validEventBody, correlationId: 'corr-123' },
      });

      expect(res.statusCode).toBe(201);
      expect(eventStore.appendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: 'corr-123' }),
      );
    });

    it('returns 404 when thread does not exist', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(undefined);

      const res = await app.inject({ method: 'POST', url: eventsUrl, payload: validEventBody });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('THREAD_NOT_FOUND');
    });

    it('returns 404 when thread belongs to different space', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(
        makeThread({ spaceId: 'other-space' }) as never,
      );

      const res = await app.inject({ method: 'POST', url: eventsUrl, payload: validEventBody });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('THREAD_NOT_FOUND');
    });

    it('returns 400 when idempotencyKey is missing', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(makeThread() as never);

      const res = await app.inject({
        method: 'POST',
        url: eventsUrl,
        payload: { ...validEventBody, idempotencyKey: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_IDEMPOTENCY_KEY');
    });

    it('returns 400 for invalid event type', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(makeThread() as never);

      const res = await app.inject({
        method: 'POST',
        url: eventsUrl,
        payload: { ...validEventBody, type: 'bad-type' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_EVENT_TYPE');
    });

    it('returns 400 for invalid senderType', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(makeThread() as never);

      const res = await app.inject({
        method: 'POST',
        url: eventsUrl,
        payload: { ...validEventBody, senderType: 'robot' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_SENDER_TYPE');
    });

    it('returns 400 when senderId is missing', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(makeThread() as never);

      const res = await app.inject({
        method: 'POST',
        url: eventsUrl,
        payload: { ...validEventBody, senderId: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_SENDER_ID');
    });

    it('returns 400 for invalid visibility', async () => {
      vi.mocked(threadStore.getThread).mockResolvedValueOnce(makeThread() as never);

      const res = await app.inject({
        method: 'POST',
        url: eventsUrl,
        payload: { ...validEventBody, visibility: 'top-secret' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_VISIBILITY');
    });

    it('accepts all valid event types', async () => {
      for (const type of ['message', 'artifact', 'control', 'task-state', 'approval']) {
        vi.mocked(threadStore.getThread).mockResolvedValueOnce(makeThread() as never);
        vi.mocked(eventStore.appendEvent).mockResolvedValueOnce(makeEvent({ type }) as never);

        const res = await app.inject({
          method: 'POST',
          url: eventsUrl,
          payload: { ...validEventBody, type },
        });

        expect(res.statusCode).toBe(201);
      }
    });

    it('accepts all valid senderTypes', async () => {
      for (const senderType of ['human', 'agent', 'system']) {
        vi.mocked(threadStore.getThread).mockResolvedValueOnce(makeThread() as never);
        vi.mocked(eventStore.appendEvent).mockResolvedValueOnce(makeEvent({ senderType }) as never);

        const res = await app.inject({
          method: 'POST',
          url: eventsUrl,
          payload: { ...validEventBody, senderType },
        });

        expect(res.statusCode).toBe(201);
      }
    });

    it('accepts all valid visibilities', async () => {
      for (const visibility of ['public', 'internal', 'silent']) {
        vi.mocked(threadStore.getThread).mockResolvedValueOnce(makeThread() as never);
        vi.mocked(eventStore.appendEvent).mockResolvedValueOnce(makeEvent({ visibility }) as never);

        const res = await app.inject({
          method: 'POST',
          url: eventsUrl,
          payload: { ...validEventBody, visibility },
        });

        expect(res.statusCode).toBe(201);
      }
    });
  });
});
