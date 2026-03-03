import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { securityFindingsRoutes } from './security-findings.js';

// ---------------------------------------------------------------------------
// Drizzle SQL extraction helpers
// ---------------------------------------------------------------------------

function flattenDrizzleSql(chunks: unknown[]): { sql: string; params: unknown[] } {
  let sqlStr = '';
  const params: unknown[] = [];

  for (const chunk of chunks) {
    if (chunk && typeof chunk === 'object' && 'queryChunks' in chunk) {
      const nested = flattenDrizzleSql((chunk as { queryChunks: unknown[] }).queryChunks);
      sqlStr += nested.sql;
      params.push(...nested.params);
    } else if (chunk && typeof chunk === 'object' && 'value' in chunk) {
      sqlStr += (chunk as { value: string[] }).value.join('');
    } else {
      params.push(chunk);
      sqlStr += `$${params.length}`;
    }
  }

  return { sql: sqlStr, params };
}

function extractQuery(query: unknown): { sql: string; params: unknown[] } {
  if (query && typeof query === 'object' && 'queryChunks' in query) {
    return flattenDrizzleSql((query as { queryChunks: unknown[] }).queryChunks);
  }
  if (query && typeof query === 'object' && 'sql' in query) {
    return query as { sql: string; params: unknown[] };
  }
  return { sql: '', params: [] };
}

// ---------------------------------------------------------------------------
// Sample data factories
// ---------------------------------------------------------------------------

function sampleFinding(overrides: Record<string, unknown> = {}) {
  return {
    id: 'finding-001',
    severity: 'critical',
    category: 'secrets',
    title: 'Hardcoded API Key',
    description: 'Found hardcoded API key in source file',
    file: 'src/config.ts',
    line: 42,
    recommendation: 'Move the key to environment variables',
    ...overrides,
  };
}

function sampleFindingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'finding-001',
    agent_id: 'agent-1',
    run_id: 'run-001',
    severity: 'critical',
    category: 'secrets',
    title: 'Hardcoded API Key',
    description: 'Found hardcoded API key in source file',
    file: 'src/config.ts',
    line: 42,
    recommendation: 'Move the key to environment variables',
    acknowledged: false,
    acknowledged_by: null,
    acknowledge_reason: null,
    issue_created: false,
    created_at: '2026-03-01T10:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock database
// ---------------------------------------------------------------------------

function createMockDb() {
  const db = {
    execute: vi.fn(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      const normalised = sqlStr.replace(/\s+/g, ' ').trim();

      // --- INSERT into security_findings ---
      if (normalised.includes('INSERT INTO security_findings')) {
        return { rows: [] };
      }

      // --- SELECT * FROM security_findings with filters (list) ---
      if (
        normalised.includes('FROM security_findings') &&
        normalised.includes('ORDER BY created_at DESC') &&
        normalised.includes('LIMIT')
      ) {
        return { rows: [sampleFindingRow()] };
      }

      // --- COUNT from security_findings with WHERE (list total) ---
      if (
        normalised.includes('COUNT(*)::int AS count FROM security_findings') &&
        !normalised.includes('GROUP BY')
      ) {
        return { rows: [{ count: 1 }] };
      }

      // --- Summary: severity counts ---
      if (normalised.includes('FROM security_findings GROUP BY severity')) {
        return {
          rows: [
            { severity: 'critical', count: 3 },
            { severity: 'high', count: 5 },
            { severity: 'medium', count: 10 },
            { severity: 'low', count: 2 },
            { severity: 'info', count: 1 },
          ],
        };
      }

      // --- Summary: category counts ---
      if (normalised.includes('FROM security_findings GROUP BY category')) {
        return {
          rows: [
            { category: 'secrets', count: 8 },
            { category: 'injection', count: 7 },
            { category: 'config', count: 6 },
          ],
        };
      }

      // --- SELECT id for acknowledge check ---
      if (normalised.includes('SELECT id FROM security_findings WHERE id =')) {
        return { rows: [{ id: 'finding-001' }] };
      }

      // --- UPDATE for acknowledge ---
      if (normalised.includes('UPDATE security_findings SET acknowledged')) {
        return { rows: [] };
      }

      // --- SELECT unacknowledged critical/high for GH issues ---
      if (
        normalised.includes('acknowledged') &&
        normalised.includes('issue_created') &&
        normalised.includes("IN ('critical', 'high')")
      ) {
        return {
          rows: [
            sampleFindingRow({ id: 'finding-crit-1', severity: 'critical' }),
            sampleFindingRow({ id: 'finding-high-1', severity: 'high' }),
          ],
        };
      }

      // --- UPDATE issue_created ---
      if (normalised.includes('UPDATE security_findings SET issue_created')) {
        return { rows: [] };
      }

      return { rows: [] };
    }),
  };

  return db;
}

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

