import { describe, expect, it } from 'vitest';

import {
  BATCH_LIMITS,
  EMERGENCY_STOP_TIMEOUT_MS,
  LOOP_PROXY_TIMEOUT_MS,
  WORKER_REQUEST_TIMEOUT_MS,
  WS_HEARTBEAT_INTERVAL_MS,
  clampLimit,
  PAGINATION,
} from './constants.js';

describe('PAGINATION', () => {
  it('defines expected resource types', () => {
    expect(PAGINATION.agents).toBeDefined();
    expect(PAGINATION.agentRuns).toBeDefined();
    expect(PAGINATION.sessions).toBeDefined();
    expect(PAGINATION.audit).toBeDefined();
    expect(PAGINATION.replay).toBeDefined();
    expect(PAGINATION.securityFindings).toBeDefined();
    expect(PAGINATION.webhooks).toBeDefined();
  });

  it('each config has defaultLimit <= maxLimit', () => {
    for (const [, config] of Object.entries(PAGINATION)) {
      expect(config.defaultLimit).toBeLessThanOrEqual(config.maxLimit);
      expect(config.defaultLimit).toBeGreaterThan(0);
      expect(config.maxLimit).toBeGreaterThan(0);
    }
  });
});

describe('BATCH_LIMITS', () => {
  it('defines audit and securityFindings', () => {
    expect(BATCH_LIMITS.audit).toBe(1000);
    expect(BATCH_LIMITS.securityFindings).toBe(500);
  });
});

describe('clampLimit', () => {
  const config = { defaultLimit: 50, maxLimit: 200 };

  it('returns defaultLimit for non-finite input', () => {
    expect(clampLimit(NaN, config)).toBe(50);
    expect(clampLimit(Infinity, config)).toBe(50);
    expect(clampLimit(-Infinity, config)).toBe(50);
  });

  it('returns defaultLimit for values < 1', () => {
    expect(clampLimit(0, config)).toBe(50);
    expect(clampLimit(-5, config)).toBe(50);
  });

  it('returns parsed value when within range', () => {
    expect(clampLimit(10, config)).toBe(10);
    expect(clampLimit(100, config)).toBe(100);
    expect(clampLimit(200, config)).toBe(200);
  });

  it('clamps to maxLimit when exceeding', () => {
    expect(clampLimit(300, config)).toBe(200);
    expect(clampLimit(999, config)).toBe(200);
  });

  it('floors floating point values', () => {
    expect(clampLimit(10.7, config)).toBe(10);
    expect(clampLimit(50.99, config)).toBe(50);
  });
});

describe('timeout constants', () => {
  it('WORKER_REQUEST_TIMEOUT_MS is 10 seconds', () => {
    expect(WORKER_REQUEST_TIMEOUT_MS).toBe(10_000);
  });

  it('LOOP_PROXY_TIMEOUT_MS is 30 seconds', () => {
    expect(LOOP_PROXY_TIMEOUT_MS).toBe(30_000);
  });

  it('EMERGENCY_STOP_TIMEOUT_MS is 15 seconds', () => {
    expect(EMERGENCY_STOP_TIMEOUT_MS).toBe(15_000);
  });

  it('WS_HEARTBEAT_INTERVAL_MS is 30 seconds', () => {
    expect(WS_HEARTBEAT_INTERVAL_MS).toBe(30_000);
  });

  it('all timeouts are positive finite numbers', () => {
    for (const ms of [
      WORKER_REQUEST_TIMEOUT_MS,
      LOOP_PROXY_TIMEOUT_MS,
      EMERGENCY_STOP_TIMEOUT_MS,
      WS_HEARTBEAT_INTERVAL_MS,
    ]) {
      expect(ms).toBeGreaterThan(0);
      expect(Number.isFinite(ms)).toBe(true);
    }
  });
});
