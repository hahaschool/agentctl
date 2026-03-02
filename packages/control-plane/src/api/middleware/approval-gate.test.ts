import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  type ApprovalAction,
  type ApprovalGate,
  type ApprovalGateConfig,
  createApprovalGate,
  createApprovalGateHook,
  extractAgentId,
  resolveAction,
} from './approval-gate.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_ACTIONS: ApprovalAction[] = [
  'agent.start',
  'agent.stop',
  'agent.emergency_stop',
  'loop.start',
  'loop.stop',
  'schedule.create',
  'schedule.delete',
  'webhook.delete',
  'bulk.stop_all',
];

function makeGate(overrides?: Partial<ApprovalGateConfig>): ApprovalGate {
  return createApprovalGate({
    enabled: true,
    costThresholdUsd: 10,
    autoApproveAgentIds: [],
    approvalTimeoutMs: 300_000,
    requireApprovalFor: ALL_ACTIONS,
    ...overrides,
  });
}

// =========================================================================
// requiresApproval — basic action matching
// =========================================================================

describe('requiresApproval', () => {
  it('returns true for an action that is in requireApprovalFor', () => {
    const gate = makeGate({ requireApprovalFor: ['agent.start'] });
    expect(gate.requiresApproval('agent.start')).toBe(true);
  });

  it('returns false for an action NOT in requireApprovalFor', () => {
    const gate = makeGate({ requireApprovalFor: ['agent.start'] });
    expect(gate.requiresApproval('agent.stop')).toBe(false);
  });

  it('returns false when gate is disabled', () => {
    const gate = makeGate({ enabled: false, requireApprovalFor: ALL_ACTIONS });
    expect(gate.requiresApproval('agent.start')).toBe(false);
  });

  it('returns true for every action in the configured list', () => {
    const gate = makeGate({ requireApprovalFor: ALL_ACTIONS });

    for (const action of ALL_ACTIONS) {
      expect(gate.requiresApproval(action)).toBe(true);
    }
  });

  it('returns false for all actions when requireApprovalFor is empty', () => {
    const gate = makeGate({ requireApprovalFor: [] });

    for (const action of ALL_ACTIONS) {
      expect(gate.requiresApproval(action)).toBe(false);
    }
  });

  it('returns false for all actions when disabled even if requireApprovalFor is populated', () => {
    const gate = makeGate({ enabled: false, requireApprovalFor: ALL_ACTIONS });

    for (const action of ALL_ACTIONS) {
      expect(gate.requiresApproval(action)).toBe(false);
    }
  });
});

// =========================================================================
// requiresApproval — auto-approve agent IDs
// =========================================================================

describe('requiresApproval — auto-approve agents', () => {
  it('returns false for an auto-approved agent', () => {
    const gate = makeGate({
      requireApprovalFor: ['agent.start'],
      autoApproveAgentIds: ['audit-agent'],
    });
    expect(gate.requiresApproval('agent.start', { agentId: 'audit-agent' })).toBe(false);
  });

  it('returns true for a non-auto-approved agent', () => {
    const gate = makeGate({
      requireApprovalFor: ['agent.start'],
      autoApproveAgentIds: ['audit-agent'],
    });
    expect(gate.requiresApproval('agent.start', { agentId: 'regular-agent' })).toBe(true);
  });

  it('returns true when no agentId is provided even if autoApproveAgentIds is set', () => {
    const gate = makeGate({
      requireApprovalFor: ['agent.start'],
      autoApproveAgentIds: ['audit-agent'],
    });
    expect(gate.requiresApproval('agent.start')).toBe(true);
  });

  it('returns false for auto-approved agent even with high cost', () => {
    const gate = makeGate({
      requireApprovalFor: [],
      autoApproveAgentIds: ['audit-agent'],
      costThresholdUsd: 5,
    });
    expect(
      gate.requiresApproval('agent.start', { agentId: 'audit-agent', estimatedCostUsd: 100 }),
    ).toBe(false);
  });

  it('handles multiple auto-approved agents', () => {
    const gate = makeGate({
      requireApprovalFor: ALL_ACTIONS,
      autoApproveAgentIds: ['agent-a', 'agent-b', 'agent-c'],
    });
    expect(gate.requiresApproval('agent.start', { agentId: 'agent-a' })).toBe(false);
    expect(gate.requiresApproval('agent.start', { agentId: 'agent-b' })).toBe(false);
    expect(gate.requiresApproval('agent.start', { agentId: 'agent-c' })).toBe(false);
    expect(gate.requiresApproval('agent.start', { agentId: 'agent-d' })).toBe(true);
  });
});

