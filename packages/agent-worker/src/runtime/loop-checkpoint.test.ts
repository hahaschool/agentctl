import { WorkerError } from '@agentctl/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CheckpointData } from './loop-checkpoint.js';
import { LoopCheckpoint } from './loop-checkpoint.js';

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCheckpointData(overrides: Partial<CheckpointData> = {}): CheckpointData {
  return {
    agentId: 'agent-001',
    runId: 'run-001',
    iteration: 5,
    totalCost: 0.05,
    elapsedMs: 30_000,
    status: 'running',
    ...overrides,
  };
}

function mockOkResponse(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockErrorResponse(status: number): Response {
  return new Response(JSON.stringify({ error: 'INTERNAL' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ============================================================================
// Constructor validation
// ============================================================================

describe('LoopCheckpoint — constructor', () => {
  it('throws WorkerError when controlPlaneUrl is empty', () => {
    expect(() => new LoopCheckpoint({ controlPlaneUrl: '' })).toThrow(WorkerError);
  });

  it('throws WorkerError when controlPlaneUrl is not a string', () => {
    expect(() => new LoopCheckpoint({ controlPlaneUrl: undefined as unknown as string })).toThrow(
      WorkerError,
    );
  });

  it('creates instance with valid controlPlaneUrl', () => {
    const cp = new LoopCheckpoint({ controlPlaneUrl: 'http://localhost:3000' });
    expect(cp).toBeInstanceOf(LoopCheckpoint);
  });

  it('strips trailing slashes from controlPlaneUrl', () => {
    const cp = new LoopCheckpoint({ controlPlaneUrl: 'http://localhost:3000///' });
    // Verify by calling report and checking the URL passed to fetch
    mockFetch.mockResolvedValue(mockOkResponse());
    cp.report(makeCheckpointData());
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toMatch(/^http:\/\/localhost:3000\/api\/agents\//);
    expect(calledUrl).not.toContain('////');
  });

  it('defaults checkpointInterval to 5', () => {
    const cp = new LoopCheckpoint({ controlPlaneUrl: 'http://localhost:3000' });
    expect(cp.getCheckpointInterval()).toBe(5);
  });

  it('defaults maxCheckpointFailures to 3', () => {
    const cp = new LoopCheckpoint({ controlPlaneUrl: 'http://localhost:3000' });
    expect(cp.getMaxCheckpointFailures()).toBe(3);
  });

  it('respects custom checkpointInterval', () => {
    const cp = new LoopCheckpoint({
      controlPlaneUrl: 'http://localhost:3000',
      checkpointInterval: 10,
    });
    expect(cp.getCheckpointInterval()).toBe(10);
  });

  it('respects custom maxCheckpointFailures', () => {
    const cp = new LoopCheckpoint({
      controlPlaneUrl: 'http://localhost:3000',
      maxCheckpointFailures: 5,
    });
    expect(cp.getMaxCheckpointFailures()).toBe(5);
  });

  it('clamps checkpointInterval to minimum of 1', () => {
    const cp = new LoopCheckpoint({
      controlPlaneUrl: 'http://localhost:3000',
      checkpointInterval: 0,
    });
    expect(cp.getCheckpointInterval()).toBe(1);
  });

  it('clamps maxCheckpointFailures to minimum of 1', () => {
    const cp = new LoopCheckpoint({
      controlPlaneUrl: 'http://localhost:3000',
      maxCheckpointFailures: -1,
    });
    expect(cp.getMaxCheckpointFailures()).toBe(1);
  });
});

// ============================================================================
// shouldCheckpoint
// ============================================================================

describe('LoopCheckpoint — shouldCheckpoint', () => {
  it('returns true at interval boundaries (default 5)', () => {
    const cp = new LoopCheckpoint({ controlPlaneUrl: 'http://localhost:3000' });
    expect(cp.shouldCheckpoint(5)).toBe(true);
    expect(cp.shouldCheckpoint(10)).toBe(true);
    expect(cp.shouldCheckpoint(15)).toBe(true);
  });

  it('returns false between intervals', () => {
    const cp = new LoopCheckpoint({ controlPlaneUrl: 'http://localhost:3000' });
    expect(cp.shouldCheckpoint(1)).toBe(false);
    expect(cp.shouldCheckpoint(2)).toBe(false);
    expect(cp.shouldCheckpoint(3)).toBe(false);
    expect(cp.shouldCheckpoint(4)).toBe(false);
    expect(cp.shouldCheckpoint(6)).toBe(false);
  });

  it('returns false for iteration 0', () => {
    const cp = new LoopCheckpoint({ controlPlaneUrl: 'http://localhost:3000' });
    expect(cp.shouldCheckpoint(0)).toBe(false);
  });

  it('returns false for negative iterations', () => {
    const cp = new LoopCheckpoint({ controlPlaneUrl: 'http://localhost:3000' });
    expect(cp.shouldCheckpoint(-1)).toBe(false);
    expect(cp.shouldCheckpoint(-10)).toBe(false);
  });

  it('works with custom interval of 1 (every iteration)', () => {
    const cp = new LoopCheckpoint({
      controlPlaneUrl: 'http://localhost:3000',
      checkpointInterval: 1,
    });
    expect(cp.shouldCheckpoint(1)).toBe(true);
    expect(cp.shouldCheckpoint(2)).toBe(true);
    expect(cp.shouldCheckpoint(100)).toBe(true);
  });

  it('works with custom interval of 3', () => {
    const cp = new LoopCheckpoint({
      controlPlaneUrl: 'http://localhost:3000',
      checkpointInterval: 3,
    });
    expect(cp.shouldCheckpoint(3)).toBe(true);
    expect(cp.shouldCheckpoint(6)).toBe(true);
    expect(cp.shouldCheckpoint(4)).toBe(false);
    expect(cp.shouldCheckpoint(5)).toBe(false);
  });
});

// ============================================================================
// report — success
// ============================================================================

describe('LoopCheckpoint — report (success)', () => {
  it('returns true on successful HTTP 200 response', async () => {
    mockFetch.mockResolvedValue(mockOkResponse());

    const cp = new LoopCheckpoint({ controlPlaneUrl: 'http://localhost:3000' });
    const result = await cp.report(makeCheckpointData());

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('sends POST with correct URL and headers', async () => {
    mockFetch.mockResolvedValue(mockOkResponse());

    const cp = new LoopCheckpoint({ controlPlaneUrl: 'http://localhost:3000' });
    await cp.report(makeCheckpointData({ agentId: 'my-agent' }));

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/agents/my-agent/checkpoint');
    expect((options as RequestInit).method).toBe('POST');
    expect((options as RequestInit).headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('sends the checkpoint data as JSON body', async () => {
    mockFetch.mockResolvedValue(mockOkResponse());

    const data = makeCheckpointData({ iteration: 42, totalCost: 1.5 });
    const cp = new LoopCheckpoint({ controlPlaneUrl: 'http://localhost:3000' });
    await cp.report(data);

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.iteration).toBe(42);
    expect(body.totalCost).toBe(1.5);
    expect(body.agentId).toBe('agent-001');
  });

  it('resets failure counter on success', async () => {
    mockFetch
      .mockResolvedValueOnce(mockErrorResponse(500))
      .mockResolvedValueOnce(mockErrorResponse(500))
      .mockResolvedValueOnce(mockOkResponse());

    const cp = new LoopCheckpoint({ controlPlaneUrl: 'http://localhost:3000' });

    await cp.report(makeCheckpointData());
    expect(cp.getConsecutiveFailures()).toBe(1);

    await cp.report(makeCheckpointData());
    expect(cp.getConsecutiveFailures()).toBe(2);

    await cp.report(makeCheckpointData());
    expect(cp.getConsecutiveFailures()).toBe(0);
  });

  it('URL-encodes the agentId in the path', async () => {
    mockFetch.mockResolvedValue(mockOkResponse());

    const cp = new LoopCheckpoint({ controlPlaneUrl: 'http://localhost:3000' });
    await cp.report(makeCheckpointData({ agentId: 'agent/with spaces' }));

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toBe('http://localhost:3000/api/agents/agent%2Fwith%20spaces/checkpoint');
  });
});

// ============================================================================
// report — failure
// ============================================================================

describe('LoopCheckpoint — report (failure)', () => {
  it('returns false on HTTP 500 response', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(500));

    const cp = new LoopCheckpoint({ controlPlaneUrl: 'http://localhost:3000' });
    const result = await cp.report(makeCheckpointData());

    expect(result).toBe(false);
    expect(cp.getConsecutiveFailures()).toBe(1);
  });

  it('returns false on HTTP 400 response', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(400));

    const cp = new LoopCheckpoint({ controlPlaneUrl: 'http://localhost:3000' });
    const result = await cp.report(makeCheckpointData());

    expect(result).toBe(false);
  });

  it('returns false on network error (does not throw)', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const cp = new LoopCheckpoint({ controlPlaneUrl: 'http://localhost:3000' });
    const result = await cp.report(makeCheckpointData());

    expect(result).toBe(false);
    expect(cp.getConsecutiveFailures()).toBe(1);
  });

  it('returns false on timeout (does not throw)', async () => {
    mockFetch.mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));

    const cp = new LoopCheckpoint({ controlPlaneUrl: 'http://localhost:3000' });
    const result = await cp.report(makeCheckpointData());

    expect(result).toBe(false);
    expect(cp.getConsecutiveFailures()).toBe(1);
  });

  it('increments consecutive failures on each failure', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(500));

    const cp = new LoopCheckpoint({ controlPlaneUrl: 'http://localhost:3000' });

    await cp.report(makeCheckpointData());
    expect(cp.getConsecutiveFailures()).toBe(1);

    await cp.report(makeCheckpointData());
    expect(cp.getConsecutiveFailures()).toBe(2);

    await cp.report(makeCheckpointData());
    expect(cp.getConsecutiveFailures()).toBe(3);
  });
});

// ============================================================================
// shouldAutoPause
// ============================================================================

describe('LoopCheckpoint — shouldAutoPause', () => {
  it('returns false when failure count is below threshold', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(500));

    const cp = new LoopCheckpoint({
      controlPlaneUrl: 'http://localhost:3000',
      maxCheckpointFailures: 3,
    });

    await cp.report(makeCheckpointData());
    expect(cp.shouldAutoPause()).toBe(false);

    await cp.report(makeCheckpointData());
    expect(cp.shouldAutoPause()).toBe(false);
  });

  it('returns true when failure count reaches threshold', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(500));

    const cp = new LoopCheckpoint({
      controlPlaneUrl: 'http://localhost:3000',
      maxCheckpointFailures: 3,
    });

    await cp.report(makeCheckpointData());
    await cp.report(makeCheckpointData());
    await cp.report(makeCheckpointData());

    expect(cp.shouldAutoPause()).toBe(true);
  });

  it('returns true when failure count exceeds threshold', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(500));

    const cp = new LoopCheckpoint({
      controlPlaneUrl: 'http://localhost:3000',
      maxCheckpointFailures: 2,
    });

    await cp.report(makeCheckpointData());
    await cp.report(makeCheckpointData());
    await cp.report(makeCheckpointData());

    expect(cp.shouldAutoPause()).toBe(true);
    expect(cp.getConsecutiveFailures()).toBe(3);
  });

  it('returns false after failures are reset by a successful report', async () => {
    mockFetch
      .mockResolvedValueOnce(mockErrorResponse(500))
      .mockResolvedValueOnce(mockErrorResponse(500))
      .mockResolvedValueOnce(mockOkResponse());

    const cp = new LoopCheckpoint({
      controlPlaneUrl: 'http://localhost:3000',
      maxCheckpointFailures: 3,
    });

    await cp.report(makeCheckpointData());
    await cp.report(makeCheckpointData());
    expect(cp.getConsecutiveFailures()).toBe(2);

    await cp.report(makeCheckpointData());
    expect(cp.shouldAutoPause()).toBe(false);
    expect(cp.getConsecutiveFailures()).toBe(0);
  });

  it('returns false initially with no failures', () => {
    const cp = new LoopCheckpoint({ controlPlaneUrl: 'http://localhost:3000' });
    expect(cp.shouldAutoPause()).toBe(false);
  });

  it('works with custom maxCheckpointFailures of 1', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(500));

    const cp = new LoopCheckpoint({
      controlPlaneUrl: 'http://localhost:3000',
      maxCheckpointFailures: 1,
    });

    await cp.report(makeCheckpointData());
    expect(cp.shouldAutoPause()).toBe(true);
  });
});