async function buildApp(mockDb: ReturnType<typeof createMockDb>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(securityFindingsRoutes, {
    prefix: '/api/security',
    db: mockDb as never,
  });
  await app.ready();
  return app;
}

// =============================================================================
// POST /api/security/findings — Ingest
// =============================================================================

describe('Security findings routes — POST /api/security/findings', () => {
  let app: FastifyInstance;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeAll(async () => {
    mockDb = createMockDb();
    app = await buildApp(mockDb);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-setup the default mock implementation after clearAllMocks
    mockDb.execute.mockImplementation(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      const normalised = sqlStr.replace(/\s+/g, ' ').trim();
      if (normalised.includes('INSERT INTO security_findings')) {
        return { rows: [] };
      }
      return { rows: [] };
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // --- Happy path ---

  it('ingests findings and returns counts', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings',
      payload: {
        agentId: 'agent-1',
        runId: 'run-001',
        findings: [
          sampleFinding({ id: 'f-1', severity: 'critical' }),
          sampleFinding({ id: 'f-2', severity: 'high' }),
          sampleFinding({ id: 'f-3', severity: 'medium' }),
        ],
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.ingested).toBe(3);
    expect(body.criticalCount).toBe(1);
    expect(body.highCount).toBe(1);
  });

  it('calls db.execute for each finding', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/security/findings',
      payload: {
        agentId: 'agent-1',
        runId: 'run-001',
        findings: [sampleFinding({ id: 'f-1' }), sampleFinding({ id: 'f-2' })],
      },
    });

    expect(mockDb.execute).toHaveBeenCalledTimes(2);
  });

  it('handles findings without optional file and line', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings',
      payload: {
        agentId: 'agent-1',
        runId: 'run-001',
        findings: [
          {
            id: 'f-1',
            severity: 'info',
            category: 'config',
            title: 'Missing rate limit',
            description: 'Rate limiting not configured',
            recommendation: 'Add rate limiting middleware',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.ingested).toBe(1);
  });

  it('returns criticalCount=0 and highCount=0 when only low/medium', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings',
      payload: {
        agentId: 'agent-1',
        runId: 'run-001',
        findings: [
          sampleFinding({ id: 'f-1', severity: 'low' }),
          sampleFinding({ id: 'f-2', severity: 'medium' }),
        ],
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.criticalCount).toBe(0);
    expect(body.highCount).toBe(0);
  });

  it('accepts info severity', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings',
      payload: {
        agentId: 'agent-1',
        runId: 'run-001',
        findings: [sampleFinding({ id: 'f-1', severity: 'info' })],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().ok).toBe(true);
  });

  // --- Validation errors ---

  it('returns 400 when agentId is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings',
      payload: {
        runId: 'run-001',
        findings: [sampleFinding()],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_AGENT_ID');
  });

  it('returns 400 when agentId is empty', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings',
      payload: {
        agentId: '',
        runId: 'run-001',
        findings: [sampleFinding()],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_AGENT_ID');
  });

  it('returns 400 when runId is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings',
      payload: {
        agentId: 'agent-1',
        findings: [sampleFinding()],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_RUN_ID');
  });

  it('returns 400 when runId is empty', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings',
      payload: {
        agentId: 'agent-1',
        runId: '',
        findings: [sampleFinding()],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_RUN_ID');
  });

  it('returns 400 when findings is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings',
      payload: {
        agentId: 'agent-1',
        runId: 'run-001',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_FINDINGS');
  });

  it('returns 400 when findings is empty', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings',
      payload: {
        agentId: 'agent-1',
        runId: 'run-001',
        findings: [],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_FINDINGS');
  });

  it('returns 400 when findings is not an array', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings',
      payload: {
        agentId: 'agent-1',
        runId: 'run-001',
        findings: 'not-an-array',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_FINDINGS');
  });

  it('returns 400 when batch exceeds maximum of 500', async () => {
    const oversized = Array.from({ length: 501 }, (_, i) => sampleFinding({ id: `f-${i}` }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings',
      payload: {
        agentId: 'agent-1',
        runId: 'run-001',
        findings: oversized,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('BATCH_SIZE_EXCEEDED');
    expect(response.json().message).toContain('501');
    expect(response.json().message).toContain('500');
  });

  it('returns 400 when finding has missing id', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings',
      payload: {
        agentId: 'agent-1',
        runId: 'run-001',
        findings: [
          {
            severity: 'high',
            category: 'injection',
            title: 'T',
            description: 'D',
            recommendation: 'R',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_FINDING_ID');
  });

  it('returns 400 when finding has invalid severity', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings',
      payload: {
        agentId: 'agent-1',
        runId: 'run-001',
        findings: [sampleFinding({ severity: 'extreme' })],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_SEVERITY');
  });

  it('returns 400 when finding has missing category', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings',
      payload: {
        agentId: 'agent-1',
        runId: 'run-001',
        findings: [
          { id: 'f-1', severity: 'high', title: 'T', description: 'D', recommendation: 'R' },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_CATEGORY');
  });

  it('returns 400 when finding has missing title', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings',
      payload: {
        agentId: 'agent-1',
        runId: 'run-001',
        findings: [
          {
            id: 'f-1',
            severity: 'high',
            category: 'secrets',
            description: 'D',
            recommendation: 'R',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_TITLE');
  });

  it('returns 400 when finding has missing description', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings',
      payload: {
        agentId: 'agent-1',
        runId: 'run-001',
        findings: [
          { id: 'f-1', severity: 'high', category: 'secrets', title: 'T', recommendation: 'R' },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_DESCRIPTION');
  });

  it('returns 400 when finding has missing recommendation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings',
      payload: {
        agentId: 'agent-1',
        runId: 'run-001',
        findings: [
          { id: 'f-1', severity: 'high', category: 'secrets', title: 'T', description: 'D' },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_RECOMMENDATION');
  });

  it('does not call db.execute when validation fails', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/security/findings',
      payload: {
        agentId: '',
        runId: 'run-001',
        findings: [sampleFinding()],
      },
    });

    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  // --- Error handling ---

  it('returns 500 when db.execute throws an unexpected error', async () => {
    mockDb.execute.mockRejectedValueOnce(new Error('connection reset'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings',
      payload: {
        agentId: 'agent-1',
        runId: 'run-001',
        findings: [sampleFinding()],
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error).toBe('FINDINGS_INGEST_FAILED');
  });
});

// =============================================================================
// GET /api/security/findings — List
// =============================================================================

describe('Security findings routes — GET /api/security/findings', () => {
  let app: FastifyInstance;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeAll(async () => {
    mockDb = createMockDb();
    app = await buildApp(mockDb);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default mock implementation
    mockDb.execute.mockImplementation(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      const normalised = sqlStr.replace(/\s+/g, ' ').trim();

      if (
        normalised.includes('FROM security_findings') &&
        normalised.includes('ORDER BY created_at DESC')
      ) {
        return { rows: [sampleFindingRow()] };
      }
      if (
        normalised.includes('COUNT(*)::int AS count FROM security_findings') &&
        !normalised.includes('GROUP BY')
      ) {
        return { rows: [{ count: 1 }] };
      }
      return { rows: [] };
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns findings with default pagination', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/security/findings',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.findings).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it('returns formatted finding objects', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/security/findings',
    });

    const body = response.json();
    const finding = body.findings[0];

    expect(finding.id).toBe('finding-001');
    expect(finding.agentId).toBe('agent-1');
    expect(finding.runId).toBe('run-001');
    expect(finding.severity).toBe('critical');
    expect(finding.category).toBe('secrets');
    expect(finding.title).toBe('Hardcoded API Key');
    expect(finding.acknowledged).toBe(false);
    expect(finding.issueCreated).toBe(false);
  });

  it('passes severity filter in query', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/security/findings?severity=high',
    });

    expect(mockDb.execute).toHaveBeenCalled();

    const firstCall = mockDb.execute.mock.calls[0][0];
    const { sql: sqlStr } = extractQuery(firstCall);
    const normalised = sqlStr.replace(/\s+/g, ' ').trim();

    // The query should contain severity filter
    expect(normalised).toContain('severity =');
  });

  it('passes category filter in query', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/security/findings?category=injection',
    });

    expect(mockDb.execute).toHaveBeenCalled();

    const firstCall = mockDb.execute.mock.calls[0][0];
    const { sql: sqlStr } = extractQuery(firstCall);
    const normalised = sqlStr.replace(/\s+/g, ' ').trim();

    expect(normalised).toContain('category =');
  });

  it('passes agentId filter in query', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/security/findings?agentId=agent-1',
    });

    expect(mockDb.execute).toHaveBeenCalled();

    const firstCall = mockDb.execute.mock.calls[0][0];
    const { sql: sqlStr } = extractQuery(firstCall);
    const normalised = sqlStr.replace(/\s+/g, ' ').trim();

    expect(normalised).toContain('agent_id =');
  });

  it('returns 400 for invalid severity filter', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/security/findings?severity=extreme',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_SEVERITY');
  });

  it('returns 400 for invalid limit (non-numeric)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/security/findings?limit=abc',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_LIMIT');
  });

  it('returns 400 for negative limit', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/security/findings?limit=-5',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_LIMIT');
  });

  it('returns 400 for negative offset', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/security/findings?offset=-1',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_OFFSET');
  });

  it('returns empty findings array when no rows exist', async () => {
    mockDb.execute.mockImplementation(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      const normalised = sqlStr.replace(/\s+/g, ' ').trim();

      if (normalised.includes('COUNT(*)::int AS count')) {
        return { rows: [{ count: 0 }] };
      }
      return { rows: [] };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/security/findings',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.findings).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('returns 500 when database query fails', async () => {
    mockDb.execute.mockRejectedValueOnce(new Error('connection lost'));

    const response = await app.inject({
      method: 'GET',
      url: '/api/security/findings',
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error).toBe('FINDINGS_QUERY_FAILED');
  });
});