// =========================================================================
// requiresApproval — cost threshold
// =========================================================================

describe('requiresApproval — cost threshold', () => {
  it('returns true when estimatedCostUsd exceeds the threshold', () => {
    const gate = makeGate({ requireApprovalFor: [], costThresholdUsd: 10 });
    expect(gate.requiresApproval('agent.start', { estimatedCostUsd: 11 })).toBe(true);
  });

  it('returns false when estimatedCostUsd equals the threshold', () => {
    const gate = makeGate({ requireApprovalFor: [], costThresholdUsd: 10 });
    expect(gate.requiresApproval('agent.start', { estimatedCostUsd: 10 })).toBe(false);
  });

  it('returns false when estimatedCostUsd is below the threshold', () => {
    const gate = makeGate({ requireApprovalFor: [], costThresholdUsd: 10 });
    expect(gate.requiresApproval('agent.start', { estimatedCostUsd: 5 })).toBe(false);
  });

  it('returns false when estimatedCostUsd is zero', () => {
    const gate = makeGate({ requireApprovalFor: [], costThresholdUsd: 10 });
    expect(gate.requiresApproval('agent.start', { estimatedCostUsd: 0 })).toBe(false);
  });

  it('returns false when estimatedCostUsd is not provided', () => {
    const gate = makeGate({ requireApprovalFor: [], costThresholdUsd: 10 });
    expect(gate.requiresApproval('agent.start', {})).toBe(false);
  });

  it('cost threshold and action list are combined with OR logic', () => {
    const gate = makeGate({
      requireApprovalFor: ['agent.start'],
      costThresholdUsd: 10,
    });
    // Action match but low cost -> true (action match alone is sufficient)
    expect(gate.requiresApproval('agent.start', { estimatedCostUsd: 1 })).toBe(true);
    // High cost but different action -> true (cost alone is sufficient)
    expect(gate.requiresApproval('agent.stop', { estimatedCostUsd: 50 })).toBe(true);
  });

  it('returns true when cost exceeds threshold even if action is not in the list', () => {
    const gate = makeGate({
      requireApprovalFor: ['agent.start'],
      costThresholdUsd: 5,
    });
    expect(gate.requiresApproval('webhook.delete', { estimatedCostUsd: 100 })).toBe(true);
  });
});

// =========================================================================
// createRequest
// =========================================================================

describe('createRequest', () => {
  it('creates a pending approval request with a unique ID', () => {
    const gate = makeGate();
    const request = gate.createRequest('agent.start', '192.168.1.1');

    expect(request.id).toBeTruthy();
    expect(typeof request.id).toBe('string');
    expect(request.action).toBe('agent.start');
    expect(request.requestedBy).toBe('192.168.1.1');
    expect(request.status).toBe('pending');
    expect(request.requestedAt).toBeInstanceOf(Date);
  });

  it('generates unique IDs for each request', () => {
    const gate = makeGate();
    const r1 = gate.createRequest('agent.start', 'user-a');
    const r2 = gate.createRequest('agent.start', 'user-a');
    expect(r1.id).not.toBe(r2.id);
  });

  it('stores metadata on the request', () => {
    const gate = makeGate();
    const meta = { agentId: 'agent-1', reason: 'test run' };
    const request = gate.createRequest('agent.start', 'admin', meta);
    expect(request.metadata).toEqual(meta);
  });

  it('creates a request without metadata', () => {
    const gate = makeGate();
    const request = gate.createRequest('agent.stop', 'admin');
    expect(request.metadata).toBeUndefined();
  });

  it('returns a copy (not a reference to the internal object)', () => {
    const gate = makeGate();
    const request = gate.createRequest('agent.start', 'admin');
    request.status = 'approved';

    const stored = gate.getRequest(request.id);
    expect(stored?.status).toBe('pending');
  });
});

// =========================================================================
// approveRequest
// =========================================================================

