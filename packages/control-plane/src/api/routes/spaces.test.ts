import type { Space, SpaceEvent, SpaceMember, Thread } from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { spaceRoutes } from './spaces.js';

type SpaceStoreMock = {
  listSpaces: ReturnType<typeof vi.fn>;
  createSpace: ReturnType<typeof vi.fn>;
  getSpace: ReturnType<typeof vi.fn>;
  deleteSpace: ReturnType<typeof vi.fn>;
  addMember: ReturnType<typeof vi.fn>;
  updateMemberFilter: ReturnType<typeof vi.fn>;
  removeMember: ReturnType<typeof vi.fn>;
  getMembers: ReturnType<typeof vi.fn>;
};

type ThreadStoreMock = {
  listThreads: ReturnType<typeof vi.fn>;
  createThread: ReturnType<typeof vi.fn>;
  getThread: ReturnType<typeof vi.fn>;
  deleteThread: ReturnType<typeof vi.fn>;
};

type EventStoreMock = {
  getEvents: ReturnType<typeof vi.fn>;
  appendEvent: ReturnType<typeof vi.fn>;
};

const SPACE_ID = 'space-1';
const THREAD_ID = 'thread-1';
const EVENT_ID = 'event-1';

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: SPACE_ID,
    name: 'Platform',
    description: 'Shared work',
    type: 'collaboration',
    visibility: 'private',
    createdBy: 'user-1',
    createdAt: '2026-03-19T05:00:00.000Z',
    ...overrides,
  };
}

function makeMember(overrides: Partial<SpaceMember> = {}): SpaceMember {
  return {
    spaceId: SPACE_ID,
    memberType: 'human',
    memberId: 'user-1',
    role: 'member',
    ...overrides,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: THREAD_ID,
    spaceId: SPACE_ID,
    title: 'Coordination',
    type: 'discussion',
    createdAt: '2026-03-19T05:10:00.000Z',
    ...overrides,
  };
}

function makeEvent(overrides: Partial<SpaceEvent> = {}): SpaceEvent {
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
    createdAt: '2026-03-19T05:20:00.000Z',
    ...overrides,
  };
}

function createSpaceStoreMock(): SpaceStoreMock {
  return {
    listSpaces: vi.fn().mockResolvedValue([]),
    createSpace: vi.fn(),
    getSpace: vi.fn().mockResolvedValue(undefined),
    deleteSpace: vi.fn().mockResolvedValue(undefined),
    addMember: vi.fn(),
    updateMemberFilter: vi.fn(),
    removeMember: vi.fn().mockResolvedValue(undefined),
    getMembers: vi.fn().mockResolvedValue([]),
  };
}

function createThreadStoreMock(): ThreadStoreMock {
  return {
    listThreads: vi.fn().mockResolvedValue([]),
    createThread: vi.fn(),
    getThread: vi.fn().mockResolvedValue(undefined),
    deleteThread: vi.fn().mockResolvedValue(undefined),
  };
}

function createEventStoreMock(): EventStoreMock {
  return {
    getEvents: vi.fn().mockResolvedValue([]),
    appendEvent: vi.fn(),
  };
}

async function buildApp(
  spaceStore: SpaceStoreMock,
  threadStore: ThreadStoreMock,
  eventStore: EventStoreMock,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(spaceRoutes, {
    prefix: '/api/spaces',
    spaceStore: spaceStore as never,
    threadStore: threadStore as never,
    eventStore: eventStore as never,
  });
  await app.ready();
  return app;
}

