import type { ContextBudgetPolicy, ContextRef, ContextRefMode } from '@agentctl/shared';
import { DEFAULT_CONTEXT_BUDGET_POLICY } from '@agentctl/shared';
import pino from 'pino';
import { describe, expect, it } from 'vitest';

import {
  ContextBudgetManager,
  estimateContextTokens,
  estimateRefTokens,
} from './context-budget-manager.js';

const logger = pino({ level: 'silent' });

function makeRef(overrides: Partial<ContextRef> = {}): ContextRef {
  return {
    id: `ref-${Math.random().toString(36).slice(2, 8)}`,
    sourceSpaceId: 'space-a',
    sourceThreadId: null,
    sourceEventId: null,
    targetSpaceId: 'space-b',
    targetThreadId: 'thread-1',
    mode: 'reference' as ContextRefMode,
    snapshotPayload: null,
    metadata: {},
    createdBy: 'test-user',
    createdAt: '2026-03-13T00:00:00.000Z',
    ...overrides,
  };
}

// ── estimateContextTokens ────────────────────────────────────

describe('estimateContextTokens', () => {
  it('estimates 1 token per 4 characters', () => {
    expect(estimateContextTokens('abcd')).toBe(1);
    expect(estimateContextTokens('abcde')).toBe(2);
    expect(estimateContextTokens('')).toBe(0);
  });

  it('rounds up partial tokens', () => {
    expect(estimateContextTokens('a')).toBe(1);
    expect(estimateContextTokens('ab')).toBe(1);
    expect(estimateContextTokens('abc')).toBe(1);
    expect(estimateContextTokens('abcdefgh')).toBe(2);
  });
});

// ── estimateRefTokens ────────────────────────────────────────

describe('estimateRefTokens', () => {
  it('returns 0 for a ref with no payload and empty metadata', () => {
    const ref = makeRef({ snapshotPayload: null, metadata: {} });
    expect(estimateRefTokens(ref)).toBe(0);
  });

  it('estimates tokens from snapshotPayload JSON', () => {
    const ref = makeRef({
      snapshotPayload: { data: 'X'.repeat(100) },
    });
    const tokens = estimateRefTokens(ref);
    expect(tokens).toBeGreaterThan(0);
  });

  it('estimates tokens from metadata JSON', () => {
    const ref = makeRef({
      metadata: { summary: 'Y'.repeat(80) },
    });
    const tokens = estimateRefTokens(ref);
    expect(tokens).toBeGreaterThan(0);
  });

  it('combines payload and metadata for estimate', () => {
    const refPayloadOnly = makeRef({
      snapshotPayload: { a: 1 },
      metadata: {},
    });
    const refBoth = makeRef({
      snapshotPayload: { a: 1 },
      metadata: { b: 2 },
    });
    expect(estimateRefTokens(refBoth)).toBeGreaterThanOrEqual(estimateRefTokens(refPayloadOnly));
  });
});

// ── ContextBudgetManager.allocate ────────────────────────────