describe('approveRequest', () => {
  it('marks a pending request as approved', () => {
    const gate = makeGate();
    const request = gate.createRequest('agent.start', 'requester');
    const approved = gate.approveRequest(request.id, 'admin');

    expect(approved).not.toBeNull();
    expect(approved?.status).toBe('approved');
    expect(approved?.resolvedBy).toBe('admin');
    expect(approved?.resolvedAt).toBeInstanceOf(Date);
  });

  it('returns null for a non-existent request', () => {
    const gate = makeGate();
    const result = gate.approveRequest('non-existent-id', 'admin');
    expect(result).toBeNull();
  });

  it('returns null when approving an already-approved request (double approve)', () => {
    const gate = makeGate();
    const request = gate.createRequest('agent.start', 'requester');
    gate.approveRequest(request.id, 'admin');
    const second = gate.approveRequest(request.id, 'admin-2');
    expect(second).toBeNull();
  });

  it('returns null when approving an already-denied request', () => {
    const gate = makeGate();
    const request = gate.createRequest('agent.start', 'requester');
    gate.denyRequest(request.id, 'admin');
    const result = gate.approveRequest(request.id, 'other-admin');
    expect(result).toBeNull();
  });

  it('returns null when approving an expired request', () => {
    const gate = makeGate({ approvalTimeoutMs: 0 });
    const request = gate.createRequest('agent.start', 'requester');
    gate.expireStaleRequests();
    const result = gate.approveRequest(request.id, 'admin');
    expect(result).toBeNull();
  });

  it('returns a copy (not a reference to the internal object)', () => {
    const gate = makeGate();
    const request = gate.createRequest('agent.start', 'requester');
    const approved = gate.approveRequest(request.id, 'admin');

    if (approved) {
      approved.resolvedBy = 'tampered';
    }

    const stored = gate.getRequest(request.id);
    expect(stored?.resolvedBy).toBe('admin');
  });
});

// =========================================================================
// denyRequest
// =========================================================================

describe('denyRequest', () => {
  it('marks a pending request as denied', () => {
    const gate = makeGate();
    const request = gate.createRequest('agent.start', 'requester');
    const denied = gate.denyRequest(request.id, 'admin', 'not safe');

    expect(denied).not.toBeNull();
    expect(denied?.status).toBe('denied');
    expect(denied?.resolvedBy).toBe('admin');
    expect(denied?.reason).toBe('not safe');
    expect(denied?.resolvedAt).toBeInstanceOf(Date);
  });

  it('denies without a reason', () => {
    const gate = makeGate();
    const request = gate.createRequest('agent.start', 'requester');
    const denied = gate.denyRequest(request.id, 'admin');
    expect(denied?.reason).toBeUndefined();
  });

  it('returns null for a non-existent request', () => {
    const gate = makeGate();
    const result = gate.denyRequest('no-such-id', 'admin');
    expect(result).toBeNull();
  });

  it('returns null when denying an already-denied request (double deny)', () => {
    const gate = makeGate();
    const request = gate.createRequest('agent.start', 'requester');
    gate.denyRequest(request.id, 'admin', 'first deny');
    const second = gate.denyRequest(request.id, 'admin-2', 'second deny');
    expect(second).toBeNull();
  });

  it('returns null when denying an already-approved request', () => {
    const gate = makeGate();
    const request = gate.createRequest('agent.start', 'requester');
    gate.approveRequest(request.id, 'admin');
    const result = gate.denyRequest(request.id, 'other');
    expect(result).toBeNull();
  });
});

// =========================================================================
// getRequest
// =========================================================================

describe('getRequest', () => {
  it('returns the request by ID', () => {
    const gate = makeGate();
    const created = gate.createRequest('agent.start', 'requester');
    const fetched = gate.getRequest(created.id);

    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.action).toBe('agent.start');
    expect(fetched?.status).toBe('pending');
  });

  it('returns null for unknown ID', () => {
    const gate = makeGate();
    expect(gate.getRequest('unknown')).toBeNull();
  });

  it('reflects updated status after approval', () => {
    const gate = makeGate();
    const request = gate.createRequest('agent.start', 'requester');
    gate.approveRequest(request.id, 'admin');
    const fetched = gate.getRequest(request.id);
    expect(fetched?.status).toBe('approved');
  });

  it('reflects updated status after denial', () => {
    const gate = makeGate();
    const request = gate.createRequest('agent.start', 'requester');
    gate.denyRequest(request.id, 'admin');
    const fetched = gate.getRequest(request.id);
    expect(fetched?.status).toBe('denied');
  });

  it('returns a copy that does not mutate internal state', () => {
    const gate = makeGate();
    const request = gate.createRequest('agent.start', 'requester');
    const fetched = gate.getRequest(request.id);

    if (fetched) {
      fetched.status = 'denied';
    }

    const stored = gate.getRequest(request.id);
    expect(stored?.status).toBe('pending');
  });
});

