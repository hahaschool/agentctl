import { WorkerError } from '@agentctl/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolRateLimiter } from './tool-rate-limiter.js';

describe('ToolRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-02T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Constructor ─────────────────────────────────────────────────

  describe('constructor', () => {
    it('uses default limits when no config is provided', () => {
      const limiter = new ToolRateLimiter();
      const now = new Date();

      // Should allow at least one call
      const result = limiter.check('agent-1', 'Bash', now);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
    });

    it('accepts custom limits', () => {
      const limiter = new ToolRateLimiter({
        maxCallsPerMinute: 5,
        maxCallsPerHour: 100,
      });

      const now = new Date();

      for (let i = 0; i < 5; i++) {
        const result = limiter.check('agent-1', 'Bash', now);
        expect(result.allowed).toBe(true);
      }

      const result = limiter.check('agent-1', 'Bash', now);

      expect(result.allowed).toBe(false);
      expect(result.exceededLimit).toBe('per_minute');
    });

    it('throws WorkerError for non-positive maxCallsPerMinute', () => {
      expect(() => new ToolRateLimiter({ maxCallsPerMinute: 0 })).toThrow(WorkerError);
      expect(() => new ToolRateLimiter({ maxCallsPerMinute: -1 })).toThrow(WorkerError);
    });

    it('throws WorkerError for non-positive maxCallsPerHour', () => {
      expect(() => new ToolRateLimiter({ maxCallsPerHour: 0 })).toThrow(WorkerError);
      expect(() => new ToolRateLimiter({ maxCallsPerHour: -5 })).toThrow(WorkerError);
    });

    it('throws WorkerError for non-positive windowSizeMs', () => {
      expect(() => new ToolRateLimiter({ windowSizeMs: 0 })).toThrow(WorkerError);
      expect(() => new ToolRateLimiter({ windowSizeMs: -100 })).toThrow(WorkerError);
    });
  });

  // ── check() ─────────────────────────────────────────────────────

  describe('check()', () => {
    it('allows calls within the per-minute limit', () => {
      const limiter = new ToolRateLimiter({ maxCallsPerMinute: 10, maxCallsPerHour: 100 });
      const now = new Date();

      for (let i = 0; i < 10; i++) {
        const result = limiter.check('agent-1', 'Bash', now);
        expect(result.allowed).toBe(true);
      }
    });

    it('denies calls exceeding the per-minute limit', () => {
      const limiter = new ToolRateLimiter({ maxCallsPerMinute: 3, maxCallsPerHour: 100 });
      const now = new Date();

      for (let i = 0; i < 3; i++) {
        limiter.check('agent-1', 'Bash', now);
      }

      const result = limiter.check('agent-1', 'Bash', now);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.exceededLimit).toBe('per_minute');
    });

    it('denies calls exceeding the per-hour limit', () => {
      const limiter = new ToolRateLimiter({ maxCallsPerMinute: 100, maxCallsPerHour: 5 });
      const baseTime = new Date('2026-03-02T12:00:00.000Z');

      // Spread 5 calls across different minutes to avoid per-minute limit
      for (let i = 0; i < 5; i++) {
        const callTime = new Date(baseTime.getTime() + i * 61_000);
        vi.setSystemTime(callTime);
        limiter.check('agent-1', 'Bash', callTime);
      }

      // The 6th call should be denied
      const callTime = new Date(baseTime.getTime() + 5 * 61_000);
      vi.setSystemTime(callTime);
      const result = limiter.check('agent-1', 'Bash', callTime);

      expect(result.allowed).toBe(false);
      expect(result.exceededLimit).toBe('per_hour');
    });

    it('returns correct remaining count', () => {
      const limiter = new ToolRateLimiter({ maxCallsPerMinute: 5, maxCallsPerHour: 100 });
      const now = new Date();

      const result1 = limiter.check('agent-1', 'Bash', now);

      expect(result1.remaining).toBe(4);

      const result2 = limiter.check('agent-1', 'Read', now);

      expect(result2.remaining).toBe(3);
    });

    it('provides a resetAt date in the future', () => {
      const limiter = new ToolRateLimiter({ maxCallsPerMinute: 2, maxCallsPerHour: 100 });
      const now = new Date();

      limiter.check('agent-1', 'Bash', now);
      limiter.check('agent-1', 'Bash', now);
      const result = limiter.check('agent-1', 'Bash', now);

      expect(result.allowed).toBe(false);
      expect(result.resetAt.getTime()).toBeGreaterThan(now.getTime());
    });

    it('tracks different agents independently', () => {
      const limiter = new ToolRateLimiter({ maxCallsPerMinute: 2, maxCallsPerHour: 100 });
      const now = new Date();

      limiter.check('agent-1', 'Bash', now);
      limiter.check('agent-1', 'Bash', now);

      // agent-1 is now at limit
      const result1 = limiter.check('agent-1', 'Bash', now);

      expect(result1.allowed).toBe(false);

      // agent-2 should still be fine
      const result2 = limiter.check('agent-2', 'Bash', now);

      expect(result2.allowed).toBe(true);
    });

    it('counts all tools toward the agent limit', () => {
      const limiter = new ToolRateLimiter({ maxCallsPerMinute: 3, maxCallsPerHour: 100 });
      const now = new Date();

      limiter.check('agent-1', 'Bash', now);
      limiter.check('agent-1', 'Read', now);
      limiter.check('agent-1', 'Write', now);

      // All 3 calls consumed, next should be denied regardless of tool
      const result = limiter.check('agent-1', 'Glob', now);

      expect(result.allowed).toBe(false);
      expect(result.exceededLimit).toBe('per_minute');
    });

    it('allows calls after the sliding window expires', () => {
      const limiter = new ToolRateLimiter({ maxCallsPerMinute: 2, maxCallsPerHour: 100 });
      const startTime = new Date('2026-03-02T12:00:00.000Z');

      limiter.check('agent-1', 'Bash', startTime);
      limiter.check('agent-1', 'Bash', startTime);

      // At limit now
      const blocked = limiter.check('agent-1', 'Bash', startTime);

      expect(blocked.allowed).toBe(false);

      // Advance time past the minute window
      const laterTime = new Date(startTime.getTime() + 61_000);
      vi.setSystemTime(laterTime);
      const allowed = limiter.check('agent-1', 'Bash', laterTime);

      expect(allowed.allowed).toBe(true);
    });

    it('does not record timestamps for denied calls', () => {
      const limiter = new ToolRateLimiter({ maxCallsPerMinute: 2, maxCallsPerHour: 100 });
      const now = new Date();

      limiter.check('agent-1', 'Bash', now);
      limiter.check('agent-1', 'Bash', now);

      // This should be denied and NOT counted
      limiter.check('agent-1', 'Bash', now);
      limiter.check('agent-1', 'Bash', now);

      const stats = limiter.getStats('agent-1', now);

      expect(stats.totalCalls).toBe(2);
    });
  });

  // ── reset() ─────────────────────────────────────────────────────

  describe('reset()', () => {
    it('clears all counters for the specified agent', () => {
      const limiter = new ToolRateLimiter({ maxCallsPerMinute: 2, maxCallsPerHour: 100 });
      const now = new Date();

      limiter.check('agent-1', 'Bash', now);
      limiter.check('agent-1', 'Bash', now);

      // At limit
      expect(limiter.check('agent-1', 'Bash', now).allowed).toBe(false);

      limiter.reset('agent-1');

      // Should be allowed again
      expect(limiter.check('agent-1', 'Bash', now).allowed).toBe(true);
    });

    it('does not affect other agents', () => {
      const limiter = new ToolRateLimiter({ maxCallsPerMinute: 2, maxCallsPerHour: 100 });
      const now = new Date();

      limiter.check('agent-1', 'Bash', now);
      limiter.check('agent-2', 'Bash', now);
      limiter.check('agent-2', 'Bash', now);

      limiter.reset('agent-1');

      // agent-2 should still be at its limits
      expect(limiter.check('agent-2', 'Bash', now).allowed).toBe(false);
    });

    it('is safe to call for non-existent agents', () => {
      const limiter = new ToolRateLimiter();

      expect(() => limiter.reset('nonexistent')).not.toThrow();
    });
  });

  // ── getStats() ─────────────────────────────────────────────────

  describe('getStats()', () => {
    it('returns empty stats for unknown agents', () => {
      const limiter = new ToolRateLimiter();
      const stats = limiter.getStats('unknown');

      expect(stats.totalCalls).toBe(0);
      expect(stats.toolCounts).toEqual({});
    });

    it('returns correct per-tool counts', () => {
      const limiter = new ToolRateLimiter();
      const now = new Date();

      limiter.check('agent-1', 'Bash', now);
      limiter.check('agent-1', 'Bash', now);
      limiter.check('agent-1', 'Read', now);
      limiter.check('agent-1', 'Write', now);

      const stats = limiter.getStats('agent-1', now);

      expect(stats.totalCalls).toBe(4);
      expect(stats.toolCounts).toEqual({
        Bash: 2,
        Read: 1,
        Write: 1,
      });
    });

    it('excludes expired timestamps from stats', () => {
      const limiter = new ToolRateLimiter();
      const startTime = new Date('2026-03-02T12:00:00.000Z');

      limiter.check('agent-1', 'Bash', startTime);

      // Advance past the hour window
      const laterTime = new Date(startTime.getTime() + 3_601_000);
      vi.setSystemTime(laterTime);

      const stats = limiter.getStats('agent-1', laterTime);

      expect(stats.totalCalls).toBe(0);
      expect(stats.toolCounts).toEqual({});
    });
  });

  // ── Default limits ──────────────────────────────────────────────

  describe('default limits', () => {
    it('uses 120 calls/minute by default', () => {
      const limiter = new ToolRateLimiter();
      const now = new Date();

      for (let i = 0; i < 120; i++) {
        const result = limiter.check('agent-1', 'Bash', now);
        expect(result.allowed).toBe(true);
      }

      const result = limiter.check('agent-1', 'Bash', now);

      expect(result.allowed).toBe(false);
      expect(result.exceededLimit).toBe('per_minute');
    });

    it('enforces per-hour limit', () => {
      // Use a small hourly limit to avoid 3600-iteration loop timeout
      const limiter = new ToolRateLimiter({ maxCallsPerMinute: 10000, maxCallsPerHour: 50 });
      const baseTime = new Date('2026-03-02T12:00:00.000Z');

      // Make 50 calls spread across the hour window (each 30s apart)
      for (let i = 0; i < 50; i++) {
        const callTime = new Date(baseTime.getTime() + i * 30_000);
        vi.setSystemTime(callTime);
        const result = limiter.check('agent-1', 'Bash', callTime);
        expect(result.allowed).toBe(true);
      }

      // 51st call should be denied
      const callTime = new Date(baseTime.getTime() + 50 * 30_000);
      vi.setSystemTime(callTime);
      const result = limiter.check('agent-1', 'Bash', callTime);

      expect(result.allowed).toBe(false);
      expect(result.exceededLimit).toBe('per_hour');
    });
  });
});
