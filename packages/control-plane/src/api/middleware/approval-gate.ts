import crypto from 'node:crypto';

import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ApprovalAction =
  | 'agent.start'
  | 'agent.stop'
  | 'agent.emergency_stop'
  | 'loop.start'
  | 'loop.stop'
  | 'schedule.create'
  | 'schedule.delete'
  | 'webhook.delete'
  | 'bulk.stop_all';

type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

type ApprovalRequest = {
  id: string;
  action: ApprovalAction;
  agentId?: string;
  requestedBy: string;
  requestedAt: Date;
  status: ApprovalStatus;
  resolvedBy?: string;
  resolvedAt?: Date;
  reason?: string;
  metadata?: Record<string, unknown>;
};

type ApprovalGateConfig = {
  enabled: boolean;
  costThresholdUsd: number;
  autoApproveAgentIds: string[];
  approvalTimeoutMs: number;
  requireApprovalFor: ApprovalAction[];
};

type ApprovalGateStats = {
  total: number;
  approved: number;
  denied: number;
  expired: number;
  pending: number;
};

type ApprovalGate = {
  requiresApproval(
    action: ApprovalAction,
    context?: { agentId?: string; estimatedCostUsd?: number },
  ): boolean;
  createRequest(
    action: ApprovalAction,
    requestedBy: string,
    metadata?: Record<string, unknown>,
  ): ApprovalRequest;
  approveRequest(requestId: string, approvedBy: string): ApprovalRequest | null;
  denyRequest(requestId: string, deniedBy: string, reason?: string): ApprovalRequest | null;
  getRequest(requestId: string): ApprovalRequest | null;
  getPendingRequests(): ApprovalRequest[];
  expireStaleRequests(): number;
  waitForApproval(requestId: string, timeoutMs?: number): Promise<ApprovalRequest>;
  getStats(): ApprovalGateStats;
};

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ApprovalGateConfig = {
  enabled: true,
  costThresholdUsd: 10,
  autoApproveAgentIds: [],
  approvalTimeoutMs: 300_000,
  requireApprovalFor: [],
};

const POLL_INTERVAL_MS = 500;

// ---------------------------------------------------------------------------
// Route -> action mapping
// ---------------------------------------------------------------------------

type RouteMapping = {
  method: string;
  pattern: RegExp;
  action: ApprovalAction;
};