// =========================================================================
// getPendingRequests
// =========================================================================

describe('getPendingRequests', () => {
  it('returns only pending requests', () => {
    const gate = makeGate();
    const r1 = gate.createRequest('agent.start', 'user-a');
    const r2 = gate.createRequest('agent.stop', 'user-b');
    gate.createRequest('loop.start', 'user-c');
    gate.approveRequest(r1.id, 'admin');
    gate.denyRequest(r2.id, 'admin');

    const pending = gate.getPendingRequests();
    expect(pending).toHaveLength(1);
    expect(pending[0].action).toBe('loop.start');
  });

  it('returns an empty array when no requests exist', () => {
    const gate = makeGate();
    expect(gate.getPendingRequests()).toEqual([]);
  });

  it('returns an empty array when all requests are resolved', () => {
    const gate = makeGate();
    const r1 = gate.createRequest('agent.start', 'user');
    gate.approveRequest(r1.id, 'admin');
    expect(gate.getPendingRequests()).toEqual([]);
  });

  it('returns multiple pending requests', () => {
    const gate = makeGate();
    gate.createRequest('agent.start', 'user-a');
    gate.createRequest('agent.stop', 'user-b');
    gate.createRequest('loop.start', 'user-c');

    const pending = gate.getPendingRequests();
    expect(pending).toHaveLength(3);
  });
});

// =========================================================================
// expireStaleRequests
// =========================================================================

describe('expireStaleRequests', () => {
  it('expires pending requests older than approvalTimeoutMs', () => {
    const gate = makeGate({ approvalTimeoutMs: 0 });
    gate.createRequest('agent.start', 'user');
    gate.createRequest('agent.stop', 'user');

    const expired = gate.expireStaleRequests();
    expect(expired).toBe(2);
  });

  it('returns 0 when no requests are stale', () => {
    const gate = makeGate({ approvalTimeoutMs: 300_000 });
    gate.createRequest('agent.start', 'user');

    const expired = gate.expireStaleRequests();
    expect(expired).toBe(0);
  });

  it('does not expire already-approved requests', () => {
    const gate = makeGate({ approvalTimeoutMs: 0 });
    const r = gate.createRequest('agent.start', 'user');
    gate.approveRequest(r.id, 'admin');

    const expired = gate.expireStaleRequests();
    expect(expired).toBe(0);
    expect(gate.getRequest(r.id)?.status).toBe('approved');
  });

  it('does not expire already-denied requests', () => {
    const gate = makeGate({ approvalTimeoutMs: 0 });
    const r = gate.createRequest('agent.start', 'user');
    gate.denyRequest(r.id, 'admin');

    const expired = gate.expireStaleRequests();
    expect(expired).toBe(0);
    expect(gate.getRequest(r.id)?.status).toBe('denied');
  });

  it('sets resolvedAt on expired requests', () => {
    const gate = makeGate({ approvalTimeoutMs: 0 });
    const r = gate.createRequest('agent.start', 'user');

    gate.expireStaleRequests();

    const fetched = gate.getRequest(r.id);
    expect(fetched?.status).toBe('expired');
    expect(fetched?.resolvedAt).toBeInstanceOf(Date);
  });

  it('does not double-expire already expired requests', () => {
    const gate = makeGate({ approvalTimeoutMs: 0 });
    gate.createRequest('agent.start', 'user');

    const first = gate.expireStaleRequests();
    const second = gate.expireStaleRequests();
    expect(first).toBe(1);
    expect(second).toBe(0);
  });
});

// =========================================================================
// waitForApproval
// =========================================================================

