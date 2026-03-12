import {
  APPROVAL_DECISION_ACTIONS,
  APPROVAL_TIMEOUT_POLICIES,
  ControlPlaneError,
  isApprovalDecisionAction,
  isApprovalTimeoutPolicy,
} from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { ApprovalStore } from '../../collaboration/approval-store.js';

export type ApprovalRoutesOptions = {
  approvalStore: ApprovalStore;
};

export const approvalRoutes: FastifyPluginAsync<ApprovalRoutesOptions> = async (app, opts) => {
  const { approvalStore } = opts;

  // ── Gates ─────────────────────────────────────────────────

  app.post<{
    Body: {
      taskDefinitionId: string;
      taskRunId?: string;
      threadId?: string;
      requiredApprovers?: string[];
      requiredCount?: number;
      timeoutMs?: number;
      timeoutPolicy?: string;
      contextArtifactIds?: string[];
    };
  }>(
    '/',
    { schema: { tags: ['approvals'], summary: 'Create approval gate' } },
    async (request, reply) => {
      const { taskDefinitionId, timeoutPolicy } = request.body;

      if (!taskDefinitionId || typeof taskDefinitionId !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_TASK_DEFINITION_ID',
          message: 'A non-empty "taskDefinitionId" string is required',
        });
      }

      if (timeoutPolicy && !isApprovalTimeoutPolicy(timeoutPolicy)) {
        return reply.code(400).send({
          error: 'INVALID_TIMEOUT_POLICY',
          message: `timeoutPolicy must be one of: ${APPROVAL_TIMEOUT_POLICIES.join(', ')}`,
        });
      }

      const gate = await approvalStore.createGate({
        taskDefinitionId,
        taskRunId: request.body.taskRunId,
        threadId: request.body.threadId,
        requiredApprovers: request.body.requiredApprovers,
        requiredCount: request.body.requiredCount,
        timeoutMs: request.body.timeoutMs,
        timeoutPolicy,
        contextArtifactIds: request.body.contextArtifactIds,
      });

      return reply.code(201).send(gate);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/:id',
    { schema: { tags: ['approvals'], summary: 'Get approval gate' } },
    async (request, reply) => {
      const gate = await approvalStore.getGate(request.params.id);
      if (!gate) {
        return reply.code(404).send({
          error: 'GATE_NOT_FOUND',
          message: 'Approval gate not found',
        });
      }

      const decisions = await approvalStore.getDecisions(gate.id);
      return { ...gate, decisions };
    },
  );

  app.get<{ Querystring: { threadId: string } }>(
    '/',
    { schema: { tags: ['approvals'], summary: 'List approval gates by thread' } },
    async (request, reply) => {
      const { threadId } = request.query;
      if (!threadId || typeof threadId !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_THREAD_ID',
          message: 'A "threadId" query parameter is required',
        });
      }

      return await approvalStore.listGatesByThread(threadId);
    },
  );

  // ── Decisions ─────────────────────────────────────────────

  app.post<{
    Params: { id: string };
    Body: {
      decidedBy: string;
      action: string;
      comment?: string;
      viaTimeout?: boolean;
    };
  }>(
    '/:id/decisions',
    { schema: { tags: ['approvals'], summary: 'Add decision to approval gate' } },
    async (request, reply) => {
      const { decidedBy, action } = request.body;

      if (!decidedBy || typeof decidedBy !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_DECIDED_BY',
          message: 'A non-empty "decidedBy" string is required',
        });
      }

      if (!action || !isApprovalDecisionAction(action)) {
        return reply.code(400).send({
          error: 'INVALID_ACTION',
          message: `action must be one of: ${APPROVAL_DECISION_ACTIONS.join(', ')}`,
        });
      }

      try {
        const decision = await approvalStore.addDecision({
          gateId: request.params.id,
          decidedBy,
          action,
          comment: request.body.comment,
          viaTimeout: request.body.viaTimeout,
        });

        return reply.code(201).send(decision);
      } catch (err) {
        if (err instanceof ControlPlaneError) {
          if (err.code === 'GATE_NOT_FOUND') {
            return reply.code(404).send({
              error: 'GATE_NOT_FOUND',
              message: 'Approval gate not found',
            });
          }
          if (err.code === 'GATE_ALREADY_RESOLVED') {
            return reply.code(409).send({
              error: 'GATE_ALREADY_RESOLVED',
              message: err.message,
            });
          }
        }
        throw err;
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/:id/decisions',
    { schema: { tags: ['approvals'], summary: 'Get decisions for approval gate' } },
    async (request, reply) => {
      const gate = await approvalStore.getGate(request.params.id);
      if (!gate) {
        return reply.code(404).send({
          error: 'GATE_NOT_FOUND',
          message: 'Approval gate not found',
        });
      }

      return await approvalStore.getDecisions(request.params.id);
    },
  );
};