const ROUTE_MAPPINGS: RouteMapping[] = [
  { method: 'POST', pattern: /\/api\/agents\/[^/]+\/start$/, action: 'agent.start' },
  { method: 'POST', pattern: /\/api\/agents\/[^/]+\/stop$/, action: 'agent.stop' },
  {
    method: 'POST',
    pattern: /\/api\/agents\/[^/]+\/emergency-stop$/,
    action: 'agent.emergency_stop',
  },
  { method: 'POST', pattern: /\/api\/agents\/[^/]+\/loop$/, action: 'loop.start' },
  { method: 'DELETE', pattern: /\/api\/agents\/[^/]+\/loop$/, action: 'loop.stop' },
  { method: 'POST', pattern: /\/api\/scheduler\/jobs\//, action: 'schedule.create' },
  { method: 'DELETE', pattern: /\/api\/scheduler\/jobs/, action: 'schedule.delete' },
  { method: 'DELETE', pattern: /\/api\/webhooks\//, action: 'webhook.delete' },
  { method: 'POST', pattern: /\/api\/agents\/emergency-stop-all$/, action: 'bulk.stop_all' },
];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an approval gate that manages approval requests for destructive or
 * high-risk operations. The gate uses in-memory storage (Map) for pending
 * requests and provides polling-based `waitForApproval`.
 */
function createApprovalGate(userConfig?: Partial<ApprovalGateConfig>): ApprovalGate {
  const config: ApprovalGateConfig = { ...DEFAULT_CONFIG, ...userConfig };
  const requests = new Map<string, ApprovalRequest>();

  function requiresApproval(
    action: ApprovalAction,
    context?: { agentId?: string; estimatedCostUsd?: number },
  ): boolean {
    if (!config.enabled) {
      return false;
    }

    // Auto-approved agents bypass all approval
    if (context?.agentId && config.autoApproveAgentIds.includes(context.agentId)) {
      return false;
    }

    // Cost-based threshold: if the estimated cost exceeds the threshold, require approval
    if (
      context?.estimatedCostUsd !== undefined &&
      context.estimatedCostUsd > config.costThresholdUsd
    ) {
      return true;
    }

    // Action-based approval
    return config.requireApprovalFor.includes(action);
  }

  function createRequest(
    action: ApprovalAction,
    requestedBy: string,
    metadata?: Record<string, unknown>,
  ): ApprovalRequest {
    const request: ApprovalRequest = {
      id: crypto.randomUUID(),
      action,
      requestedBy,
      requestedAt: new Date(),
      status: 'pending',
      metadata,
    };

    requests.set(request.id, request);
    return { ...request };
  }

  function approveRequest(requestId: string, approvedBy: string): ApprovalRequest | null {
    const request = requests.get(requestId);

    if (!request) {
      return null;
    }

    if (request.status !== 'pending') {
      return null;
    }

    request.status = 'approved';
    request.resolvedBy = approvedBy;
    request.resolvedAt = new Date();

    return { ...request };
  }

  function denyRequest(
    requestId: string,
    deniedBy: string,
    reason?: string,
  ): ApprovalRequest | null {
    const request = requests.get(requestId);

    if (!request) {
      return null;
    }

    if (request.status !== 'pending') {
      return null;
    }

    request.status = 'denied';
    request.resolvedBy = deniedBy;
    request.resolvedAt = new Date();
    request.reason = reason;

    return { ...request };
  }

  function getRequest(requestId: string): ApprovalRequest | null {
    const request = requests.get(requestId);
    return request ? { ...request } : null;
  }

  function getPendingRequests(): ApprovalRequest[] {
    const pending: ApprovalRequest[] = [];

    for (const request of requests.values()) {
      if (request.status === 'pending') {
        pending.push({ ...request });
      }
    }

    return pending;
  }

  function expireStaleRequests(): number {
    const now = Date.now();
    let expiredCount = 0;

    for (const request of requests.values()) {
      if (request.status !== 'pending') {
        continue;
      }

      const age = now - request.requestedAt.getTime();

      if (age >= config.approvalTimeoutMs) {
        request.status = 'expired';
        request.resolvedAt = new Date();
        expiredCount++;
      }
    }

    return expiredCount;
  }

  function waitForApproval(requestId: string, timeoutMs?: number): Promise<ApprovalRequest> {
    const effectiveTimeout = timeoutMs ?? config.approvalTimeoutMs;

    return new Promise<ApprovalRequest>((resolve, reject) => {
      const startTime = Date.now();

      const poll = (): void => {
        const request = requests.get(requestId);

        if (!request) {
          reject(
            new ControlPlaneError(
              'APPROVAL_NOT_FOUND',
              `Approval request '${requestId}' not found`,
              { requestId },
            ),
          );
          return;
        }

        if (request.status !== 'pending') {
          resolve({ ...request });
          return;
        }

        const elapsed = Date.now() - startTime;

        if (elapsed >= effectiveTimeout) {
          // Expire the request before rejecting
          request.status = 'expired';
          request.resolvedAt = new Date();

          reject(
            new ControlPlaneError(
              'APPROVAL_TIMEOUT',
              `Approval request '${requestId}' timed out after ${String(effectiveTimeout)}ms`,
              { requestId, timeoutMs: effectiveTimeout },
            ),
          );
          return;
        }

        setTimeout(poll, POLL_INTERVAL_MS);
      };

      poll();
    });
  }

  function getStats(): ApprovalGateStats {
    let total = 0;
    let approved = 0;
    let denied = 0;
    let expired = 0;
    let pending = 0;

    for (const request of requests.values()) {
      total++;

      switch (request.status) {
        case 'approved':
          approved++;
          break;
        case 'denied':
          denied++;
          break;
        case 'expired':
          expired++;
          break;
        case 'pending':
          pending++;
          break;
      }
    }

    return { total, approved, denied, expired, pending };
  }

  return {
    requiresApproval,
    createRequest,
    approveRequest,
    denyRequest,
    getRequest,
    getPendingRequests,
    expireStaleRequests,
    waitForApproval,
    getStats,
  };
}

// ---------------------------------------------------------------------------
// Fastify hook factory
// ---------------------------------------------------------------------------

/**
 * Resolve the ApprovalAction from an HTTP method + URL, if any match.
 */
function resolveAction(method: string, url: string): ApprovalAction | null {
  // Strip query string for matching
  const path = url.split('?')[0];

  for (const mapping of ROUTE_MAPPINGS) {
    if (mapping.method === method.toUpperCase() && mapping.pattern.test(path)) {
      return mapping.action;
    }
  }

  return null;
}

/**
 * Extract an agent ID from the URL if the route has an `:id` segment after
 * `/api/agents/`.
 */
function extractAgentId(url: string): string | undefined {
  const path = url.split('?')[0];
  const match = path.match(/\/api\/agents\/([^/]+)\//);
  return match?.[1];
}

/**
 * Create a Fastify `preHandler` hook that intercepts requests matching
 * approval-gated routes. When approval is required, the hook responds with
 * 202 Accepted and the pending approval request details. The client should
 * then poll `GET /api/approval/:id` or wait for a WebSocket notification.
 */
function createApprovalGateHook(gate: ApprovalGate): preHandlerHookHandler {
  return async function approvalGateHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const action = resolveAction(request.method, request.url);

    if (!action) {
      return;
    }

    const agentId = extractAgentId(request.url);
    const body = request.body;
    const estimatedCostUsd =
      body != null &&
      typeof body === 'object' &&
      'estimatedCostUsd' in body &&
      typeof (body as Record<string, unknown>).estimatedCostUsd === 'number'
        ? ((body as Record<string, unknown>).estimatedCostUsd as number)
        : undefined;

    if (!gate.requiresApproval(action, { agentId, estimatedCostUsd })) {
      return;
    }

    const requestedBy = request.ip ?? 'unknown';
    const approvalRequest = gate.createRequest(action, requestedBy, {
      agentId,
      url: request.url,
      method: request.method,
    });

    reply.status(202).send({
      approvalRequired: true,
      approval: approvalRequest,
      message: `Action '${action}' requires approval. Poll GET /api/approval/${approvalRequest.id} for status.`,
    });
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  createApprovalGate,
  createApprovalGateHook,
  extractAgentId,
  resolveAction,
  ROUTE_MAPPINGS,
};

export type {
  ApprovalAction,
  ApprovalGate,
  ApprovalGateConfig,
  ApprovalGateStats,
  ApprovalRequest,
  ApprovalStatus,
};
