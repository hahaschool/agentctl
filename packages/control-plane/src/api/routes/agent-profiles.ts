import {
  AGENT_INSTANCE_STATUSES,
  AGENT_RUNTIME_TYPES,
  ControlPlaneError,
  isAgentInstanceStatus,
  isAgentRuntimeType,
} from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { AgentProfileStore } from '../../collaboration/agent-profile-store.js';

export type AgentProfileRoutesOptions = {
  agentProfileStore: AgentProfileStore;
};

export const agentProfileRoutes: FastifyPluginAsync<AgentProfileRoutesOptions> = async (
  app,
  opts,
) => {
  const { agentProfileStore } = opts;

  // ── Profiles ──────────────────────────────────────────────

  app.get(
    '/',
    { schema: { tags: ['agent-identity'], summary: 'List agent profiles' } },
    async () => {
      return await agentProfileStore.listProfiles();
    },
  );

  app.post<{
    Body: {
      name: string;
      runtimeType: string;
      modelId: string;
      providerId: string;
      capabilities?: string[];
      toolScopes?: string[];
      maxTokensPerTask?: number;
      maxCostPerHour?: number;
    };
  }>(
    '/',
    { schema: { tags: ['agent-identity'], summary: 'Create agent profile' } },
    async (request, reply) => {
      const { name, runtimeType, modelId, providerId, capabilities, toolScopes } = request.body;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return reply.code(400).send({
          error: 'INVALID_NAME',
          message: 'A non-empty "name" string is required',
        });
      }

      if (!runtimeType || !isAgentRuntimeType(runtimeType)) {
        return reply.code(400).send({
          error: 'INVALID_RUNTIME_TYPE',
          message: `runtimeType must be one of: ${AGENT_RUNTIME_TYPES.join(', ')}`,
        });
      }

      if (!modelId || typeof modelId !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_MODEL_ID',
          message: 'A non-empty "modelId" string is required',
        });
      }

      if (!providerId || typeof providerId !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_PROVIDER_ID',
          message: 'A non-empty "providerId" string is required',
        });
      }

      const profile = await agentProfileStore.createProfile({
        name: name.trim(),
        runtimeType,
        modelId,
        providerId,
        capabilities,
        toolScopes,
        maxTokensPerTask: request.body.maxTokensPerTask ?? null,
        maxCostPerHour: request.body.maxCostPerHour ?? null,
      });

      return reply.code(201).send(profile);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/:id',
    { schema: { tags: ['agent-identity'], summary: 'Get agent profile' } },
    async (request, reply) => {
      const profile = await agentProfileStore.getProfile(request.params.id);
      if (!profile) {
        return reply.code(404).send({
          error: 'PROFILE_NOT_FOUND',
          message: 'Agent profile not found',
        });
      }
      return profile;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { schema: { tags: ['agent-identity'], summary: 'Delete agent profile' } },
    async (request, reply) => {
      try {
        await agentProfileStore.deleteProfile(request.params.id);
        return { ok: true };
      } catch (err) {
        if (err instanceof ControlPlaneError && err.code === 'PROFILE_NOT_FOUND') {
          return reply.code(404).send({
            error: 'PROFILE_NOT_FOUND',
            message: 'Agent profile not found',
          });
        }
        throw err;
      }
    },
  );

  // ── Instances ─────────────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    '/:id/instances',
    { schema: { tags: ['agent-identity'], summary: 'List instances for profile' } },
    async (request, reply) => {
      const profile = await agentProfileStore.getProfile(request.params.id);
      if (!profile) {
        return reply.code(404).send({
          error: 'PROFILE_NOT_FOUND',
          message: 'Agent profile not found',
        });
      }
      return await agentProfileStore.listInstancesByProfile(request.params.id);
    },
  );

  app.post<{
    Params: { id: string };
    Body: {
      machineId?: string;
      worktreeId?: string;
      runtimeSessionId?: string;
      status?: string;
    };
  }>(
    '/:id/instances',
    { schema: { tags: ['agent-identity'], summary: 'Create agent instance' } },
    async (request, reply) => {
      const profile = await agentProfileStore.getProfile(request.params.id);
      if (!profile) {
        return reply.code(404).send({
          error: 'PROFILE_NOT_FOUND',
          message: 'Agent profile not found',
        });
      }

      if (request.body.status && !isAgentInstanceStatus(request.body.status)) {
        return reply.code(400).send({
          error: 'INVALID_STATUS',
          message: `status must be one of: ${AGENT_INSTANCE_STATUSES.join(', ')}`,
        });
      }

      const instance = await agentProfileStore.createInstance({
        profileId: request.params.id,
        machineId: request.body.machineId,
        worktreeId: request.body.worktreeId,
        runtimeSessionId: request.body.runtimeSessionId,
        status: request.body.status,
      });

      return reply.code(201).send(instance);
    },
  );

  app.patch<{
    Params: { id: string; instanceId: string };
    Body: {
      status?: string;
      machineId?: string;
      worktreeId?: string;
      runtimeSessionId?: string;
    };
  }>(
    '/:id/instances/:instanceId',
    { schema: { tags: ['agent-identity'], summary: 'Update agent instance' } },
    async (request, reply) => {
      if (request.body.status && !isAgentInstanceStatus(request.body.status)) {
        return reply.code(400).send({
          error: 'INVALID_STATUS',
          message: `status must be one of: ${AGENT_INSTANCE_STATUSES.join(', ')}`,
        });
      }

      try {
        const instance = await agentProfileStore.updateInstance(
          request.params.instanceId,
          request.body,
        );
        return instance;
      } catch (err) {
        if (err instanceof ControlPlaneError && err.code === 'INSTANCE_NOT_FOUND') {
          return reply.code(404).send({
            error: 'INSTANCE_NOT_FOUND',
            message: 'Agent instance not found',
          });
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string; instanceId: string } }>(
    '/:id/instances/:instanceId',
    { schema: { tags: ['agent-identity'], summary: 'Delete agent instance' } },
    async (request, reply) => {
      try {
        await agentProfileStore.deleteInstance(request.params.instanceId);
        return { ok: true };
      } catch (err) {
        if (err instanceof ControlPlaneError && err.code === 'INSTANCE_NOT_FOUND') {
          return reply.code(404).send({
            error: 'INSTANCE_NOT_FOUND',
            message: 'Agent instance not found',
          });
        }
        throw err;
      }
    },
  );
};
