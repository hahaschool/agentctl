import { describe, expect, it, vi } from 'vitest';
import type { DependencyStatus } from './check-with-timeout.js';
import { checkWithTimeout } from './check-with-timeout.js';

describe('checkWithTimeout', () => {
  it('returns ok status when the check succeeds', async () => {
    const result = await checkWithTimeout('test', async () => {}, 1_000);

    expect(result.status).toBe('ok');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it('returns error status when the check throws', async () => {
    const result = await checkWithTimeout(
      'test',
      async () => {
        throw new Error('connection refused');
      },
      1_000,
    );

    expect(result.status).toBe('error');
    expect(result.error).toBe('connection refused');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns error status when the check times out', async () => {
    vi.useFakeTimers();

    const promise = checkWithTimeout(
      'slowDep',
      () => new Promise<void>(() => {}), // never resolves
      500,
    );

    await vi.advanceTimersByTimeAsync(500);
    const result = await promise;

    expect(result.status).toBe('error');
    expect(result.error).toBe('slowDep health check timed out after 500ms');

    vi.useRealTimers();
  });

  it('stringifies non-Error throws', async () => {
    const result = await checkWithTimeout(
      'test',
      async () => {
        throw 'raw string error';
      },
      1_000,
    );

    expect(result.status).toBe('error');
    expect(result.error).toBe('raw string error');
  });

  it('measures latency in milliseconds', async () => {
    const result = await checkWithTimeout('test', async () => {}, 1_000);

    expect(typeof result.latencyMs).toBe('number');
    expect(Number.isInteger(result.latencyMs)).toBe(true);
  });
});

describe('DependencyStatus type', () => {
  it('accepts a valid ok status', () => {
    const status: DependencyStatus = { status: 'ok', latencyMs: 42 };
    expect(status.status).toBe('ok');
    expect(status.error).toBeUndefined();
  });

  it('accepts a valid error status with error string', () => {
    const status: DependencyStatus = { status: 'error', latencyMs: 100, error: 'timeout' };
    expect(status.status).toBe('error');
    expect(status.error).toBe('timeout');
  });
});