describe('waitForApproval', () => {
  it('resolves immediately if the request is already approved', async () => {
    const gate = makeGate();
    const r = gate.createRequest('agent.start', 'user');
    gate.approveRequest(r.id, 'admin');

    const result = await gate.waitForApproval(r.id);
    expect(result.status).toBe('approved');
  });

  it('resolves immediately if the request is already denied', async () => {
    const gate = makeGate();
    const r = gate.createRequest('agent.start', 'user');
    gate.denyRequest(r.id, 'admin');

    const result = await gate.waitForApproval(r.id);
    expect(result.status).toBe('denied');
  });

  it('resolves when the request is approved after a delay', async () => {
    const gate = makeGate();
    const r = gate.createRequest('agent.start', 'user');

    // Approve after 100ms
    setTimeout(() => gate.approveRequest(r.id, 'admin'), 100);

    const result = await gate.waitForApproval(r.id, 5000);
    expect(result.status).toBe('approved');
  });

  it('resolves when the request is denied after a delay', async () => {
    const gate = makeGate();
    const r = gate.createRequest('agent.start', 'user');

    setTimeout(() => gate.denyRequest(r.id, 'admin', 'nope'), 100);

    const result = await gate.waitForApproval(r.id, 5000);
    expect(result.status).toBe('denied');
    expect(result.reason).toBe('nope');
  });

  it('rejects with APPROVAL_TIMEOUT when timeout is exceeded', async () => {
    const gate = makeGate({ approvalTimeoutMs: 500 });
    const r = gate.createRequest('agent.start', 'user');

    await expect(gate.waitForApproval(r.id, 600)).rejects.toThrow('timed out');
  });

  it('rejects with APPROVAL_NOT_FOUND for non-existent request', async () => {
    const gate = makeGate();

    await expect(gate.waitForApproval('non-existent')).rejects.toThrow('not found');
  });

  it('marks the request as expired when timeout is reached', async () => {
    const gate = makeGate();
    const r = gate.createRequest('agent.start', 'user');

    try {
      await gate.waitForApproval(r.id, 600);
    } catch {
      // expected
    }

    const fetched = gate.getRequest(r.id);
    expect(fetched?.status).toBe('expired');
  });

  it('uses config approvalTimeoutMs when no override is provided', async () => {
    const gate = makeGate({ approvalTimeoutMs: 600 });
    const r = gate.createRequest('agent.start', 'user');

    await expect(gate.waitForApproval(r.id)).rejects.toThrow('timed out');
  });
});

// =========================================================================
// getStats
// =========================================================================

describe('getStats', () => {
  it('returns all zeros when no requests exist', () => {
    const gate = makeGate();
    expect(gate.getStats()).toEqual({
      total: 0,
      approved: 0,
      denied: 0,
      expired: 0,
      pending: 0,
    });
  });

  it('counts a single pending request', () => {
    const gate = makeGate();
    gate.createRequest('agent.start', 'user');

    const stats = gate.getStats();
    expect(stats.total).toBe(1);
    expect(stats.pending).toBe(1);
  });

  it('accumulates stats across all statuses', () => {
    const gate = makeGate({ approvalTimeoutMs: 0 });
    const r1 = gate.createRequest('agent.start', 'user');
    const r2 = gate.createRequest('agent.stop', 'user');
    gate.createRequest('loop.start', 'user');
    gate.createRequest('loop.stop', 'user');

    gate.approveRequest(r1.id, 'admin');
    gate.denyRequest(r2.id, 'admin');
    gate.expireStaleRequests(); // expires r3 and the unnamed r4

    // r3 is expired, the unnamed loop.stop (r4) is also expired
    const stats = gate.getStats();
    expect(stats.total).toBe(4);
    expect(stats.approved).toBe(1);
    expect(stats.denied).toBe(1);
    expect(stats.expired).toBe(2);
    expect(stats.pending).toBe(0);
  });

  it('updates when new requests are added', () => {
    const gate = makeGate();
    expect(gate.getStats().total).toBe(0);

    gate.createRequest('agent.start', 'user');
    expect(gate.getStats().total).toBe(1);

    gate.createRequest('agent.stop', 'user');
    expect(gate.getStats().total).toBe(2);
  });
});

// =========================================================================
// Full request lifecycle
// =========================================================================

