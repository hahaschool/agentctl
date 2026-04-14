import {
  APPROVAL_DECISION_ACTIONS,
  APPROVAL_TIMEOUT_POLICIES,
  ControlPlaneError,
  isApprovalDecisionAction,
  isApprovalTimeoutPolicy,
} from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import type { ApprovalStore } from '../../collaboration/approval-store.js';

// Approval payloads are durable, user-facing records: approver lists and
// comments are rendered in the web + mobile UIs and are long-lived. Caps
// prevent unbounded blobs (comment/approver lists) and protect against
// integer-overflow style inputs on numeric fields.
const MAX_APPROVAL_ID_LENGTH = 128;
const MAX_APPROVAL_APPROVERS = 64;
const MAX_APPROVAL_COMMENT_LENGTH = 8_192;
const MAX_APPROVAL_CONTEXT_ARTIFACTS = 256;
const MAX_APPROVAL_REQUIRED_COUNT = 1_000;
const MAX_APPROVAL_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1_000; // 30 days

const trimmedId = (max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(max));

const optionalTrimmedId = (max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(max))
    .optional();

const createGateBodySchema = z.object({
  taskDefinitionId: trimmedId(MAX_APPROVAL_ID_LENGTH),
  taskRunId: optionalTrimmedId(MAX_APPROVAL_ID_LENGTH),
  threadId: optionalTrimmedId(MAX_APPROVAL_ID_LENGTH),
  requiredApprovers: z
    .array(z.string().min(1).max(MAX_APPROVAL_ID_LENGTH))
    .max(MAX_APPROVAL_APPROVERS)
    .optional(),
  requiredCount: z.number().int().positive().max(MAX_APPROVAL_REQUIRED_COUNT).optional(),
  timeoutMs: z.number().int().nonnegative().max(MAX_APPROVAL_TIMEOUT_MS).optional(),
  timeoutPolicy: z
    .string()
    .refine(isApprovalTimeoutPolicy, { message: 'invalid timeoutPolicy' })
    .optional(),
  contextArtifactIds: z
    .array(z.string().min(1).max(MAX_APPROVAL_ID_LENGTH))
    .max(MAX_APPROVAL_CONTEXT_ARTIFACTS)
    .optional(),
});

const addDecisionBodySchema = z.object({
  decidedBy: trimmedId(MAX_APPROVAL_ID_LENGTH),
  action: z.string().refine(isApprovalDecisionAction, { message: 'invalid action' }),
  comment: z.string().max(MAX_APPROVAL_COMMENT_LENGTH).optional(),
  viaTimeout: z.boolean().optional(),
});

function mapCreateGateIssue(issue: z.ZodIssue | undefined): { error: string; message: string } {
  const field = issue?.path[0];
  switch (field) {
    case 'taskDefinitionId':
      return {
        error: 'INVALID_TASK_DEFINITION_ID',
        message: 'A non-empty "taskDefinitionId" string is required',
      };
    case 'taskRunId':
      return { error: 'INVALID_TASK_RUN_ID', message: '"taskRunId" must be a bounded string' };
    case 'threadId':
      return { error: 'INVALID_THREAD_ID', message: '"threadId" must be a bounded string' };
    case 'requiredApprovers':
      return {
        error: 'INVALID_REQUIRED_APPROVERS',
        message: `"requiredApprovers" must be an array of up to ${MAX_APPROVAL_APPROVERS} non-empty strings (≤ ${MAX_APPROVAL_ID_LENGTH} chars each)`,
      };
    case 'requiredCount':
      return {
        error: 'INVALID_REQUIRED_COUNT',
        message: `"requiredCount" must be a positive integer ≤ ${MAX_APPROVAL_REQUIRED_COUNT}`,
      };
    case 'timeoutMs':
      return {
        error: 'INVALID_TIMEOUT_MS',
        message: `"timeoutMs" must be a non-negative integer ≤ ${MAX_APPROVAL_TIMEOUT_MS}`,
      };
    case 'timeoutPolicy':
      return {
        error: 'INVALID_TIMEOUT_POLICY',
        message: `timeoutPolicy must be one of: ${APPROVAL_TIMEOUT_POLICIES.join(', ')}`,
      };
    case 'contextArtifactIds':
      return {
        error: 'INVALID_CONTEXT_ARTIFACT_IDS',
        message: `"contextArtifactIds" must be an array of up to ${MAX_APPROVAL_CONTEXT_ARTIFACTS} non-empty strings`,
      };
    default:
      return { error: 'INVALID_APPROVAL_GATE_BODY', message: 'Invalid approval gate body' };
  }
}

function mapAddDecisionIssue(issue: z.ZodIssue | undefined): { error: string; message: string } {
  const field = issue?.path[0];
  switch (field) {
    case 'decidedBy':
      return {
        error: 'INVALID_DECIDED_BY',
        message: 'A non-empty "decidedBy" string is required',
      };
    case 'action':
      return {
        error: 'INVALID_ACTION',
        message: `action must be one of: ${APPROVAL_DECISION_ACTIONS.join(', ')}`,
      };
    case 'comment':
      return {
        error: 'INVALID_COMMENT',
        message: `"comment" must be a string of at most ${MAX_APPROVAL_COMMENT_LENGTH} characters`,
      };
    case 'viaTimeout':
      return { error: 'INVALID_VIA_TIMEOUT', message: '"viaTimeout" must be a boolean' };
    default:
      return { error: 'INVALID_APPROVAL_DECISION_BODY', message: 'Invalid approval decision body' };
  }
}

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
      const parsed = createGateBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(mapCreateGateIssue(parsed.error.issues[0]));
      }
      const {
        taskDefinitionId,
        taskRunId,
        threadId,
        requiredApprovers,
        requiredCount,
        timeoutMs,
        timeoutPolicy,
        contextArtifactIds,
      } = parsed.data;

      const gate = await approvalStore.createGate({
        taskDefinitionId,
        taskRunId,
        threadId,
        requiredApprovers,
        requiredCount,
        timeoutMs,
        timeoutPolicy,
        contextArtifactIds,
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

  const listGatesQuerySchema = z.object({
    threadId: trimmedId(MAX_APPROVAL_ID_LENGTH),
  });

  app.get<{ Querystring: { threadId: string } }>(
    '/',
    { schema: { tags: ['approvals'], summary: 'List approval gates by thread' } },
    async (request, reply) => {
      const parsed = listGatesQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'INVALID_THREAD_ID',
          message: `A non-empty "threadId" query parameter of at most ${MAX_APPROVAL_ID_LENGTH} characters is required`,
        });
      }

      return await approvalStore.listGatesByThread(parsed.data.threadId);
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
      const parsed = addDecisionBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(mapAddDecisionIssue(parsed.error.issues[0]));
      }
      const { decidedBy, action, comment, viaTimeout } = parsed.data;

      try {
        const decision = await approvalStore.addDecision({
          gateId: request.params.id,
          decidedBy,
          action,
          comment,
          viaTimeout,
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