// =============================================================================
// GET /api/security/findings/summary — Summary
// =============================================================================

describe('Security findings routes — GET /api/security/findings/summary', () => {
  let app: FastifyInstance;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeAll(async () => {
    mockDb = createMockDb();
    app = await buildApp(mockDb);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default mock
    mockDb.execute.mockImplementation(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      const normalised = sqlStr.replace(/\s+/g, ' ').trim();

      if (
        normalised.includes('COUNT(*)::int AS count FROM security_findings') &&
        !normalised.includes('GROUP BY')
      ) {
        return { rows: [{ count: 21 }] };
      }
      if (normalised.includes('GROUP BY severity')) {
        return {
          rows: [
            { severity: 'critical', count: 3 },
            { severity: 'high', count: 5 },
            { severity: 'medium', count: 10 },
            { severity: 'low', count: 2 },
            { severity: 'info', count: 1 },
          ],
        };
      }
      if (normalised.includes('GROUP BY category')) {
        return {
          rows: [
            { category: 'secrets', count: 8 },
            { category: 'injection', count: 7 },
            { category: 'config', count: 6 },
          ],
        };
      }
      return { rows: [] };
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns total count', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/security/findings/summary',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.total).toBe(21);
  });

  it('returns severity breakdown', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/security/findings/summary',
    });

    const body = response.json();
    expect(body.critical).toBe(3);
    expect(body.high).toBe(5);
    expect(body.medium).toBe(10);
    expect(body.low).toBe(2);
    expect(body.info).toBe(1);
  });

  it('returns category breakdown', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/security/findings/summary',
    });

    const body = response.json();
    expect(body.byCategory).toBeDefined();
    expect(body.byCategory.secrets).toBe(8);
    expect(body.byCategory.injection).toBe(7);
    expect(body.byCategory.config).toBe(6);
  });

  it('returns zeroed counts when no findings exist', async () => {
    mockDb.execute.mockImplementation(async () => ({ rows: [] }));

    // Need to handle the case where count returns no rows too
    mockDb.execute
      .mockResolvedValueOnce({ rows: [{ count: 0 }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    const response = await app.inject({
      method: 'GET',
      url: '/api/security/findings/summary',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.total).toBe(0);
    expect(body.critical).toBe(0);
    expect(body.high).toBe(0);
    expect(body.medium).toBe(0);
    expect(body.low).toBe(0);
    expect(body.info).toBe(0);
    expect(body.byCategory).toEqual({});
  });

  it('returns 500 when database query fails', async () => {
    mockDb.execute.mockRejectedValueOnce(new Error('boom'));

    const response = await app.inject({
      method: 'GET',
      url: '/api/security/findings/summary',
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error).toBe('FINDINGS_SUMMARY_FAILED');
  });
});

// =============================================================================
// POST /api/security/findings/:id/acknowledge — Acknowledge
// =============================================================================

describe('Security findings routes — POST /api/security/findings/:id/acknowledge', () => {
  let app: FastifyInstance;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeAll(async () => {
    mockDb = createMockDb();
    app = await buildApp(mockDb);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default mock
    mockDb.execute.mockImplementation(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      const normalised = sqlStr.replace(/\s+/g, ' ').trim();

      if (normalised.includes('SELECT id FROM security_findings WHERE id =')) {
        return { rows: [{ id: 'finding-001' }] };
      }
      if (normalised.includes('UPDATE security_findings SET acknowledged')) {
        return { rows: [] };
      }
      return { rows: [] };
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('acknowledges a finding and returns ok', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings/finding-001/acknowledge',
      payload: {
        acknowledgedBy: 'user-1',
        reason: 'False positive',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().ok).toBe(true);
  });

  it('calls db.execute with UPDATE query', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/security/findings/finding-001/acknowledge',
      payload: {
        acknowledgedBy: 'user-1',
      },
    });

    // First call: SELECT to check existence
    // Second call: UPDATE
    expect(mockDb.execute).toHaveBeenCalledTimes(2);
  });

  it('accepts acknowledge without optional reason', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings/finding-001/acknowledge',
      payload: {
        acknowledgedBy: 'user-1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().ok).toBe(true);
  });

  it('returns 400 when acknowledgedBy is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings/finding-001/acknowledge',
      payload: {
        reason: 'False positive',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_ACKNOWLEDGED_BY');
  });

  it('returns 400 when acknowledgedBy is empty', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings/finding-001/acknowledge',
      payload: {
        acknowledgedBy: '',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_ACKNOWLEDGED_BY');
  });

  it('returns 404 when finding does not exist', async () => {
    mockDb.execute.mockImplementation(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      const normalised = sqlStr.replace(/\s+/g, ' ').trim();

      if (normalised.includes('SELECT id FROM security_findings WHERE id =')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings/nonexistent/acknowledge',
      payload: {
        acknowledgedBy: 'user-1',
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('FINDING_NOT_FOUND');
  });

  it('returns 500 when database query fails', async () => {
    mockDb.execute.mockRejectedValueOnce(new Error('db error'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings/finding-001/acknowledge',
      payload: {
        acknowledgedBy: 'user-1',
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error).toBe('FINDING_ACKNOWLEDGE_FAILED');
  });
});

// =============================================================================
// POST /api/security/findings/github-issues — Create GitHub issues
// =============================================================================

describe('Security findings routes — POST /api/security/findings/github-issues', () => {
  let app: FastifyInstance;
  let mockDb: ReturnType<typeof createMockDb>;
  const originalEnv = process.env.GITHUB_TOKEN;

  beforeAll(async () => {
    mockDb = createMockDb();
    app = await buildApp(mockDb);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_TOKEN = 'ghp_test_token_1234';

    // Restore default mock
    mockDb.execute.mockImplementation(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      const normalised = sqlStr.replace(/\s+/g, ' ').trim();

      if (
        normalised.includes('acknowledged') &&
        normalised.includes('issue_created') &&
        normalised.includes("IN ('critical', 'high')")
      ) {
        return {
          rows: [
            sampleFindingRow({ id: 'finding-crit-1', severity: 'critical' }),
            sampleFindingRow({ id: 'finding-high-1', severity: 'high' }),
          ],
        };
      }
      if (normalised.includes('UPDATE security_findings SET issue_created')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    // Mock global fetch
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ id: 1, html_url: 'https://github.com/test/repo/issues/1' }),
      }),
    );
  });

  afterAll(async () => {
    process.env.GITHUB_TOKEN = originalEnv;
    vi.unstubAllGlobals();
    await app.close();
  });

  it('creates issues for unacknowledged critical/high findings', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings/github-issues',
      payload: {
        owner: 'test-org',
        repo: 'test-repo',
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.issuesCreated).toBe(2);
  });

  it('calls GitHub API for each finding', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/security/findings/github-issues',
      payload: {
        owner: 'test-org',
        repo: 'test-repo',
      },
    });

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Verify API URL
    const firstCallUrl = fetchMock.mock.calls[0][0];
    expect(firstCallUrl).toBe('https://api.github.com/repos/test-org/test-repo/issues');
  });

  it('includes labels in GitHub API call when provided', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/security/findings/github-issues',
      payload: {
        owner: 'test-org',
        repo: 'test-repo',
        labels: ['security', 'urgent'],
      },
    });

    const fetchMock = vi.mocked(fetch);
    const firstCallBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(firstCallBody.labels).toEqual(['security', 'urgent']);
  });

  it('returns issuesCreated=0 when no findings qualify', async () => {
    mockDb.execute.mockImplementation(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      const normalised = sqlStr.replace(/\s+/g, ' ').trim();

      if (normalised.includes("IN ('critical', 'high')")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings/github-issues',
      payload: {
        owner: 'test-org',
        repo: 'test-repo',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().issuesCreated).toBe(0);
  });

  it('does not count issues when GitHub API returns error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ message: 'Validation failed' }),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings/github-issues',
      payload: {
        owner: 'test-org',
        repo: 'test-repo',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().issuesCreated).toBe(0);
  });

  it('returns 400 when owner is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings/github-issues',
      payload: {
        repo: 'test-repo',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_OWNER');
  });

  it('returns 400 when owner is empty', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings/github-issues',
      payload: {
        owner: '',
        repo: 'test-repo',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_OWNER');
  });

  it('returns 400 when repo is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings/github-issues',
      payload: {
        owner: 'test-org',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_REPO');
  });

  it('returns 400 when repo is empty', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings/github-issues',
      payload: {
        owner: 'test-org',
        repo: '',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_REPO');
  });

  it('returns 400 when labels is not an array', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings/github-issues',
      payload: {
        owner: 'test-org',
        repo: 'test-repo',
        labels: 'not-an-array',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_LABELS');
  });

  it('returns 500 when GITHUB_TOKEN is not set', async () => {
    delete process.env.GITHUB_TOKEN;

    // Need to provide rows so it doesn't short-circuit with issuesCreated=0
    mockDb.execute.mockImplementation(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      const normalised = sqlStr.replace(/\s+/g, ' ').trim();

      if (normalised.includes("IN ('critical', 'high')")) {
        return {
          rows: [sampleFindingRow({ id: 'finding-crit-1', severity: 'critical' })],
        };
      }
      return { rows: [] };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings/github-issues',
      payload: {
        owner: 'test-org',
        repo: 'test-repo',
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error).toBe('GITHUB_TOKEN_MISSING');
  });

  it('returns 500 when database query fails', async () => {
    mockDb.execute.mockRejectedValueOnce(new Error('db error'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings/github-issues',
      payload: {
        owner: 'test-org',
        repo: 'test-repo',
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error).toBe('GITHUB_ISSUES_FAILED');
  });

  it('marks findings as issueCreated after successful GitHub API call', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/security/findings/github-issues',
      payload: {
        owner: 'test-org',
        repo: 'test-repo',
      },
    });

    // Should have: 1 SELECT + 2 fetches + 2 UPDATE issue_created = 5 db calls
    // (The SELECT for unacknowledged + UPDATE for each finding)
    const updateCalls = mockDb.execute.mock.calls.filter((call) => {
      const { sql: sqlStr } = extractQuery(call[0]);
      return sqlStr.includes('issue_created');
    });

    // At least 1 SELECT that has issue_created, plus 2 UPDATEs
    expect(updateCalls.length).toBeGreaterThanOrEqual(2);
  });
});

// =============================================================================
// Nonexistent endpoints
// =============================================================================

describe('Security findings routes — nonexistent endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const mockDb = createMockDb();
    app = await buildApp(mockDb);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 404 for unknown sub-path', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/security/nonexistent',
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 404 for POST to summary (wrong method)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/findings/summary',
      payload: {},
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 404 for DELETE on findings (not implemented)', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/security/findings/some-id',
    });

    expect(response.statusCode).toBe(404);
  });
});