// ============================================================================
// resetFailures
// ============================================================================

describe('LoopCheckpoint — resetFailures', () => {
  it('resets consecutive failures to zero', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(500));

    const cp = new LoopCheckpoint({ controlPlaneUrl: 'http://localhost:3000' });

    await cp.report(makeCheckpointData());
    await cp.report(makeCheckpointData());
    expect(cp.getConsecutiveFailures()).toBe(2);

    cp.resetFailures();
    expect(cp.getConsecutiveFailures()).toBe(0);
    expect(cp.shouldAutoPause()).toBe(false);
  });

  it('is idempotent when already at zero', () => {
    const cp = new LoopCheckpoint({ controlPlaneUrl: 'http://localhost:3000' });
    cp.resetFailures();
    expect(cp.getConsecutiveFailures()).toBe(0);
  });
});

// ============================================================================
// report with lastResult
// ============================================================================

describe('LoopCheckpoint — report with optional lastResult', () => {
  it('includes lastResult in the body when provided', async () => {
    mockFetch.mockResolvedValue(mockOkResponse());

    const cp = new LoopCheckpoint({ controlPlaneUrl: 'http://localhost:3000' });
    await cp.report(makeCheckpointData({ lastResult: 'iteration output' }));

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.lastResult).toBe('iteration output');
  });

  it('omits lastResult from the body when not provided', async () => {
    mockFetch.mockResolvedValue(mockOkResponse());

    const cp = new LoopCheckpoint({ controlPlaneUrl: 'http://localhost:3000' });
    const data = makeCheckpointData();
    delete data.lastResult;
    await cp.report(data);

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.lastResult).toBeUndefined();
  });
});
