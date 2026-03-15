import { type AgentRun, ControlPlaneError, type ExecutionSummary } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { createServer } from '../server.js';
import { createFullMockDbRegistry, createMockLogger } from './test-helpers.js';

const logger = createMockLogger();

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-001',
    agentId: 'agent-1',
    trigger: 'manual',
    status: 'success',
    startedAt: new Date('2026-03-11T10:00:00.000Z'),
    finishedAt: new Date('2026-03-11T10:02:00.000Z'),
    costUsd: 0.3,
    tokensIn: 1200,
    tokensOut: 450,
    model: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    sessionId: 'sess-1',
    errorMessage: null,
    resultSummary: null,
    retryOf: null,
    retryIndex: null,
    ...overrides,
  };
}

function makeStructuredSummary(overrides: Partial<ExecutionSummary> = {}): ExecutionSummary {
  return {
    status: 'success',
    workCompleted: 'Implemented a structured summary.',
    executiveSummary: 'Summary contract landed.',
    keyFindings: ['Legacy summaries still need compatibility support.'],
    filesChanged: [{ path: 'packages/shared/src/types/execution-summary.ts', action: 'created' }],
    commandsRun: 2,
    toolUsageBreakdown: { Read: 1, Edit: 1 },
    followUps: ['Add worker-generated summaries later.'],
    branchName: null,
    prUrl: null,
    tokensUsed: { input: 1200, output: 450 },
    costUsd: 0.3,
    durationMs: 120_000,
    ...overrides,
  };
}

const sampleActions = [
  {
    id: 1,
    runId: 'run-001',
    timestamp: new Date('2026-03-11T10:00:00.000Z'),
    actionType: 'tool_call',
    toolName: 'Read',
    toolInput: { file: 'src/index.ts' },
    toolOutputHash: null,
    durationMs: 100,
    approvedBy: 'auto',
    agentId: 'agent-1',
  },
  {
    id: 2,
    runId: 'run-001',
    timestamp: new Date('2026-03-11T10:00:01.000Z'),
    actionType: 'tool_call',
    toolName: 'Write',
    toolInput: { file: 'src/index.ts' },
    toolOutputHash: null,
    durationMs: 200,
    approvedBy: 'auto',
    agentId: 'agent-1',
  },
];

describe('Run summary route — /api/runs/:runId/summary', () => {
  let app: FastifyInstance;
  let mockDbRegistry: DbAgentRegistry;

  beforeAll(async () => {
    mockDbRegistry = createFullMockDbRegistry();
    app = await createServer({ logger, dbRegistry: mockDbRegistry });
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockDbRegistry.getRun).mockResolvedValue(makeRun());
    vi.mocked(mockDbRegistry.queryActions).mockResolvedValue({
      actions: sampleActions,
      total: sampleActions.length,
      hasMore: false,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a stored structured summary when one already exists', async () => {
    const summary = makeStructuredSummary();
    vi.mocked(mockDbRegistry.getRun).mockResolvedValue(makeRun({ resultSummary: summary }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/runs/run-001/summary',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      runId: 'run-001',
      source: 'stored',
      summary,
    });
    expect(mockDbRegistry.queryActions).not.toHaveBeenCalled();
  });

  it('normalizes a stored legacy string summary into the structured response shape', async () => {
    vi.mocked(mockDbRegistry.getRun).mockResolvedValue(
      makeRun({ resultSummary: 'All tests passed' }),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/runs/run-001/summary',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.source).toBe('stored');
    expect(body.summary).toMatchObject({
      status: 'success',
      workCompleted: 'All tests passed',
      executiveSummary: 'All tests passed',
    });
    expect(mockDbRegistry.queryActions).not.toHaveBeenCalled();
  });

  it('falls back to replay-derived summary data when there is no stored summary', async () => {
    vi.mocked(mockDbRegistry.getRun).mockResolvedValue(makeRun({ resultSummary: null }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/runs/run-001/summary',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.runId).toBe('run-001');
    expect(body.source).toBe('fallback');
    expect(body.summary).toMatchObject({
      status: 'success',
      commandsRun: 2,
      costUsd: 0.3,
      tokensUsed: { input: 1200, output: 450 },
    });
  });

  it('returns 404 when the run does not exist', async () => {
    vi.mocked(mockDbRegistry.getRun).mockResolvedValue(undefined);

    const response = await app.inject({
      method: 'GET',
      url: '/api/runs/missing-run/summary',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: 'RUN_NOT_FOUND',
      message: "Run 'missing-run' was not found",
    });
  });

  it('returns 404 when neither a stored summary nor replay data exists', async () => {
    vi.mocked(mockDbRegistry.queryActions).mockResolvedValue({
      actions: [],
      total: 0,
      hasMore: false,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/runs/run-001/summary',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: 'RUN_SUMMARY_NOT_FOUND',
      message: "Run 'run-001' does not have a stored or replay-derived summary",
    });
  });

  it('returns 502 when replay fallback hits a ControlPlaneError', async () => {
    vi.mocked(mockDbRegistry.queryActions).mockRejectedValue(
      new ControlPlaneError('AUDIT_QUERY_FAILED', 'Query failed', {}),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/runs/run-001/summary',
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      error: 'AUDIT_QUERY_FAILED',
      message: 'Query failed',
    });
  });
});