describe('request lifecycle', () => {
  it('create -> approve -> verify status', () => {
    const gate = makeGate();
    const r = gate.createRequest('agent.start', 'requester');
    expect(r.status).toBe('pending');

    const approved = gate.approveRequest(r.id, 'admin');
    expect(approved?.status).toBe('approved');

    const fetched = gate.getRequest(r.id);
    expect(fetched?.status).toBe('approved');
    expect(fetched?.resolvedBy).toBe('admin');
  });

  it('create -> deny -> verify status', () => {
    const gate = makeGate();
    const r = gate.createRequest('agent.start', 'requester');
    const denied = gate.denyRequest(r.id, 'admin', 'too risky');

    expect(denied?.status).toBe('denied');
    expect(denied?.reason).toBe('too risky');

    const fetched = gate.getRequest(r.id);
    expect(fetched?.status).toBe('denied');
  });

  it('create -> expire -> verify status', () => {
    const gate = makeGate({ approvalTimeoutMs: 0 });
    const r = gate.createRequest('agent.start', 'requester');

    const count = gate.expireStaleRequests();
    expect(count).toBe(1);

    const fetched = gate.getRequest(r.id);
    expect(fetched?.status).toBe('expired');
  });

  it('pending requests decrease as they are resolved', () => {
    const gate = makeGate();
    const r1 = gate.createRequest('agent.start', 'user');
    const r2 = gate.createRequest('agent.stop', 'user');
    const r3 = gate.createRequest('loop.start', 'user');

    expect(gate.getPendingRequests()).toHaveLength(3);

    gate.approveRequest(r1.id, 'admin');
    expect(gate.getPendingRequests()).toHaveLength(2);

    gate.denyRequest(r2.id, 'admin');
    expect(gate.getPendingRequests()).toHaveLength(1);

    gate.approveRequest(r3.id, 'admin');
    expect(gate.getPendingRequests()).toHaveLength(0);
  });
});

// =========================================================================
// resolveAction
// =========================================================================

describe('resolveAction', () => {
  it('maps POST /api/agents/:id/start to agent.start', () => {
    expect(resolveAction('POST', '/api/agents/abc123/start')).toBe('agent.start');
  });

  it('maps POST /api/agents/:id/stop to agent.stop', () => {
    expect(resolveAction('POST', '/api/agents/abc123/stop')).toBe('agent.stop');
  });

  it('maps POST /api/agents/:id/emergency-stop to agent.emergency_stop', () => {
    expect(resolveAction('POST', '/api/agents/abc123/emergency-stop')).toBe('agent.emergency_stop');
  });

  it('maps POST /api/agents/:id/loop to loop.start', () => {
    expect(resolveAction('POST', '/api/agents/abc123/loop')).toBe('loop.start');
  });

  it('maps DELETE /api/agents/:id/loop to loop.stop', () => {
    expect(resolveAction('DELETE', '/api/agents/abc123/loop')).toBe('loop.stop');
  });

  it('maps POST /api/scheduler/jobs/* to schedule.create', () => {
    expect(resolveAction('POST', '/api/scheduler/jobs/heartbeat')).toBe('schedule.create');
    expect(resolveAction('POST', '/api/scheduler/jobs/cron')).toBe('schedule.create');
  });

  it('maps DELETE /api/scheduler/jobs to schedule.delete', () => {
    expect(resolveAction('DELETE', '/api/scheduler/jobs')).toBe('schedule.delete');
    expect(resolveAction('DELETE', '/api/scheduler/jobs/some-key')).toBe('schedule.delete');
  });

  it('maps DELETE /api/webhooks/:id to webhook.delete', () => {
    expect(resolveAction('DELETE', '/api/webhooks/sub-123')).toBe('webhook.delete');
  });

  it('maps POST /api/agents/emergency-stop-all to bulk.stop_all', () => {
    expect(resolveAction('POST', '/api/agents/emergency-stop-all')).toBe('bulk.stop_all');
  });

  it('returns null for non-matching routes', () => {
    expect(resolveAction('GET', '/api/agents')).toBeNull();
    expect(resolveAction('GET', '/health')).toBeNull();
    expect(resolveAction('POST', '/api/agents/abc123/heartbeat')).toBeNull();
  });

  it('strips query strings before matching', () => {
    expect(resolveAction('POST', '/api/agents/abc/start?confirm=true')).toBe('agent.start');
  });

  it('is case-insensitive for method', () => {
    expect(resolveAction('post', '/api/agents/abc/start')).toBe('agent.start');
    expect(resolveAction('Post', '/api/agents/abc/start')).toBe('agent.start');
    expect(resolveAction('delete', '/api/agents/abc/loop')).toBe('loop.stop');
  });
});

// =========================================================================
// extractAgentId
// =========================================================================

