import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MachineCircuitBreaker } from './circuit-breaker.js';

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

const logger = {
  child: () => logger,
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
  level: 'silent',
} as unknown as Logger;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MachineCircuitBreaker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('defaults to closed for unknown machines', () => {
      const cb = new MachineCircuitBreaker({ logger });

      expect(cb.getState('machine-1')).toBe('closed');
      expect(cb.isOpen('machine-1')).toBe(false);
    });
  });

  describe('closed -> open after failure threshold', () => {
    it('stays closed below the threshold', () => {
      const cb = new MachineCircuitBreaker({ failureThreshold: 3, logger });

      cb.recordFailure('machine-1');
      cb.recordFailure('machine-1');

      expect(cb.getState('machine-1')).toBe('closed');
      expect(cb.isOpen('machine-1')).toBe(false);
    });

    it('opens after reaching the failure threshold', () => {
      const cb = new MachineCircuitBreaker({ failureThreshold: 3, logger });

      cb.recordFailure('machine-1');
      cb.recordFailure('machine-1');
      cb.recordFailure('machine-1');

      expect(cb.getState('machine-1')).toBe('open');
      expect(cb.isOpen('machine-1')).toBe(true);
    });

    it('opens after exceeding the failure threshold', () => {
      const cb = new MachineCircuitBreaker({ failureThreshold: 2, logger });

      cb.recordFailure('machine-1');
      cb.recordFailure('machine-1');
      cb.recordFailure('machine-1');

      expect(cb.getState('machine-1')).toBe('open');
      expect(cb.isOpen('machine-1')).toBe(true);
    });

    it('uses default threshold of 3 when not specified', () => {
      const cb = new MachineCircuitBreaker({ logger });

      cb.recordFailure('machine-1');
      cb.recordFailure('machine-1');
      expect(cb.getState('machine-1')).toBe('closed');

      cb.recordFailure('machine-1');
      expect(cb.getState('machine-1')).toBe('open');
    });
  });

  describe('success resets consecutive failure counter', () => {
    it('resets failures on success while closed', () => {
      const cb = new MachineCircuitBreaker({ failureThreshold: 3, logger });

      cb.recordFailure('machine-1');
      cb.recordFailure('machine-1');
      cb.recordSuccess('machine-1');

      // After resetting, it should take another 3 failures to open
      cb.recordFailure('machine-1');
      cb.recordFailure('machine-1');
      expect(cb.getState('machine-1')).toBe('closed');

      cb.recordFailure('machine-1');
      expect(cb.getState('machine-1')).toBe('open');
    });
  });

  describe('open -> half-open after reset timeout', () => {
    it('transitions to half-open after resetTimeoutMs', () => {
      const cb = new MachineCircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 1000,
        logger,
      });

      cb.recordFailure('machine-1');
      cb.recordFailure('machine-1');
      expect(cb.getState('machine-1')).toBe('open');

      // Advance time past the reset timeout
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1500);

      expect(cb.getState('machine-1')).toBe('half-open');
      expect(cb.isOpen('machine-1')).toBe(false);
    });

    it('remains open before resetTimeoutMs elapses', () => {
      const realNow = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(realNow);

      const cb = new MachineCircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 5000,
        logger,
      });

      cb.recordFailure('machine-1');
      cb.recordFailure('machine-1');

      // Advance time, but not enough
      vi.spyOn(Date, 'now').mockReturnValue(realNow + 3000);

      expect(cb.getState('machine-1')).toBe('open');
      expect(cb.isOpen('machine-1')).toBe(true);
    });
  });

  describe('half-open: success -> closed', () => {
    it('closes the circuit on a successful probe', () => {
      const cb = new MachineCircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 1000,
        logger,
      });

      cb.recordFailure('machine-1');
      cb.recordFailure('machine-1');
      expect(cb.getState('machine-1')).toBe('open');

      // Advance past timeout to enter half-open
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1500);
      expect(cb.isOpen('machine-1')).toBe(false); // transitions to half-open
      expect(cb.getState('machine-1')).toBe('half-open');

      // Successful probe
      cb.recordSuccess('machine-1');
      expect(cb.getState('machine-1')).toBe('closed');
      expect(cb.isOpen('machine-1')).toBe(false);
    });
  });

  describe('half-open: failure -> open', () => {
    it('re-opens the circuit on a failed probe', () => {
      const realNow = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(realNow);

      const cb = new MachineCircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 1000,
        logger,
      });

      cb.recordFailure('machine-1');
      cb.recordFailure('machine-1');
      expect(cb.getState('machine-1')).toBe('open');

      // Advance past timeout to enter half-open
      vi.spyOn(Date, 'now').mockReturnValue(realNow + 1500);
      expect(cb.isOpen('machine-1')).toBe(false);
      expect(cb.getState('machine-1')).toBe('half-open');

      // Failed probe — should re-open with a new timestamp
      vi.spyOn(Date, 'now').mockReturnValue(realNow + 1600);
      cb.recordFailure('machine-1');
      expect(cb.getState('machine-1')).toBe('open');
      expect(cb.isOpen('machine-1')).toBe(true);

      // Should need to wait another full resetTimeoutMs from the new openedAt
      vi.spyOn(Date, 'now').mockReturnValue(realNow + 2000);
      expect(cb.isOpen('machine-1')).toBe(true);

      vi.spyOn(Date, 'now').mockReturnValue(realNow + 2700);
      expect(cb.isOpen('machine-1')).toBe(false); // half-open again
    });
  });

  describe('independent per machine', () => {
    it('tracks separate circuits for different machines', () => {
      const cb = new MachineCircuitBreaker({
        failureThreshold: 2,
        logger,
      });

      cb.recordFailure('machine-a');
      cb.recordFailure('machine-a');
      expect(cb.getState('machine-a')).toBe('open');

      // machine-b should be unaffected
      expect(cb.getState('machine-b')).toBe('closed');
      expect(cb.isOpen('machine-b')).toBe(false);

      cb.recordFailure('machine-b');
      expect(cb.getState('machine-b')).toBe('closed');
    });

    it('success on one machine does not affect another', () => {
      const cb = new MachineCircuitBreaker({
        failureThreshold: 2,
        logger,
      });

      cb.recordFailure('machine-a');
      cb.recordFailure('machine-a');
      expect(cb.getState('machine-a')).toBe('open');

      cb.recordSuccess('machine-b');
      expect(cb.getState('machine-a')).toBe('open');
    });
  });

  describe('reset()', () => {
    it('clears all state for a machine', () => {
      const cb = new MachineCircuitBreaker({
        failureThreshold: 2,
        logger,
      });

      cb.recordFailure('machine-1');
      cb.recordFailure('machine-1');
      expect(cb.getState('machine-1')).toBe('open');

      cb.reset('machine-1');
      expect(cb.getState('machine-1')).toBe('closed');
      expect(cb.isOpen('machine-1')).toBe(false);
    });

    it('after reset, failures start counting from zero', () => {
      const cb = new MachineCircuitBreaker({
        failureThreshold: 2,
        logger,
      });

      cb.recordFailure('machine-1');
      cb.recordFailure('machine-1');
      expect(cb.getState('machine-1')).toBe('open');

      cb.reset('machine-1');

      cb.recordFailure('machine-1');
      expect(cb.getState('machine-1')).toBe('closed');

      cb.recordFailure('machine-1');
      expect(cb.getState('machine-1')).toBe('open');
    });

    it('does not throw when resetting an unknown machine', () => {
      const cb = new MachineCircuitBreaker({ logger });

      expect(() => cb.reset('unknown')).not.toThrow();
    });
  });

  describe('logging', () => {
    it('logs when circuit opens', () => {
      const cb = new MachineCircuitBreaker({
        failureThreshold: 2,
        logger,
      });

      cb.recordFailure('machine-1');
      cb.recordFailure('machine-1');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ machineId: 'machine-1' }),
        expect.stringContaining('opened'),
      );
    });

    it('logs when circuit transitions to half-open', () => {
      const cb = new MachineCircuitBreaker({
        failureThreshold: 1,
        resetTimeoutMs: 500,
        logger,
      });

      cb.recordFailure('machine-1');
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600);

      cb.isOpen('machine-1');

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ machineId: 'machine-1' }),
        expect.stringContaining('half-open'),
      );
    });

    it('logs when circuit closes after successful probe', () => {
      const cb = new MachineCircuitBreaker({
        failureThreshold: 1,
        resetTimeoutMs: 500,
        logger,
      });

      cb.recordFailure('machine-1');
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600);
      cb.isOpen('machine-1'); // trigger half-open
      vi.mocked(logger.info).mockClear();

      cb.recordSuccess('machine-1');

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          machineId: 'machine-1',
          previousState: 'half-open',
          newState: 'closed',
        }),
        expect.stringContaining('closed'),
      );
    });

    it('logs when reset is called', () => {
      const cb = new MachineCircuitBreaker({ logger });

      cb.reset('machine-1');

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ machineId: 'machine-1' }),
        expect.stringContaining('reset'),
      );
    });
  });

  describe('works without a logger', () => {
    it('does not throw when logger is not provided', () => {
      const cb = new MachineCircuitBreaker({ failureThreshold: 1 });

      expect(() => cb.recordFailure('machine-1')).not.toThrow();
      expect(cb.getState('machine-1')).toBe('open');

      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000);
      expect(() => cb.isOpen('machine-1')).not.toThrow();
      expect(() => cb.recordSuccess('machine-1')).not.toThrow();
      expect(() => cb.reset('machine-1')).not.toThrow();
    });
  });
});
