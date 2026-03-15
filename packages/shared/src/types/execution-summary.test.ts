import { describe, expect, it } from 'vitest';
import type { AgentRun } from './agent-run.js';
import {
  type ExecutionSummary,
  isExecutionSummary,
  toExecutionSummary,
} from './execution-summary.js';

describe('ExecutionSummary', () => {
  it('accepts a structured summary object', () => {
    const summary: ExecutionSummary = {
      status: 'success',
      workCompleted: 'Implemented structured summary storage.',
      executiveSummary: 'Structured summaries now have a backend contract.',
      keyFindings: ['Legacy string summaries still need compatibility support.'],
      filesChanged: [{ path: 'packages/shared/src/types/execution-summary.ts', action: 'created' }],
      commandsRun: 3,
      toolUsageBreakdown: { Read: 2, Edit: 1 },
      followUps: ['Add session-resume generation later.'],
      branchName: 'codex/structured-summary',
      prUrl: null,
      tokensUsed: { input: 1200, output: 340 },
      costUsd: 0.013,
      durationMs: 45_000,
    };

    expect(isExecutionSummary(summary)).toBe(true);
    expect(toExecutionSummary(summary)).toEqual(summary);
  });

  it('converts legacy text into a structured summary using run context', () => {
    const run: Pick<
      AgentRun,
      'status' | 'startedAt' | 'finishedAt' | 'costUsd' | 'tokensIn' | 'tokensOut'
    > = {
      status: 'success',
      startedAt: new Date('2026-03-11T10:00:00.000Z'),
      finishedAt: new Date('2026-03-11T10:02:30.000Z'),
      costUsd: 0.42,
      tokensIn: 1234,
      tokensOut: 567,
    };

    const summary = toExecutionSummary('All tests passed', run);

    expect(summary).toMatchObject({
      status: 'success',
      workCompleted: 'All tests passed',
      executiveSummary: 'All tests passed',
      costUsd: 0.42,
      durationMs: 150_000,
      tokensUsed: { input: 1234, output: 567 },
    });
    expect(summary?.keyFindings).toEqual([]);
    expect(summary?.filesChanged).toEqual([]);
    expect(summary?.toolUsageBreakdown).toEqual({});
  });

  it('maps in-progress run statuses to partial when converting legacy text', () => {
    const summary = toExecutionSummary('Checkpoint reached', {
      status: 'running',
      startedAt: new Date('2026-03-11T10:00:00.000Z'),
      finishedAt: null,
      costUsd: null,
      tokensIn: null,
      tokensOut: null,
    });

    expect(summary?.status).toBe('partial');
  });

  it('lets AgentRun carry either a legacy string or a structured summary', () => {
    const structured: AgentRun = {
      id: 'run-structured',
      agentId: 'agent-1',
      trigger: 'manual',
      status: 'success',
      startedAt: new Date('2026-03-11T10:00:00.000Z'),
      finishedAt: new Date('2026-03-11T10:01:00.000Z'),
      costUsd: 0.1,
      tokensIn: 100,
      tokensOut: 50,
      model: null,
      provider: null,
      sessionId: null,
      errorMessage: null,
      retryOf: null,
      retryIndex: null,
      resultSummary: {
        status: 'success',
        workCompleted: 'Did the thing',
        executiveSummary: 'Did the thing',
        keyFindings: [],
        filesChanged: [],
        commandsRun: 0,
        toolUsageBreakdown: {},
        followUps: [],
        branchName: null,
        prUrl: null,
        tokensUsed: { input: 100, output: 50 },
        costUsd: 0.1,
        durationMs: 60_000,
      },
    };

    const legacy: AgentRun = {
      ...structured,
      id: 'run-legacy',
      resultSummary: 'Did the thing',
    };

    expect(isExecutionSummary(structured.resultSummary)).toBe(true);
    expect(legacy.resultSummary).toBe('Did the thing');
  });
});
