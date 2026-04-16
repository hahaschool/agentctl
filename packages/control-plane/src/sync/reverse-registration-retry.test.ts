import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReverseRegistrationResult } from './peer-reverse-registration.js';
import { ReverseRegistrationRetryScheduler } from './reverse-registration-retry.js';

// Mock performReverseRegistration
vi.mock('./peer-reverse-registration.js', () => ({
  performReverseRegistration: vi.fn(),
}));

import { performReverseRegistration } from './peer-reverse-registration.js';

const mockPerform = vi.mocked(performReverseRegistration);

function makeOkResult(): ReverseRegistrationResult {
  return { status: 'ok', error: null, errorCode: null, httpStatus: null };
}

function makeFailResult(errorCode = 'TOKEN_MISMATCH'): ReverseRegistrationResult {
  return { status: 'failed', error: 'some error', errorCode, httpStatus: 403 };
}

describe('ReverseRegistrationRetryScheduler', () => {
  let scheduler: ReverseRegistrationRetryScheduler;
  let onComplete: ReturnType<typeof vi.fn>;
  let buildOpts: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    onComplete = vi.fn().mockResolvedValue(undefined);
    buildOpts = vi.fn().mockReturnValue({
      targetSyncUrl: 'http://peer:8080',
      self: {
        machineId: 'self-id',
        hostname: 'self-host',
        tailscaleIp: '100.64.0.1',
        syncUrl: 'http://self:8080',
        publicKey: 'pk',
      },
      signingSecretKey: 'sk',
      registrationToken: 'token',
    });
    scheduler = new ReverseRegistrationRetryScheduler(buildOpts, onComplete);
  });

  afterEach(() => {
    scheduler.cancelAll();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('schedules first retry at 30s', () => {
    scheduler.scheduleRetry('peer-1');
    const state = scheduler.getRetryState('peer-1');
    expect(state).not.toBeNull();
    expect(state?.attempt).toBe(1);
    expect(state?.maxAttempts).toBe(3);
  });

  it('fires first attempt after 30s', async () => {
    mockPerform.mockResolvedValue(makeOkResult());
    scheduler.scheduleRetry('peer-1');

    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockPerform).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('peer-1', makeOkResult(), 1);
  });

  it('clears entry on success', async () => {
    mockPerform.mockResolvedValue(makeOkResult());
    scheduler.scheduleRetry('peer-1');

    await vi.advanceTimersByTimeAsync(30_000);

    expect(scheduler.getRetryState('peer-1')).toBeNull();
  });

  it('schedules second attempt at 60s after first failure', async () => {
    mockPerform.mockResolvedValue(makeFailResult());
    scheduler.scheduleRetry('peer-1');

    await vi.advanceTimersByTimeAsync(30_000);

    const state = scheduler.getRetryState('peer-1');
    expect(state?.attempt).toBe(2);
    expect(state?.maxAttempts).toBe(3);
  });

  it('runs all 3 attempts then stops', async () => {
    mockPerform.mockResolvedValue(makeFailResult());
    scheduler.scheduleRetry('peer-1');

    // 30s → attempt 1
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onComplete).toHaveBeenCalledTimes(1);

    // 60s → attempt 2
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onComplete).toHaveBeenCalledTimes(2);

    // 120s → attempt 3
    await vi.advanceTimersByTimeAsync(120_000);
    expect(onComplete).toHaveBeenCalledTimes(3);

    // No more attempts
    expect(scheduler.getRetryState('peer-1')).toBeNull();
  });

  it('stops early on success at attempt 2', async () => {
    mockPerform.mockResolvedValueOnce(makeFailResult()).mockResolvedValueOnce(makeOkResult());
    scheduler.scheduleRetry('peer-1');

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenLastCalledWith('peer-1', makeOkResult(), 2);
    expect(scheduler.getRetryState('peer-1')).toBeNull();
  });

  it('cancel prevents pending retry from firing', async () => {
    scheduler.scheduleRetry('peer-1');
    scheduler.cancel('peer-1');

    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockPerform).not.toHaveBeenCalled();
    expect(scheduler.getRetryState('peer-1')).toBeNull();
  });

  it('does not double-schedule', () => {
    scheduler.scheduleRetry('peer-1');
    scheduler.scheduleRetry('peer-1');

    // Only one entry should exist
    expect(scheduler.getRetryState('peer-1')).not.toBeNull();
  });

  it('returns null for unknown peer', () => {
    expect(scheduler.getRetryState('unknown')).toBeNull();
  });

  it('skips attempt when buildOpts returns null', async () => {
    buildOpts.mockReturnValue(null);
    scheduler.scheduleRetry('peer-1');

    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockPerform).not.toHaveBeenCalled();
    expect(scheduler.getRetryState('peer-1')).toBeNull();
  });

  it('cancelAll clears all entries', () => {
    scheduler.scheduleRetry('peer-1');
    scheduler.scheduleRetry('peer-2');
    scheduler.cancelAll();

    expect(scheduler.getRetryState('peer-1')).toBeNull();
    expect(scheduler.getRetryState('peer-2')).toBeNull();
  });
});