describe('spaceRoutes', () => {
  let app: FastifyInstance;
  let spaceStore: SpaceStoreMock;
  let threadStore: ThreadStoreMock;
  let eventStore: EventStoreMock;

  beforeEach(async () => {
    spaceStore = createSpaceStoreMock();
    threadStore = createThreadStoreMock();
    eventStore = createEventStoreMock();
    app = await buildApp(spaceStore, threadStore, eventStore);
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists spaces', async () => {
    const spaces = [makeSpace(), makeSpace({ id: 'space-2', name: 'Infra' })];
    spaceStore.listSpaces.mockResolvedValueOnce(spaces);

    const response = await app.inject({
      method: 'GET',
      url: '/api/spaces',
    });

    expect(response.statusCode).toBe(200);
    expect(spaceStore.listSpaces).toHaveBeenCalledTimes(1);
    expect(response.json()).toEqual(spaces);
  });

  it('creates a space with trimmed name and defaults', async () => {
    const created = makeSpace();
    spaceStore.createSpace.mockResolvedValueOnce(created);

    const response = await app.inject({
      method: 'POST',
      url: '/api/spaces',
      payload: {
        name: '  Platform  ',
        createdBy: 'user-1',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(spaceStore.createSpace).toHaveBeenCalledWith({
      name: 'Platform',
      description: '',
      type: 'collaboration',
      visibility: 'private',
      createdBy: 'user-1',
    });
    expect(response.json()).toEqual(created);
  });

  it.each([
    {
      name: 'missing name',
      payload: { name: '', createdBy: 'user-1' },
      error: 'INVALID_NAME',
    },
    {
      name: 'invalid type',
      payload: { name: 'Platform', createdBy: 'user-1', type: 'invalid' },
      error: 'INVALID_TYPE',
    },
    {
      name: 'invalid visibility',
      payload: { name: 'Platform', createdBy: 'user-1', visibility: 'secret' },
      error: 'INVALID_VISIBILITY',
    },
    {
      name: 'missing createdBy',
      payload: { name: 'Platform', createdBy: '' },
      error: 'INVALID_CREATED_BY',
    },
  ])('rejects invalid create payload: $name', async ({ payload, error }) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/spaces',
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error });
  });

  it('gets a space with members', async () => {
    const members = [makeMember(), makeMember({ memberType: 'agent', memberId: 'agent-1' })];
    spaceStore.getSpace.mockResolvedValueOnce(makeSpace());
    spaceStore.getMembers.mockResolvedValueOnce(members);

    const response = await app.inject({
      method: 'GET',
      url: `/api/spaces/${SPACE_ID}`,
    });

    expect(response.statusCode).toBe(200);
    expect(spaceStore.getMembers).toHaveBeenCalledWith(SPACE_ID);
    expect(response.json()).toEqual({
      ...makeSpace(),
      members,
    });
  });

  it('maps missing space deletion to 404', async () => {
    spaceStore.deleteSpace.mockRejectedValueOnce(
      new ControlPlaneError('SPACE_NOT_FOUND', 'missing'),
    );

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/spaces/${SPACE_ID}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'SPACE_NOT_FOUND' });
  });

  it('adds a member after verifying the space exists', async () => {
    const member = makeMember({
      role: 'observer',
      subscriptionFilter: { threadTypes: ['approval'], minVisibility: 'public' },
    });
    spaceStore.getSpace.mockResolvedValueOnce(makeSpace());
    spaceStore.addMember.mockResolvedValueOnce(member);

    const response = await app.inject({
      method: 'POST',
      url: `/api/spaces/${SPACE_ID}/members`,
      payload: {
        memberType: 'human',
        memberId: 'user-2',
        role: 'observer',
        subscriptionFilter: { threadTypes: ['approval'], minVisibility: 'public' },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(spaceStore.addMember).toHaveBeenCalledWith(SPACE_ID, {
      memberType: 'human',
      memberId: 'user-2',
      role: 'observer',
      subscriptionFilter: { threadTypes: ['approval'], minVisibility: 'public' },
    });
    expect(response.json()).toEqual(member);
  });

  it.each([
    {
      name: 'invalid member type',
      payload: { memberType: 'bot', memberId: 'user-2' },
      error: 'INVALID_MEMBER_TYPE',
    },
    {
      name: 'missing memberId',
      payload: { memberType: 'human', memberId: '' },
      error: 'INVALID_MEMBER_ID',
    },
    {
      name: 'invalid role',
      payload: { memberType: 'human', memberId: 'user-2', role: 'admin' },
      error: 'INVALID_ROLE',
    },
  ])('rejects invalid member payload: $name', async ({ payload, error }) => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/spaces/${SPACE_ID}/members`,
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error });
  });

  it('updates a member filter using the default human member type', async () => {
    const member = makeMember({ subscriptionFilter: { threadTypes: ['discussion'] } });
    spaceStore.updateMemberFilter.mockResolvedValueOnce(member);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/spaces/${SPACE_ID}/members/user-1/filter`,
      payload: {
        subscriptionFilter: { threadTypes: ['discussion'] },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(spaceStore.updateMemberFilter).toHaveBeenCalledWith(SPACE_ID, 'human', 'user-1', {
      threadTypes: ['discussion'],
    });
    expect(response.json()).toEqual(member);
  });

  it('maps missing member filter updates to 404', async () => {
    spaceStore.updateMemberFilter.mockRejectedValueOnce(
      new ControlPlaneError('MEMBER_NOT_FOUND', 'missing'),
    );

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/spaces/${SPACE_ID}/members/user-9/filter?memberType=agent`,
      payload: {
        subscriptionFilter: { minVisibility: 'internal' },
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'MEMBER_NOT_FOUND' });
  });

  it('removes a member with the requested member type', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/spaces/${SPACE_ID}/members/agent-1?memberType=agent`,
    });

    expect(response.statusCode).toBe(200);
    expect(spaceStore.removeMember).toHaveBeenCalledWith(SPACE_ID, 'agent', 'agent-1');
    expect(response.json()).toEqual({ ok: true });
  });

  it('lists threads only when the space exists', async () => {
    const threads = [makeThread(), makeThread({ id: 'thread-2', title: 'Review', type: 'review' })];
    spaceStore.getSpace.mockResolvedValueOnce(makeSpace());
    threadStore.listThreads.mockResolvedValueOnce(threads);

    const response = await app.inject({
      method: 'GET',
      url: `/api/spaces/${SPACE_ID}/threads`,
    });

    expect(response.statusCode).toBe(200);
    expect(threadStore.listThreads).toHaveBeenCalledWith(SPACE_ID);
    expect(response.json()).toEqual(threads);
  });

  it('creates a thread with defaults and rejects invalid thread types', async () => {
    spaceStore.getSpace.mockResolvedValueOnce(makeSpace());

    const invalidResponse = await app.inject({
      method: 'POST',
      url: `/api/spaces/${SPACE_ID}/threads`,
      payload: { type: 'invalid' },
    });

    expect(invalidResponse.statusCode).toBe(400);
    expect(invalidResponse.json()).toMatchObject({ error: 'INVALID_THREAD_TYPE' });

    const created = makeThread({ title: null });
    spaceStore.getSpace.mockResolvedValueOnce(makeSpace());
    threadStore.createThread.mockResolvedValueOnce(created);

    const response = await app.inject({
      method: 'POST',
      url: `/api/spaces/${SPACE_ID}/threads`,
      payload: {},
    });

    expect(response.statusCode).toBe(201);
    expect(threadStore.createThread).toHaveBeenCalledWith({
      spaceId: SPACE_ID,
      type: 'discussion',
      title: null,
    });
    expect(response.json()).toEqual(created);
  });

  it('returns 404 when a thread does not belong to the space', async () => {
    threadStore.getThread.mockResolvedValueOnce(makeThread({ spaceId: 'other-space' }));

    const response = await app.inject({
      method: 'GET',
      url: `/api/spaces/${SPACE_ID}/threads/${THREAD_ID}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'THREAD_NOT_FOUND' });
  });

  it('deletes a thread and maps store not-found errors', async () => {
    threadStore.getThread.mockResolvedValueOnce(makeThread());
    threadStore.deleteThread.mockRejectedValueOnce(
      new ControlPlaneError('THREAD_NOT_FOUND', 'missing'),
    );

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/spaces/${SPACE_ID}/threads/${THREAD_ID}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'THREAD_NOT_FOUND' });
  });

  it('validates event query parameters and lists events', async () => {
    threadStore.getThread.mockResolvedValueOnce(makeThread());

    const invalidResponse = await app.inject({
      method: 'GET',
      url: `/api/spaces/${SPACE_ID}/threads/${THREAD_ID}/events?after=-1`,
    });

    expect(invalidResponse.statusCode).toBe(400);
    expect(invalidResponse.json()).toMatchObject({ error: 'INVALID_PARAMS' });

    const events = [makeEvent(), makeEvent({ id: 'event-2', sequenceNum: 2 })];
    threadStore.getThread.mockResolvedValueOnce(makeThread());
    eventStore.getEvents.mockResolvedValueOnce(events);

    const response = await app.inject({
      method: 'GET',
      url: `/api/spaces/${SPACE_ID}/threads/${THREAD_ID}/events?after=1&limit=20`,
    });

    expect(response.statusCode).toBe(200);
    expect(eventStore.getEvents).toHaveBeenCalledWith(THREAD_ID, {
      after: 1,
      limit: 20,
    });
    expect(response.json()).toEqual(events);
  });

  it('appends an event after validating the payload', async () => {
    threadStore.getThread.mockResolvedValueOnce(makeThread());

    const invalidResponse = await app.inject({
      method: 'POST',
      url: `/api/spaces/${SPACE_ID}/threads/${THREAD_ID}/events`,
      payload: {
        idempotencyKey: '',
        type: 'message',
        senderType: 'human',
        senderId: 'user-1',
      },
    });

    expect(invalidResponse.statusCode).toBe(400);
    expect(invalidResponse.json()).toMatchObject({ error: 'INVALID_IDEMPOTENCY_KEY' });

    const event = makeEvent({ visibility: 'internal' });
    threadStore.getThread.mockResolvedValueOnce(makeThread());
    eventStore.appendEvent.mockResolvedValueOnce(event);

    const response = await app.inject({
      method: 'POST',
      url: `/api/spaces/${SPACE_ID}/threads/${THREAD_ID}/events`,
      payload: {
        idempotencyKey: 'idem-1',
        correlationId: 'corr-1',
        type: 'message',
        senderType: 'human',
        senderId: 'user-1',
        payload: { text: 'Ship it' },
        visibility: 'internal',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(eventStore.appendEvent).toHaveBeenCalledWith({
      spaceId: SPACE_ID,
      threadId: THREAD_ID,
      idempotencyKey: 'idem-1',
      correlationId: 'corr-1',
      type: 'message',
      senderType: 'human',
      senderId: 'user-1',
      payload: { text: 'Ship it' },
      visibility: 'internal',
    });
    expect(response.json()).toEqual(event);
  });
});
