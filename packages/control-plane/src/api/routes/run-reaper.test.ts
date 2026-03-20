import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerRunReaper } from './run-reaper.js';

// ── Constants mirrored from run-reaper.ts ─────────────────────────────────

const REAPER_INTERVAL_MS = 60_000;
const STALE_RUN_TIMEOUT_MS = 30 * 60 * 1000;

// ── DB Mock ────────────────────────────────────────────────────────────────

function createMockDb(reaped: Array<{ id: string }> = []) {
  const returningFn = vi.fn().mockResolvedValue(reaped);
  const whereFn = vi.fn().mockReturnValue({ returning: returningFn });
  const setFn = vi.fn().mockReturnValue({ where: whereFn });
  const updateFn = vi.fn().mockReturnValue({ set: setFn });

  return {
    update: updateFn,
    _returningFn: returningFn,
    _setFn: setFn,
    _whereFn: whereFn,
    _updateFn: updateFn,
  };
}

// ── Helper: wait for the immediate async reap to complete ─────────────────
// The reaper fires `void reapStaleRuns()` synchronously, but reapStaleRuns
// is async (it awaits the DB call). We need to flush the microtask queue.

async function flushAsync(): Promise<void> {
  // Two await ticks: one to start the promise chain, one to resolve it.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ── Tests ──────────────────────────────────────────────────────────────────
//
// Strategy:
//  - Register reaper and call app.ready() with real timers (Fastify needs them).
//  - Switch to fake timers right BEFORE calling ready() so setInterval is faked.
//  - Spy on app.log BEFORE ready() so logs from the immediate call are captured.
//

describe('registerRunReaper', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    vi.useRealTimers();
    await app.close().catch(() => {
      // Ignore if already closed in the test body.
    });
    vi.restoreAllMocks();
  });

  // -- Shared setup pattern -------------------------------------------------

  function buildAppWithFakeTimers(db: ReturnType<typeof createMockDb>): FastifyInstance {
    vi.useFakeTimers();
    const instance = Fastify({ logger: false });
    registerRunReaper(instance, db as never);
    return instance;
  }

  // -- Tests -----------------------------------------------------------------

  it('calls db.update immediately on startup to reap any pre-existing stale runs', async () => {
    const db = createMockDb();
    app = buildAppWithFakeTimers(db);
    vi.useRealTimers();
    await app.ready();

    await flushAsync();

    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it('passes status=failure and finishedAt when updating stale runs', async () => {
    const db = createMockDb();
    app = buildAppWithFakeTimers(db);
    vi.useRealTimers();
    await app.ready();

    await flushAsync();

    expect(db._setFn).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failure',
        finishedAt: expect.any(Date),
        errorMessage: expect.stringContaining('timed out'),
      }),
    );
  });

  it('registers a setInterval with the correct 60-second period', async () => {
    const db = createMockDb();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    app = Fastify({ logger: false });
    registerRunReaper(app, db as never);
    await app.ready();

    // setInterval must have been called exactly once with the correct delay
    const calls = setIntervalSpy.mock.calls.filter(([, delay]) => delay === REAPER_INTERVAL_MS);
    expect(calls).toHaveLength(1);
  });

  it('logs a warning when stale runs are reaped', async () => {
    const reaped = [{ id: 'run-aaa' }, { id: 'run-bbb' }];
    const db = createMockDb(reaped);
    app = Fastify({ logger: false });
    registerRunReaper(app, db as never);

    // Spy before ready() to capture the immediate reap log
    const warnSpy = vi.spyOn(app.log, 'warn');

    await app.ready();
    await flushAsync();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ count: 2, runIds: ['run-aaa', 'run-bbb'] }),
      expect.stringContaining('Reaped stale'),
    );
  });

  it('does NOT log a warning when no stale runs are found', async () => {
    const db = createMockDb([]);
    app = Fastify({ logger: false });
    registerRunReaper(app, db as never);

    const warnSpy = vi.spyOn(app.log, 'warn');

    await app.ready();
    await flushAsync();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs an error and continues when db.update throws an Error', async () => {
    const db = createMockDb();
    db._returningFn.mockRejectedValueOnce(new Error('DB connection lost'));

    app = Fastify({ logger: false });
    registerRunReaper(app, db as never);

    const errorSpy = vi.spyOn(app.log, 'error');

    await app.ready();
    await flushAsync();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: 'DB connection lost' }),
      expect.stringContaining('reaper failed'),
    );
  });

  it('logs an error with the string form when a non-Error is thrown', async () => {
    const db = createMockDb();
    db._returningFn.mockRejectedValueOnce('plain string error');

    app = Fastify({ logger: false });
    registerRunReaper(app, db as never);

    const errorSpy = vi.spyOn(app.log, 'error');

    await app.ready();
    await flushAsync();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: 'plain string error' }),
      expect.any(String),
    );
  });

  it('stops calling db.update after the app is closed (onClose hook clears interval)', async () => {
    const db = createMockDb();
    app = Fastify({ logger: false });
    registerRunReaper(app, db as never);
    await app.ready();

    await flushAsync();
    const callsBeforeClose = db._updateFn.mock.calls.length;

    await app.close();

    // Switch to fake timers so advancing time won't invoke real intervals
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(REAPER_INTERVAL_MS * 5);

    expect(db._updateFn.mock.calls.length).toBe(callsBeforeClose);

    // Replace with a fresh app so afterEach close() doesn't double-close
    app = Fastify({ logger: false });
    await app.ready();
  });

  it('uses the 30-minute stale threshold when computing the cutoff date', async () => {
    const db = createMockDb();
    // registerRunReaper() immediately kicks off one reap pass, so capture the
    // baseline timestamp before registration rather than before app.ready().
    const before = Date.now();
    app = Fastify({ logger: false });
    registerRunReaper(app, db as never);
    await app.ready();
    await flushAsync();

    const setArg = db._setFn.mock.calls[0][0] as { finishedAt: Date };
    // finishedAt must be at or after when we started
    expect(setArg.finishedAt.getTime()).toBeGreaterThanOrEqual(before);

    // The cutoff (Date.now() - STALE_RUN_TIMEOUT_MS) must be ~30 min in the past
    const expectedCutoff = new Date(before - STALE_RUN_TIMEOUT_MS);
    expect(expectedCutoff.getTime()).toBeLessThan(before);
    // 30 min = 1,800,000 ms
    expect(STALE_RUN_TIMEOUT_MS).toBe(1_800_000);
  });
});
