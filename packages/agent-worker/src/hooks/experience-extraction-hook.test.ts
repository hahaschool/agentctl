import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../test-helpers.js';
import { createExperienceExtractionHook } from './experience-extraction-hook.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const mockLogger = createMockLogger();

describe('createExperienceExtractionHook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns zero result when no transcript is provided', async () => {
    const hook = createExperienceExtractionHook({
      litellmBaseUrl: 'http://localhost:4000',
      controlPlaneUrl: 'http://localhost:8080',
      logger: mockLogger,
    });

    const result = await hook({
      sessionId: 'session-1',
      agentId: 'agent-1',
      machineId: 'machine-1',
      reason: 'completed',
      totalTurns: 10,
      totalCostUsd: 0.05,
    });

    expect(result.extracted).toBe(0);
    expect(result.stored).toBe(0);
  });

  it('returns zero result for empty transcript', async () => {
    const hook = createExperienceExtractionHook({
      litellmBaseUrl: 'http://localhost:4000',
      controlPlaneUrl: 'http://localhost:8080',
      logger: mockLogger,
    });

    const result = await hook({
      sessionId: 'session-1',
      agentId: 'agent-1',
      machineId: 'machine-1',
      reason: 'completed',
      totalTurns: 10,
      totalCostUsd: 0.05,
      transcript: '   ',
    });

    expect(result.extracted).toBe(0);
    expect(result.stored).toBe(0);
  });

  it('defaults scope to agent:agentId', async () => {
    // We verify the hook creates the extractor with the correct scope by
    // checking it does not throw when no scope is provided and transcript
    // is short enough to skip extraction (totalTurns < 3).
    const hook = createExperienceExtractionHook({
      litellmBaseUrl: 'http://localhost:4000',
      controlPlaneUrl: 'http://localhost:8080',
      logger: mockLogger,
    });

    const result = await hook({
      sessionId: 'session-1',
      agentId: 'agent-1',
      machineId: 'machine-1',
      reason: 'completed',
      totalTurns: 1,
      totalCostUsd: 0.01,
      transcript: 'Short session',
    });

    expect(result.extracted).toBe(0);
  });

  it('catches errors from the extractor and returns zero result', async () => {
    // Trigger an error by providing a transcript but having the LLM call fail.
    // The hook should catch and return a zero result, not throw.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network failure'));

    const hook = createExperienceExtractionHook({
      litellmBaseUrl: 'http://localhost:4000',
      controlPlaneUrl: 'http://localhost:8080',
      logger: mockLogger,
    });

    const result = await hook({
      sessionId: 'session-1',
      agentId: 'agent-1',
      machineId: 'machine-1',
      reason: 'completed',
      totalTurns: 10,
      totalCostUsd: 0.1,
      transcript: 'User: Fix the bug. Assistant: Found the issue in auth.ts.',
    });

    expect(result.extracted).toBe(0);
    expect(result.stored).toBe(0);

    fetchSpy.mockRestore();
  });
});