describe('ContextBudgetManager', () => {
  describe('allocate', () => {
    it('allows full allocation when within both limits', () => {
      const mgr = new ContextBudgetManager({ logger });
      const result = mgr.allocate('space-a', 100);
      expect(result.allowed).toBe(100);
      expect(result.capped).toBe(false);
      expect(result.reason).toBeNull();
    });

    it('caps to per-space limit when space is the bottleneck', () => {
      const policy: ContextBudgetPolicy = {
        perSpaceLimit: 50,
        totalLimit: 10000,
        overflowStrategy: 'truncate',
      };
      const mgr = new ContextBudgetManager({ policy, logger });
      const result = mgr.allocate('space-a', 100);
      expect(result.allowed).toBe(50);
      expect(result.capped).toBe(true);
      expect(result.reason).toContain('per-space');
    });

    it('caps to total limit when total is the bottleneck', () => {
      const policy: ContextBudgetPolicy = {
        perSpaceLimit: 10000,
        totalLimit: 30,
        overflowStrategy: 'truncate',
      };
      const mgr = new ContextBudgetManager({ policy, logger });
      const result = mgr.allocate('space-a', 100);
      expect(result.allowed).toBe(30);
      expect(result.capped).toBe(true);
      expect(result.reason).toContain('total');
    });

    it('reflects prior consumption in remaining budget', () => {
      const policy: ContextBudgetPolicy = {
        perSpaceLimit: 100,
        totalLimit: 200,
        overflowStrategy: 'truncate',
      };
      const mgr = new ContextBudgetManager({ policy, logger });
      mgr.consume('space-a', 80);

      const result = mgr.allocate('space-a', 50);
      expect(result.allowed).toBe(20);
      expect(result.capped).toBe(true);
    });

    it('returns 0 when reject strategy and budget exceeded', () => {
      const policy: ContextBudgetPolicy = {
        perSpaceLimit: 10,
        totalLimit: 10000,
        overflowStrategy: 'reject',
      };
      const mgr = new ContextBudgetManager({ policy, logger });
      const result = mgr.allocate('space-a', 100);
      expect(result.allowed).toBe(0);
      expect(result.capped).toBe(true);
      expect(result.reason).toContain('limit exceeded');
    });

    it('throws on negative estimatedTokens', () => {
      const mgr = new ContextBudgetManager({ logger });
      expect(() => mgr.allocate('space-a', -1)).toThrow('non-negative');
    });

    it('allows zero-token allocation', () => {
      const mgr = new ContextBudgetManager({ logger });
      const result = mgr.allocate('space-a', 0);
      expect(result.allowed).toBe(0);
      expect(result.capped).toBe(false);
    });
  });

  // ── consume ──────────────────────────────────────────────────

  describe('consume', () => {
    it('records usage and returns updated space budget', () => {
      const policy: ContextBudgetPolicy = {
        perSpaceLimit: 200,
        totalLimit: 1000,
        overflowStrategy: 'truncate',
      };
      const mgr = new ContextBudgetManager({ policy, logger });

      const budget = mgr.consume('space-a', 75);
      expect(budget.usedTokens).toBe(75);
      expect(budget.maxTokens).toBe(200);
      expect(budget.remaining).toBe(125);
    });

    it('accumulates across multiple consume calls', () => {
      const policy: ContextBudgetPolicy = {
        perSpaceLimit: 200,
        totalLimit: 1000,
        overflowStrategy: 'truncate',
      };
      const mgr = new ContextBudgetManager({ policy, logger });

      mgr.consume('space-a', 50);
      const budget = mgr.consume('space-a', 30);
      expect(budget.usedTokens).toBe(80);
      expect(budget.remaining).toBe(120);
    });

    it('tracks different spaces independently', () => {
      const policy: ContextBudgetPolicy = {
        perSpaceLimit: 100,
        totalLimit: 1000,
        overflowStrategy: 'truncate',
      };
      const mgr = new ContextBudgetManager({ policy, logger });

      mgr.consume('space-a', 60);
      const budgetB = mgr.consume('space-b', 40);

      expect(budgetB.usedTokens).toBe(40);
      expect(budgetB.remaining).toBe(60);

      const summary = mgr.getSummary();
      expect(summary.total.usedTokens).toBe(100);
    });

    it('clamps remaining to zero when over-consumed', () => {
      const policy: ContextBudgetPolicy = {
        perSpaceLimit: 50,
        totalLimit: 100,
        overflowStrategy: 'truncate',
      };
      const mgr = new ContextBudgetManager({ policy, logger });
      const budget = mgr.consume('space-a', 80);
      expect(budget.remaining).toBe(0);
    });

    it('throws on negative actualTokens', () => {
      const mgr = new ContextBudgetManager({ logger });
      expect(() => mgr.consume('space-a', -5)).toThrow('non-negative');
    });
  });

  // ── getSummary ─────────────────────────────────────────────

  describe('getSummary', () => {
    it('returns empty summary when no consumption has occurred', () => {
      const mgr = new ContextBudgetManager({ logger });
      const summary = mgr.getSummary();
      expect(summary.perSpace).toEqual({});
      expect(summary.total.usedTokens).toBe(0);
      expect(summary.total.remaining).toBe(DEFAULT_CONTEXT_BUDGET_POLICY.totalLimit);
    });

    it('returns per-space and total breakdown', () => {
      const policy: ContextBudgetPolicy = {
        perSpaceLimit: 500,
        totalLimit: 2000,
        overflowStrategy: 'truncate',
      };
      const mgr = new ContextBudgetManager({ policy, logger });
      mgr.consume('space-a', 200);
      mgr.consume('space-b', 300);

      const summary = mgr.getSummary();
      expect(summary.perSpace['space-a']?.usedTokens).toBe(200);
      expect(summary.perSpace['space-a']?.remaining).toBe(300);
      expect(summary.perSpace['space-b']?.usedTokens).toBe(300);
      expect(summary.perSpace['space-b']?.remaining).toBe(200);
      expect(summary.total.usedTokens).toBe(500);
      expect(summary.total.remaining).toBe(1500);
    });
  });

  // ── applyBudget ────────────────────────────────────────────

  describe('applyBudget', () => {
    it('includes all refs when budget is sufficient', () => {
      const policy: ContextBudgetPolicy = {
        perSpaceLimit: 100000,
        totalLimit: 100000,
        overflowStrategy: 'truncate',
      };
      const mgr = new ContextBudgetManager({ policy, logger });

      const refs = [
        makeRef({ id: 'r1', snapshotPayload: { d: 'x' } }),
        makeRef({ id: 'r2', snapshotPayload: { d: 'y' } }),
      ];

      const result = mgr.applyBudget(refs);
      expect(result.refs).toHaveLength(2);
      expect(result.excluded).toHaveLength(0);
    });

    it('excludes refs that exceed the per-space limit', () => {
      const policy: ContextBudgetPolicy = {
        perSpaceLimit: 10,
        totalLimit: 100000,
        overflowStrategy: 'reject',
      };
      const mgr = new ContextBudgetManager({ policy, logger });

      const refs = [
        makeRef({
          id: 'r1',
          sourceSpaceId: 'space-a',
          snapshotPayload: { data: 'X'.repeat(200) },
        }),
      ];

      const result = mgr.applyBudget(refs);
      expect(result.refs).toHaveLength(0);
      expect(result.excluded).toHaveLength(1);
    });

    it('sorts by size with prioritize strategy', () => {
      const policy: ContextBudgetPolicy = {
        perSpaceLimit: 100000,
        totalLimit: 30,
        overflowStrategy: 'prioritize',
      };
      const mgr = new ContextBudgetManager({ policy, logger });

      const largeRef = makeRef({
        id: 'large',
        sourceSpaceId: 'space-a',
        snapshotPayload: { data: 'X'.repeat(200) },
      });
      const smallRef = makeRef({
        id: 'small',
        sourceSpaceId: 'space-a',
        snapshotPayload: { d: 'y' },
      });

      // Large ref is first in input, but prioritize should process small first
      const result = mgr.applyBudget([largeRef, smallRef]);
      expect(result.refs.some((r) => r.id === 'small')).toBe(true);
    });

    it('returns budget summary in the result', () => {
      const policy: ContextBudgetPolicy = {
        perSpaceLimit: 10000,
        totalLimit: 20000,
        overflowStrategy: 'truncate',
      };
      const mgr = new ContextBudgetManager({ policy, logger });

      const refs = [makeRef({ id: 'r1', snapshotPayload: { d: 'test data' } })];
      const result = mgr.applyBudget(refs);

      expect(result.summary.total.usedTokens).toBeGreaterThan(0);
      expect(result.summary.total.maxTokens).toBe(20000);
    });

    it('handles empty refs list', () => {
      const mgr = new ContextBudgetManager({ logger });
      const result = mgr.applyBudget([]);
      expect(result.refs).toHaveLength(0);
      expect(result.excluded).toHaveLength(0);
      expect(result.summary.total.usedTokens).toBe(0);
    });

    it('includes refs with truncate strategy even when partially over', () => {
      const policy: ContextBudgetPolicy = {
        perSpaceLimit: 5,
        totalLimit: 100000,
        overflowStrategy: 'truncate',
      };
      const mgr = new ContextBudgetManager({ policy, logger });

      const ref = makeRef({
        id: 'r1',
        sourceSpaceId: 'space-a',
        snapshotPayload: { data: 'X'.repeat(40) },
      });

      const result = mgr.applyBudget([ref]);
      // truncate strategy includes the ref but caps the consumed tokens
      expect(result.refs).toHaveLength(1);
    });

    it('excludes refs when truncate strategy has 0 remaining', () => {
      const policy: ContextBudgetPolicy = {
        perSpaceLimit: 10,
        totalLimit: 100000,
        overflowStrategy: 'truncate',
      };
      const mgr = new ContextBudgetManager({ policy, logger });

      // Exhaust the budget first
      mgr.consume('space-a', 10);

      const ref = makeRef({
        id: 'r1',
        sourceSpaceId: 'space-a',
        snapshotPayload: { data: 'some data' },
      });

      const result = mgr.applyBudget([ref]);
      expect(result.refs).toHaveLength(0);
      expect(result.excluded).toHaveLength(1);
    });

    it('tracks multiple spaces correctly in applyBudget', () => {
      const policy: ContextBudgetPolicy = {
        perSpaceLimit: 100000,
        totalLimit: 100000,
        overflowStrategy: 'truncate',
      };
      const mgr = new ContextBudgetManager({ policy, logger });

      const refs = [
        makeRef({ id: 'r1', sourceSpaceId: 'space-a', snapshotPayload: { d: 'a' } }),
        makeRef({ id: 'r2', sourceSpaceId: 'space-b', snapshotPayload: { d: 'b' } }),
        makeRef({ id: 'r3', sourceSpaceId: 'space-a', snapshotPayload: { d: 'c' } }),
      ];

      const result = mgr.applyBudget(refs);
      expect(result.refs).toHaveLength(3);
      expect(result.summary.perSpace['space-a']).toBeDefined();
      expect(result.summary.perSpace['space-b']).toBeDefined();
    });
  });

  // ── reset ──────────────────────────────────────────────────

  describe('reset', () => {
    it('clears all tracked usage', () => {
      const mgr = new ContextBudgetManager({ logger });
      mgr.consume('space-a', 500);
      mgr.consume('space-b', 300);

      mgr.reset();

      const summary = mgr.getSummary();
      expect(summary.perSpace).toEqual({});
      expect(summary.total.usedTokens).toBe(0);
    });

    it('allows fresh allocations after reset', () => {
      const policy: ContextBudgetPolicy = {
        perSpaceLimit: 100,
        totalLimit: 100,
        overflowStrategy: 'reject',
      };
      const mgr = new ContextBudgetManager({ policy, logger });
      mgr.consume('space-a', 100);

      // Budget is exhausted
      expect(mgr.allocate('space-a', 10).allowed).toBe(0);

      mgr.reset();

      // Now allocation should work
      expect(mgr.allocate('space-a', 10).allowed).toBe(10);
    });
  });

  // ── getPolicy ──────────────────────────────────────────────

  describe('getPolicy', () => {
    it('returns the configured policy', () => {
      const policy: ContextBudgetPolicy = {
        perSpaceLimit: 123,
        totalLimit: 456,
        overflowStrategy: 'reject',
      };
      const mgr = new ContextBudgetManager({ policy, logger });
      expect(mgr.getPolicy()).toEqual(policy);
    });

    it('returns default policy when none provided', () => {
      const mgr = new ContextBudgetManager({ logger });
      expect(mgr.getPolicy()).toEqual(DEFAULT_CONTEXT_BUDGET_POLICY);
    });
  });

  // ── DEFAULT_CONTEXT_BUDGET_POLICY ──────────────────────────

  describe('DEFAULT_CONTEXT_BUDGET_POLICY', () => {
    it('has perSpaceLimit of 4000', () => {
      expect(DEFAULT_CONTEXT_BUDGET_POLICY.perSpaceLimit).toBe(4000);
    });

    it('has totalLimit of 16000', () => {
      expect(DEFAULT_CONTEXT_BUDGET_POLICY.totalLimit).toBe(16000);
    });

    it('has truncate as default overflow strategy', () => {
      expect(DEFAULT_CONTEXT_BUDGET_POLICY.overflowStrategy).toBe('truncate');
    });
  });

  // ── Integration scenario ───────────────────────────────────

  describe('integration: multi-space budget enforcement', () => {
    it('enforces per-space and total limits across multiple spaces', () => {
      const policy: ContextBudgetPolicy = {
        perSpaceLimit: 50,
        totalLimit: 80,
        overflowStrategy: 'reject',
      };
      const mgr = new ContextBudgetManager({ policy, logger });

      // Space A: consume 45 of 50
      mgr.consume('space-a', 45);
      expect(mgr.allocate('space-a', 10).allowed).toBe(0); // only 5 remain per-space

      // Space B: has 50 per-space, but only 35 remain total (80 - 45)
      const allocB = mgr.allocate('space-b', 40);
      expect(allocB.allowed).toBe(0); // reject because 40 > 35 (total remaining)

      // Space B: can fit 30 though
      const allocB2 = mgr.allocate('space-b', 30);
      expect(allocB2.allowed).toBe(30);
      expect(allocB2.capped).toBe(false);
    });

    it('applies budget to a mixed set of refs from different spaces', () => {
      const policy: ContextBudgetPolicy = {
        perSpaceLimit: 100000,
        totalLimit: 100000,
        overflowStrategy: 'truncate',
      };
      const mgr = new ContextBudgetManager({ policy, logger });

      const refs = [
        makeRef({
          id: 'r1',
          sourceSpaceId: 'design',
          snapshotPayload: { content: 'Design document for auth flow' },
        }),
        makeRef({
          id: 'r2',
          sourceSpaceId: 'research',
          snapshotPayload: { content: 'Research findings on OAuth2 libraries' },
        }),
        makeRef({
          id: 'r3',
          sourceSpaceId: 'design',
          metadata: { note: 'API schema draft' },
        }),
      ];

      const result = mgr.applyBudget(refs);
      expect(result.refs).toHaveLength(3);
      expect(result.excluded).toHaveLength(0);
      expect(result.summary.perSpace.design?.usedTokens).toBeGreaterThan(0);
      expect(result.summary.perSpace.research?.usedTokens).toBeGreaterThan(0);
    });
  });
});
