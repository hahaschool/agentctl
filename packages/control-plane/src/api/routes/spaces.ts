import {
  ControlPlaneError,
  EVENT_SENDER_TYPES,
  EVENT_VISIBILITIES,
  isEventVisibility,
  isSpaceEventType,
  isSpaceType,
  isSpaceVisibility,
  isThreadType,
  SPACE_EVENT_TYPES,
  SPACE_MEMBER_ROLES,
  SPACE_MEMBER_TYPES,
  SPACE_TYPES,
  SPACE_VISIBILITIES,
  THREAD_TYPES,
} from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { EventStore } from '../../collaboration/event-store.js';
import type { SpaceStore } from '../../collaboration/space-store.js';
import type { ThreadStore } from '../../collaboration/thread-store.js';

export type SpaceRoutesOptions = {
  spaceStore: SpaceStore;
  threadStore: ThreadStore;
  eventStore: EventStore;
};

export const spaceRoutes: FastifyPluginAsync<SpaceRoutesOptions> = async (app, opts) => {
  const { spaceStore, threadStore, eventStore } = opts;

  // ---------------------------------------------------------------------------
  // Space CRUD
  // ---------------------------------------------------------------------------

  app.get('/', { schema: { tags: ['collaboration'], summary: 'List all spaces' } }, async () => {
    return await spaceStore.listSpaces();
  });

  app.post<{
    Body: {
      name: string;
      description?: string;
      type?: string;
      visibility?: string;
      createdBy: string;
    };
  }>(
    '/',
    { schema: { tags: ['collaboration'], summary: 'Create a space' } },
    async (request, reply) => {
      const { name, description, type, visibility, createdBy } = request.body;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return reply.code(400).send({
          error: 'INVALID_NAME',
          message: 'A non-empty "name" string is required',
        });
      }

      if (typeof name === 'string' && name.length > 256) {
        return reply.code(400).send({
          error: 'NAME_TOO_LONG',
          message: 'name must be under 256 characters',
        });
      }

      if (!createdBy || typeof createdBy !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_CREATED_BY',
          message: 'A non-empty "createdBy" string is required',
        });
      }

      if (type && !isSpaceType(type)) {
        return reply.code(400).send({
          error: 'INVALID_TYPE',
          message: `Invalid space type. Must be one of: ${SPACE_TYPES.join(', ')}`,
        });
      }

      if (visibility && !isSpaceVisibility(visibility)) {
        return reply.code(400).send({
          error: 'INVALID_VISIBILITY',
          message: `Invalid visibility. Must be one of: ${SPACE_VISIBILITIES.join(', ')}`,
        });
      }

      const space = await spaceStore.createSpace({
        name: name.trim(),
        description: description ?? '',
        type: type ?? 'collaboration',
        visibility: visibility ?? 'private',
        createdBy,
      });

      return reply.code(201).send(space);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/:id',
    { schema: { tags: ['collaboration'], summary: 'Get space with members' } },
    async (request, reply) => {
      const space = await spaceStore.getSpace(request.params.id);

      if (!space) {
        return reply.code(404).send({
          error: 'SPACE_NOT_FOUND',
          message: 'Space not found',
        });
      }

      const members = await spaceStore.getMembers(space.id);
      return { ...space, members };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { schema: { tags: ['collaboration'], summary: 'Delete a space' } },
    async (request, reply) => {
      try {
        await spaceStore.deleteSpace(request.params.id);
        return { ok: true };
      } catch (err) {
        if (err instanceof ControlPlaneError && err.code === 'SPACE_NOT_FOUND') {
          return reply.code(404).send({
            error: 'SPACE_NOT_FOUND',
            message: 'Space not found',
          });
        }
        throw err;
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Members
  // ---------------------------------------------------------------------------

  app.post<{
    Params: { id: string };
    Body: { memberType: string; memberId: string; role?: string };
  }>(
    '/:id/members',
    { schema: { tags: ['collaboration'], summary: 'Add member to space' } },
    async (request, reply) => {
      const { memberType, memberId, role } = request.body;

      if (
        !memberType ||
        !SPACE_MEMBER_TYPES.includes(memberType as (typeof SPACE_MEMBER_TYPES)[number])
      ) {
        return reply.code(400).send({
          error: 'INVALID_MEMBER_TYPE',
          message: `memberType must be one of: ${SPACE_MEMBER_TYPES.join(', ')}`,
        });
      }

      if (!memberId || typeof memberId !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_MEMBER_ID',
          message: 'A non-empty "memberId" string is required',
        });
      }

      if (role && !SPACE_MEMBER_ROLES.includes(role as (typeof SPACE_MEMBER_ROLES)[number])) {
        return reply.code(400).send({
          error: 'INVALID_ROLE',
          message: `role must be one of: ${SPACE_MEMBER_ROLES.join(', ')}`,
        });
      }

      // Verify space exists
      const space = await spaceStore.getSpace(request.params.id);
      if (!space) {
        return reply.code(404).send({
          error: 'SPACE_NOT_FOUND',
          message: 'Space not found',
        });
      }

      const member = await spaceStore.addMember(request.params.id, {
        memberType,
        memberId,
        role,
      });

      return reply.code(201).send(member);
    },
  );

  app.delete<{ Params: { id: string; memberId: string }; Querystring: { memberType?: string } }>(
    '/:id/members/:memberId',
    { schema: { tags: ['collaboration'], summary: 'Remove member from space' } },
    async (request, reply) => {
      const memberType = request.query.memberType ?? 'human';

      try {
        await spaceStore.removeMember(request.params.id, memberType, request.params.memberId);
        return { ok: true };
      } catch (err) {
        if (err instanceof ControlPlaneError && err.code === 'MEMBER_NOT_FOUND') {
          return reply.code(404).send({
            error: 'MEMBER_NOT_FOUND',
            message: 'Member not found in space',
          });
        }
        throw err;
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Threads (nested under space)
  // ---------------------------------------------------------------------------

  app.get<{ Params: { id: string } }>(
    '/:id/threads',
    { schema: { tags: ['collaboration'], summary: 'List threads in space' } },
    async (request, reply) => {
      const space = await spaceStore.getSpace(request.params.id);
      if (!space) {
        return reply.code(404).send({
          error: 'SPACE_NOT_FOUND',
          message: 'Space not found',
        });
      }

      return await threadStore.listThreads(request.params.id);
    },
  );

  app.post<{
    Params: { id: string };
    Body: { type?: string; title?: string };
  }>(
    '/:id/threads',
    { schema: { tags: ['collaboration'], summary: 'Create thread in space' } },
    async (request, reply) => {
      const space = await spaceStore.getSpace(request.params.id);
      if (!space) {
        return reply.code(404).send({
          error: 'SPACE_NOT_FOUND',
          message: 'Space not found',
        });
      }

      const { type, title } = request.body;

      if (type && !isThreadType(type)) {
        return reply.code(400).send({
          error: 'INVALID_THREAD_TYPE',
          message: `type must be one of: ${THREAD_TYPES.join(', ')}`,
        });
      }

      const thread = await threadStore.createThread({
        spaceId: request.params.id,
        type: type ?? 'discussion',
        title: title ?? null,
      });

      return reply.code(201).send(thread);
    },
  );

  app.get<{ Params: { id: string; threadId: string } }>(
    '/:id/threads/:threadId',
    { schema: { tags: ['collaboration'], summary: 'Get thread by ID' } },
    async (request, reply) => {
      const thread = await threadStore.getThread(request.params.threadId);

      if (!thread || thread.spaceId !== request.params.id) {
        return reply.code(404).send({
          error: 'THREAD_NOT_FOUND',
          message: 'Thread not found',
        });
      }

      return thread;
    },
  );

  app.delete<{ Params: { id: string; threadId: string } }>(
    '/:id/threads/:threadId',
    { schema: { tags: ['collaboration'], summary: 'Delete thread' } },
    async (request, reply) => {
      const thread = await threadStore.getThread(request.params.threadId);

      if (!thread || thread.spaceId !== request.params.id) {
        return reply.code(404).send({
          error: 'THREAD_NOT_FOUND',
          message: 'Thread not found',
        });
      }

      try {
        await threadStore.deleteThread(request.params.threadId);
        return { ok: true };
      } catch (err) {
        if (err instanceof ControlPlaneError && err.code === 'THREAD_NOT_FOUND') {
          return reply.code(404).send({
            error: 'THREAD_NOT_FOUND',
            message: 'Thread not found',
          });
        }
        throw err;
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Events (nested under space/thread)
  // ---------------------------------------------------------------------------

  app.get<{
    Params: { id: string; threadId: string };
    Querystring: { after?: string; limit?: string };
  }>(
    '/:id/threads/:threadId/events',
    { schema: { tags: ['collaboration'], summary: 'Get events in thread' } },
    async (request, reply) => {
      const thread = await threadStore.getThread(request.params.threadId);

      if (!thread || thread.spaceId !== request.params.id) {
        return reply.code(404).send({
          error: 'THREAD_NOT_FOUND',
          message: 'Thread not found',
        });
      }

      const after = request.query.after ? Number(request.query.after) : undefined;
      const limit = request.query.limit ? Number(request.query.limit) : undefined;

      if (after !== undefined && (!Number.isFinite(after) || after < 0)) {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: '"after" must be a non-negative number',
        });
      }

      if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: '"limit" must be a positive number',
        });
      }

      return await eventStore.getEvents(request.params.threadId, { after, limit });
    },
  );

  app.post<{
    Params: { id: string; threadId: string };
    Body: {
      idempotencyKey: string;
      correlationId?: string;
      type: string;
      senderType: string;
      senderId: string;
      payload?: Record<string, unknown>;
      visibility?: string;
    };
  }>(
    '/:id/threads/:threadId/events',
    { schema: { tags: ['collaboration'], summary: 'Append event to thread' } },
    async (request, reply) => {
      const thread = await threadStore.getThread(request.params.threadId);

      if (!thread || thread.spaceId !== request.params.id) {
        return reply.code(404).send({
          error: 'THREAD_NOT_FOUND',
          message: 'Thread not found',
        });
      }

      const { idempotencyKey, correlationId, type, senderType, senderId, payload, visibility } =
        request.body;

      if (!idempotencyKey || typeof idempotencyKey !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_IDEMPOTENCY_KEY',
          message: 'A non-empty "idempotencyKey" string is required',
        });
      }

      if (!type || !isSpaceEventType(type)) {
        return reply.code(400).send({
          error: 'INVALID_EVENT_TYPE',
          message: `type must be one of: ${SPACE_EVENT_TYPES.join(', ')}`,
        });
      }

      if (
        !senderType ||
        !EVENT_SENDER_TYPES.includes(senderType as (typeof EVENT_SENDER_TYPES)[number])
      ) {
        return reply.code(400).send({
          error: 'INVALID_SENDER_TYPE',
          message: `senderType must be one of: ${EVENT_SENDER_TYPES.join(', ')}`,
        });
      }

      if (!senderId || typeof senderId !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_SENDER_ID',
          message: 'A non-empty "senderId" string is required',
        });
      }

      if (visibility && !isEventVisibility(visibility)) {
        return reply.code(400).send({
          error: 'INVALID_VISIBILITY',
          message: `visibility must be one of: ${EVENT_VISIBILITIES.join(', ')}`,
        });
      }

      const event = await eventStore.appendEvent({
        spaceId: request.params.id,
        threadId: request.params.threadId,
        idempotencyKey,
        correlationId,
        type,
        senderType,
        senderId,
        payload: payload ?? {},
        visibility,
      });

      return reply.code(201).send(event);
    },
  );
};