describe('extractAgentId', () => {
  it('extracts agent ID from /api/agents/:id/start', () => {
    expect(extractAgentId('/api/agents/my-agent/start')).toBe('my-agent');
  });

  it('extracts agent ID from /api/agents/:id/loop', () => {
    expect(extractAgentId('/api/agents/abc-123/loop')).toBe('abc-123');
  });

  it('returns undefined for /api/agents without sub-path', () => {
    expect(extractAgentId('/api/agents')).toBeUndefined();
  });

  it('returns undefined for unrelated paths', () => {
    expect(extractAgentId('/api/webhooks/123/test')).toBeUndefined();
  });

  it('strips query string before extracting', () => {
    expect(extractAgentId('/api/agents/agent-1/start?foo=bar')).toBe('agent-1');
  });
});

// =========================================================================
// Default configuration
// =========================================================================

describe('default configuration', () => {
  it('creates a gate with defaults when no config is provided', () => {
    const gate = createApprovalGate();
    // defaults: enabled=true, requireApprovalFor=[], costThresholdUsd=10
    // With no actions configured, nothing should require approval
    expect(gate.requiresApproval('agent.start')).toBe(false);
  });

  it('default cost threshold is 10', () => {
    const gate = createApprovalGate();
    expect(gate.requiresApproval('agent.start', { estimatedCostUsd: 11 })).toBe(true);
    expect(gate.requiresApproval('agent.start', { estimatedCostUsd: 9 })).toBe(false);
  });

  it('default auto-approve list is empty', () => {
    const gate = createApprovalGate({ requireApprovalFor: ['agent.start'] });
    // No agents auto-approved
    expect(gate.requiresApproval('agent.start', { agentId: 'any-agent' })).toBe(true);
  });
});

// =========================================================================
// createApprovalGateHook — Fastify integration
// =========================================================================

describe('createApprovalGateHook', () => {
  let gate: ApprovalGate;

  function buildApp(gateInstance: ApprovalGate): FastifyInstance {
    const app = Fastify({ logger: false });

    app.addHook('preHandler', createApprovalGateHook(gateInstance));

    // Register routes that map to approval actions
    app.post('/api/agents/:id/start', async () => ({ ok: true, started: true }));
    app.post('/api/agents/:id/stop', async () => ({ ok: true, stopped: true }));
    app.post('/api/agents/:id/emergency-stop', async () => ({ ok: true }));
    app.post('/api/agents/:id/loop', async () => ({ ok: true }));
    app.delete('/api/agents/:id/loop', async () => ({ ok: true }));
    app.post('/api/agents/emergency-stop-all', async () => ({ ok: true }));
    app.get('/api/agents', async () => ({ agents: [] }));
    app.get('/health', async () => ({ status: 'ok' }));

    return app;
  }

  beforeEach(() => {
    gate = makeGate({
      requireApprovalFor: ALL_ACTIONS,
    });
  });

  it('returns 202 for a gated route', async () => {
    const app = buildApp(gate);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/start',
      payload: {},
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.approvalRequired).toBe(true);
    expect(body.approval.status).toBe('pending');
    expect(body.approval.action).toBe('agent.start');

    await app.close();
  });

  it('passes through for non-gated routes', async () => {
    const app = buildApp(gate);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/agents' });
    expect(res.statusCode).toBe(200);
    expect(res.json().agents).toEqual([]);

    await app.close();
  });

  it('passes through for health check', async () => {
    const app = buildApp(gate);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);

    await app.close();
  });

  it('passes through when gate is disabled', async () => {
    const disabledGate = makeGate({
      enabled: false,
      requireApprovalFor: ALL_ACTIONS,
    });
    const app = buildApp(disabledGate);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/start',
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().started).toBe(true);

    await app.close();
  });

  it('creates a retrievable approval request on interception', async () => {
    const app = buildApp(gate);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/start',
      payload: {},
    });

    const body = res.json();
    const requestId = body.approval.id;

    const stored = gate.getRequest(requestId);
    expect(stored).not.toBeNull();
    expect(stored?.action).toBe('agent.start');
    expect(stored?.status).toBe('pending');

    await app.close();
  });

  it('intercepts emergency-stop route', async () => {
    const app = buildApp(gate);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-x/emergency-stop',
      payload: {},
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().approval.action).toBe('agent.emergency_stop');

    await app.close();
  });

  it('intercepts emergency-stop-all route', async () => {
    const app = buildApp(gate);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/emergency-stop-all',
      payload: {},
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().approval.action).toBe('bulk.stop_all');

    await app.close();
  });

  it('intercepts loop stop (DELETE) route', async () => {
    const app = buildApp(gate);
    await app.ready();

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/agents/agent-1/loop',
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().approval.action).toBe('loop.stop');

    await app.close();
  });

  it('includes the approval request ID in the response message', async () => {
    const app = buildApp(gate);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/start',
      payload: {},
    });

    const body = res.json();
    expect(body.message).toContain(body.approval.id);
    expect(body.message).toContain('/api/approval/');

    await app.close();
  });

  it('auto-approves for whitelisted agent IDs via context', async () => {
    const autoGate = makeGate({
      requireApprovalFor: ALL_ACTIONS,
      autoApproveAgentIds: ['trusted-agent'],
    });
    const app = buildApp(autoGate);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/trusted-agent/start',
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().started).toBe(true);

    await app.close();
  });

  it('blocks non-whitelisted agents on the same gate', async () => {
    const autoGate = makeGate({
      requireApprovalFor: ALL_ACTIONS,
      autoApproveAgentIds: ['trusted-agent'],
    });
    const app = buildApp(autoGate);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/untrusted-agent/start',
      payload: {},
    });

    expect(res.statusCode).toBe(202);

    await app.close();
  });

  it('triggers on cost threshold via request body', async () => {
    const costGate = makeGate({
      requireApprovalFor: [],
      costThresholdUsd: 5,
    });
    const app = buildApp(costGate);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/start',
      payload: { estimatedCostUsd: 50 },
    });

    expect(res.statusCode).toBe(202);

    await app.close();
  });

  it('does not trigger on cost below threshold', async () => {
    const costGate = makeGate({
      requireApprovalFor: [],
      costThresholdUsd: 100,
    });
    const app = buildApp(costGate);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/start',
      payload: { estimatedCostUsd: 5 },
    });

    expect(res.statusCode).toBe(200);

    await app.close();
  });
});

// =========================================================================
// Edge cases
// =========================================================================

describe('edge cases', () => {
  it('creating many requests does not corrupt state', () => {
    const gate = makeGate();

    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      const r = gate.createRequest('agent.start', `user-${String(i)}`);
      ids.push(r.id);
    }

    expect(gate.getStats().total).toBe(100);
    expect(gate.getStats().pending).toBe(100);

    // Each ID is unique
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(100);
  });

  it('approving and denying the same request returns null on second call', () => {
    const gate = makeGate();
    const r = gate.createRequest('agent.start', 'user');

    const first = gate.approveRequest(r.id, 'admin');
    expect(first).not.toBeNull();

    const second = gate.denyRequest(r.id, 'admin');
    expect(second).toBeNull();
  });

  it('denying and approving the same request returns null on second call', () => {
    const gate = makeGate();
    const r = gate.createRequest('agent.start', 'user');

    const first = gate.denyRequest(r.id, 'admin');
    expect(first).not.toBeNull();

    const second = gate.approveRequest(r.id, 'admin');
    expect(second).toBeNull();
  });

  it('expiring then approving returns null', () => {
    const gate = makeGate({ approvalTimeoutMs: 0 });
    const r = gate.createRequest('agent.start', 'user');

    gate.expireStaleRequests();
    const result = gate.approveRequest(r.id, 'admin');
    expect(result).toBeNull();
  });

  it('expiring then denying returns null', () => {
    const gate = makeGate({ approvalTimeoutMs: 0 });
    const r = gate.createRequest('agent.start', 'user');

    gate.expireStaleRequests();
    const result = gate.denyRequest(r.id, 'admin');
    expect(result).toBeNull();
  });

  it('getRequest returns different object instances each call', () => {
    const gate = makeGate();
    const r = gate.createRequest('agent.start', 'user');

    const a = gate.getRequest(r.id);
    const b = gate.getRequest(r.id);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('createRequest with all actions works', () => {
    const gate = makeGate();

    for (const action of ALL_ACTIONS) {
      const r = gate.createRequest(action, 'user');
      expect(r.action).toBe(action);
    }

    expect(gate.getStats().total).toBe(ALL_ACTIONS.length);
  });
});
