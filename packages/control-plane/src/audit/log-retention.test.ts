import { ControlPlaneError } from '@agentctl/shared';
import { describe, expect, it, vi } from 'vitest';

import type {
  CleanupResult,
  LogRetentionConfig,
  RetentionSummary,
  StorageEstimate,
} from './log-retention.js';
import { createLogRetentionManager } from './log-retention.js';

// ---------------------------------------------------------------------------
// Drizzle SQL mock helpers
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
// Mock DB factory
// ---------------------------------------------------------------------------

type ExecuteHandler = (query: unknown) => Promise<{ rows: unknown[]; rowCount?: number }>;

function createMockDb(handler?: ExecuteHandler) {
  const defaultHandler: ExecuteHandler = async (query: unknown) => {
    const { sql: sqlStr } = extractQuery(query);
    if (sqlStr.includes('COUNT')) {
      return { rows: [{ count: 0 }] };
    }
    if (sqlStr.includes('MIN')) {
      return { rows: [{ oldest: null }] };
    }
    if (sqlStr.includes('DELETE')) {
      return { rows: [], rowCount: 0 };
    }
    if (sqlStr.includes('pg_class')) {
      return { rows: [] };
    }
    return { rows: [] };
  };

  return {
    execute: vi.fn(handler ?? defaultHandler),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultConfig(overrides: Partial<LogRetentionConfig> = {}): Partial<LogRetentionConfig> {
  return {
    auditRetentionDays: 90,
    runRetentionDays: 30,
    deliveryRetentionDays: 14,
    checkpointRetentionDays: 7,
    maxStorageMb: 1000,
    dryRun: false,
    batchSize: 1000,
    ...overrides,
  };
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

// =============================================================================
// Config validation
// =============================================================================

describe('createLogRetentionManager — config validation', () => {
  it('applies default values when config is empty', () => {
    const mockDb = createMockDb();
    // Should not throw
    const manager = createLogRetentionManager({}, mockDb as never);
    expect(manager).toBeDefined();
    expect(manager.calculateRetention).toBeTypeOf('function');
    expect(manager.cleanupAuditActions).toBeTypeOf('function');
    expect(manager.cleanupAgentRuns).toBeTypeOf('function');
    expect(manager.cleanupWebhookDeliveries).toBeTypeOf('function');
    expect(manager.cleanupCheckpoints).toBeTypeOf('function');
    expect(manager.runFullCleanup).toBeTypeOf('function');
    expect(manager.estimateStorageUsage).toBeTypeOf('function');
  });

  it('throws ControlPlaneError for negative auditRetentionDays', () => {
    const mockDb = createMockDb();
    expect(() => createLogRetentionManager({ auditRetentionDays: -1 }, mockDb as never)).toThrow(
      ControlPlaneError,
    );
  });

  it('includes error code INVALID_RETENTION_CONFIG for negative auditRetentionDays', () => {
    const mockDb = createMockDb();
    try {
      createLogRetentionManager({ auditRetentionDays: -1 }, mockDb as never);
      expect.fail('Expected ControlPlaneError');
    } catch (err) {
      expect((err as ControlPlaneError).code).toBe('INVALID_RETENTION_CONFIG');
    }
  });

  it('throws ControlPlaneError for negative runRetentionDays', () => {
    const mockDb = createMockDb();
    expect(() => createLogRetentionManager({ runRetentionDays: -5 }, mockDb as never)).toThrow(
      ControlPlaneError,
    );
  });

  it('throws ControlPlaneError for negative deliveryRetentionDays', () => {
    const mockDb = createMockDb();
    expect(() => createLogRetentionManager({ deliveryRetentionDays: -1 }, mockDb as never)).toThrow(
      ControlPlaneError,
    );
  });

  it('throws ControlPlaneError for negative checkpointRetentionDays', () => {
    const mockDb = createMockDb();
    expect(() =>
      createLogRetentionManager({ checkpointRetentionDays: -10 }, mockDb as never),
    ).toThrow(ControlPlaneError);
  });

  it('throws ControlPlaneError for zero maxStorageMb', () => {
    const mockDb = createMockDb();
    expect(() => createLogRetentionManager({ maxStorageMb: 0 }, mockDb as never)).toThrow(
      ControlPlaneError,
    );
  });

  it('throws ControlPlaneError for negative maxStorageMb', () => {
    const mockDb = createMockDb();
    expect(() => createLogRetentionManager({ maxStorageMb: -100 }, mockDb as never)).toThrow(
      ControlPlaneError,
    );
  });

  it('throws ControlPlaneError for zero batchSize', () => {
    const mockDb = createMockDb();
    expect(() => createLogRetentionManager({ batchSize: 0 }, mockDb as never)).toThrow(
      ControlPlaneError,
    );
  });

  it('throws ControlPlaneError for negative batchSize', () => {
    const mockDb = createMockDb();
    expect(() => createLogRetentionManager({ batchSize: -1 }, mockDb as never)).toThrow(
      ControlPlaneError,
    );
  });

  it('accepts zero retention days (immediate cleanup)', () => {
    const mockDb = createMockDb();
    const manager = createLogRetentionManager(
      { auditRetentionDays: 0, runRetentionDays: 0 },
      mockDb as never,
    );
    expect(manager).toBeDefined();
  });

  it('accepts a valid complete config', () => {
    const mockDb = createMockDb();
    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    expect(manager).toBeDefined();
  });
});

// =============================================================================
// calculateRetention
// =============================================================================

describe('calculateRetention', () => {
  it('returns counts and oldest dates for all tables', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);

      if (sqlStr.includes('agent_actions') && sqlStr.includes('COUNT') && !sqlStr.includes('<')) {
        return { rows: [{ count: 500 }] };
      }
      if (sqlStr.includes('agent_actions') && sqlStr.includes('COUNT') && sqlStr.includes('<')) {
        return { rows: [{ count: 200 }] };
      }
      if (sqlStr.includes('agent_actions') && sqlStr.includes('MIN')) {
        return { rows: [{ oldest: '2025-01-01T00:00:00Z' }] };
      }

      if (sqlStr.includes('agent_runs') && sqlStr.includes('COUNT') && !sqlStr.includes('<')) {
        return { rows: [{ count: 100 }] };
      }
      if (sqlStr.includes('agent_runs') && sqlStr.includes('COUNT') && sqlStr.includes('<')) {
        return { rows: [{ count: 30 }] };
      }
      if (sqlStr.includes('agent_runs') && sqlStr.includes('MIN')) {
        return { rows: [{ oldest: '2025-02-01T00:00:00Z' }] };
      }

      if (
        sqlStr.includes('webhook_deliveries') &&
        sqlStr.includes('COUNT') &&
        !sqlStr.includes('<')
      ) {
        return { rows: [{ count: 1000 }] };
      }
      if (
        sqlStr.includes('webhook_deliveries') &&
        sqlStr.includes('COUNT') &&
        sqlStr.includes('<')
      ) {
        return { rows: [{ count: 800 }] };
      }
      if (sqlStr.includes('webhook_deliveries') && sqlStr.includes('MIN')) {
        return { rows: [{ oldest: '2025-03-01T00:00:00Z' }] };
      }

      if (
        sqlStr.includes('loop_checkpoints') &&
        sqlStr.includes('COUNT') &&
        !sqlStr.includes('<')
      ) {
        return { rows: [{ count: 50 }] };
      }
      if (sqlStr.includes('loop_checkpoints') && sqlStr.includes('COUNT') && sqlStr.includes('<')) {
        return { rows: [{ count: 40 }] };
      }
      if (sqlStr.includes('loop_checkpoints') && sqlStr.includes('MIN')) {
        return { rows: [{ oldest: '2025-04-01T00:00:00Z' }] };
      }

      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    const summary = await manager.calculateRetention();

    expect(summary.auditActions.total).toBe(500);
    expect(summary.auditActions.toDelete).toBe(200);
    expect(summary.auditActions.oldestDate).toEqual(new Date('2025-01-01T00:00:00Z'));

    expect(summary.agentRuns.total).toBe(100);
    expect(summary.agentRuns.toDelete).toBe(30);
    expect(summary.agentRuns.oldestDate).toEqual(new Date('2025-02-01T00:00:00Z'));

    expect(summary.webhookDeliveries.total).toBe(1000);
    expect(summary.webhookDeliveries.toDelete).toBe(800);
    expect(summary.webhookDeliveries.oldestDate).toEqual(new Date('2025-03-01T00:00:00Z'));

    expect(summary.checkpoints.total).toBe(50);
    expect(summary.checkpoints.toDelete).toBe(40);
    expect(summary.checkpoints.oldestDate).toEqual(new Date('2025-04-01T00:00:00Z'));
  });

  it('returns zero counts for empty tables', async () => {
    const mockDb = createMockDb();
    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    const summary = await manager.calculateRetention();

    expect(summary.auditActions.total).toBe(0);
    expect(summary.auditActions.toDelete).toBe(0);
    expect(summary.auditActions.oldestDate).toBeNull();
    expect(summary.agentRuns.total).toBe(0);
    expect(summary.agentRuns.toDelete).toBe(0);
    expect(summary.agentRuns.oldestDate).toBeNull();
  });

  it('handles null oldest date when table is empty', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('COUNT')) {
        return { rows: [{ count: 0 }] };
      }
      if (sqlStr.includes('MIN')) {
        return { rows: [{ oldest: null }] };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    const summary = await manager.calculateRetention();

    expect(summary.auditActions.oldestDate).toBeNull();
    expect(summary.agentRuns.oldestDate).toBeNull();
    expect(summary.webhookDeliveries.oldestDate).toBeNull();
    expect(summary.checkpoints.oldestDate).toBeNull();
  });

  it('returns zero toDelete when all records are within retention', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('COUNT') && !sqlStr.includes('<')) {
        return { rows: [{ count: 100 }] };
      }
      if (sqlStr.includes('COUNT') && sqlStr.includes('<')) {
        return { rows: [{ count: 0 }] };
      }
      if (sqlStr.includes('MIN')) {
        return { rows: [{ oldest: new Date().toISOString() }] };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    const summary = await manager.calculateRetention();

    expect(summary.auditActions.toDelete).toBe(0);
    expect(summary.agentRuns.toDelete).toBe(0);
    expect(summary.webhookDeliveries.toDelete).toBe(0);
    expect(summary.checkpoints.toDelete).toBe(0);
  });

  it('throws ControlPlaneError when database query fails', async () => {
    const mockDb = createMockDb(async () => {
      throw new Error('connection refused');
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);

    await expect(manager.calculateRetention()).rejects.toThrow(ControlPlaneError);
    await expect(manager.calculateRetention()).rejects.toThrow(
      'Failed to calculate retention summary',
    );
  });

  it('includes the RETENTION_CALCULATION_FAILED error code on DB failure', async () => {
    const mockDb = createMockDb(async () => {
      throw new Error('connection refused');
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);

    try {
      await manager.calculateRetention();
      expect.fail('Expected ControlPlaneError');
    } catch (err) {
      expect((err as ControlPlaneError).code).toBe('RETENTION_CALCULATION_FAILED');
    }
  });

  it('makes exactly 12 database queries (3 per table x 4 tables)', async () => {
    const mockDb = createMockDb();
    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);

    await manager.calculateRetention();

    expect(mockDb.execute).toHaveBeenCalledTimes(12);
  });
});

// =============================================================================
// cleanupAuditActions
// =============================================================================

describe('cleanupAuditActions', () => {
  it('deletes old audit actions in batches and returns total count', async () => {
    let callIndex = 0;
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('INSERT')) {
        return { rows: [], rowCount: 1 };
      }
      if (sqlStr.includes('DELETE')) {
        callIndex++;
        // First batch: full batch; second batch: partial (less than batchSize)
        if (callIndex === 1) {
          return { rows: [], rowCount: 100 };
        }
        return { rows: [], rowCount: 50 };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig({ batchSize: 100 }), mockDb as never);
    const result = await manager.cleanupAuditActions(daysAgo(90));

    expect(result.deleted).toBe(150);
  });

  it('inserts a gap marker before deleting audit actions', async () => {
    const queries: string[] = [];
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      queries.push(sqlStr);
      if (sqlStr.includes('DELETE')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    await manager.cleanupAuditActions(daysAgo(90));

    // The INSERT (gap marker) must come before the DELETE
    const insertIdx = queries.findIndex((q) => q.includes('INSERT') && q.includes('retention_gap'));
    const deleteIdx = queries.findIndex((q) => q.includes('DELETE'));

    expect(insertIdx).toBeGreaterThan(-1);
    if (deleteIdx > -1) {
      expect(insertIdx).toBeLessThan(deleteIdx);
    }
  });

  it('gap marker includes deletedBefore and reason in tool_input', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr, params } = extractQuery(query);
      if (sqlStr.includes('INSERT') && sqlStr.includes('retention_gap')) {
        const jsonParam = params.find((p) => typeof p === 'string' && p.includes('deletedBefore'));
        expect(jsonParam).toBeDefined();
        const parsed = JSON.parse(jsonParam as string);
        expect(parsed.reason).toBe('log-retention-cleanup');
        expect(parsed.deletedBefore).toBeDefined();
      }
      if (sqlStr.includes('DELETE')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    await manager.cleanupAuditActions(daysAgo(90));
  });

  it('returns count without deleting in dryRun mode', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('COUNT')) {
        return { rows: [{ count: 42 }] };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig({ dryRun: true }), mockDb as never);
    const result = await manager.cleanupAuditActions(daysAgo(90));

    expect(result.deleted).toBe(42);
    // Should only have the COUNT query, no INSERT or DELETE
    for (const call of mockDb.execute.mock.calls) {
      const { sql: sqlStr } = extractQuery(call[0]);
      expect(sqlStr).not.toContain('DELETE');
      expect(sqlStr).not.toContain('INSERT');
    }
  });

  it('does not insert gap marker in dryRun mode', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('COUNT')) {
        return { rows: [{ count: 10 }] };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig({ dryRun: true }), mockDb as never);
    await manager.cleanupAuditActions(daysAgo(90));

    for (const call of mockDb.execute.mock.calls) {
      const { sql: sqlStr } = extractQuery(call[0]);
      expect(sqlStr).not.toContain('retention_gap');
    }
  });

  it('handles zero records to delete', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('DELETE')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    const result = await manager.cleanupAuditActions(daysAgo(90));

    expect(result.deleted).toBe(0);
  });

  it('throws ControlPlaneError on database failure', async () => {
    const mockDb = createMockDb(async () => {
      throw new Error('disk full');
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);

    await expect(manager.cleanupAuditActions(daysAgo(90))).rejects.toThrow(ControlPlaneError);
  });

  it('includes AUDIT_CLEANUP_FAILED error code', async () => {
    const mockDb = createMockDb(async () => {
      throw new Error('disk full');
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);

    try {
      await manager.cleanupAuditActions(daysAgo(90));
      expect.fail('Expected ControlPlaneError');
    } catch (err) {
      expect((err as ControlPlaneError).code).toBe('AUDIT_CLEANUP_FAILED');
    }
  });

  it('respects batchSize in DELETE queries', async () => {
    const deleteParams: unknown[][] = [];
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr, params } = extractQuery(query);
      if (sqlStr.includes('DELETE')) {
        deleteParams.push(params);
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });

    const manager = createLogRetentionManager(defaultConfig({ batchSize: 500 }), mockDb as never);
    await manager.cleanupAuditActions(daysAgo(90));

    // The LIMIT parameter in the DELETE should be 500
    const lastParam = deleteParams[0]?.[deleteParams[0].length - 1];
    expect(lastParam).toBe(500);
  });

  it('loops batches until fewer than batchSize rows are deleted', async () => {
    let deleteCallCount = 0;
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('DELETE')) {
        deleteCallCount++;
        // 3 full batches of 100, then a partial batch of 50
        if (deleteCallCount <= 3) {
          return { rows: [], rowCount: 100 };
        }
        return { rows: [], rowCount: 50 };
      }
      return { rows: [], rowCount: 1 };
    });

    const manager = createLogRetentionManager(defaultConfig({ batchSize: 100 }), mockDb as never);
    const result = await manager.cleanupAuditActions(daysAgo(90));

    expect(result.deleted).toBe(350); // 3 * 100 + 50
    expect(deleteCallCount).toBe(4);
  });
});

// =============================================================================
// cleanupAgentRuns
// =============================================================================

describe('cleanupAgentRuns', () => {
  it('deletes old completed runs and returns count', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('DELETE')) {
        return { rows: [], rowCount: 25 };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    const result = await manager.cleanupAgentRuns(daysAgo(30));

    expect(result.deleted).toBe(25);
  });

  it('never deletes runs with running status', async () => {
    const queries: string[] = [];
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      queries.push(sqlStr);
      if (sqlStr.includes('DELETE')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [{ count: 0 }] };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    await manager.cleanupAgentRuns(daysAgo(30));

    const deleteQuery = queries.find((q) => q.includes('DELETE'));
    expect(deleteQuery).toBeDefined();
    expect(deleteQuery).toContain("NOT IN ('running', 'paused')");
  });

  it('never deletes runs with paused status', async () => {
    const queries: string[] = [];
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      queries.push(sqlStr);
      if (sqlStr.includes('DELETE')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [{ count: 0 }] };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    await manager.cleanupAgentRuns(daysAgo(30));

    const deleteQuery = queries.find((q) => q.includes('DELETE'));
    expect(deleteQuery).toContain('paused');
  });

  it('returns count without deleting in dryRun mode', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('COUNT')) {
        return { rows: [{ count: 15 }] };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig({ dryRun: true }), mockDb as never);
    const result = await manager.cleanupAgentRuns(daysAgo(30));

    expect(result.deleted).toBe(15);
  });

  it('dryRun query excludes running and paused statuses', async () => {
    const queries: string[] = [];
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      queries.push(sqlStr);
      if (sqlStr.includes('COUNT')) {
        return { rows: [{ count: 0 }] };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig({ dryRun: true }), mockDb as never);
    await manager.cleanupAgentRuns(daysAgo(30));

    const countQuery = queries.find((q) => q.includes('COUNT'));
    expect(countQuery).toContain("NOT IN ('running', 'paused')");
  });

  it('handles zero records to delete', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('DELETE')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    const result = await manager.cleanupAgentRuns(daysAgo(30));

    expect(result.deleted).toBe(0);
  });

  it('throws ControlPlaneError on database failure', async () => {
    const mockDb = createMockDb(async () => {
      throw new Error('table does not exist');
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);

    await expect(manager.cleanupAgentRuns(daysAgo(30))).rejects.toThrow(ControlPlaneError);
  });

  it('includes RUN_CLEANUP_FAILED error code', async () => {
    const mockDb = createMockDb(async () => {
      throw new Error('table does not exist');
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);

    try {
      await manager.cleanupAgentRuns(daysAgo(30));
      expect.fail('Expected ControlPlaneError');
    } catch (err) {
      expect((err as ControlPlaneError).code).toBe('RUN_CLEANUP_FAILED');
    }
  });
});

// =============================================================================
// cleanupWebhookDeliveries
// =============================================================================

describe('cleanupWebhookDeliveries', () => {
  it('deletes old webhook deliveries and returns count', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('DELETE')) {
        return { rows: [], rowCount: 60 };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    const result = await manager.cleanupWebhookDeliveries(daysAgo(14));

    expect(result.deleted).toBe(60);
  });

  it('returns count without deleting in dryRun mode', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('COUNT')) {
        return { rows: [{ count: 99 }] };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig({ dryRun: true }), mockDb as never);
    const result = await manager.cleanupWebhookDeliveries(daysAgo(14));

    expect(result.deleted).toBe(99);
  });

  it('handles zero records to delete', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('DELETE')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    const result = await manager.cleanupWebhookDeliveries(daysAgo(14));

    expect(result.deleted).toBe(0);
  });

  it('queries the webhook_deliveries table', async () => {
    const queries: string[] = [];
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      queries.push(sqlStr);
      if (sqlStr.includes('DELETE')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    await manager.cleanupWebhookDeliveries(daysAgo(14));

    const deleteQuery = queries.find((q) => q.includes('DELETE'));
    expect(deleteQuery).toContain('webhook_deliveries');
  });

  it('throws ControlPlaneError on database failure', async () => {
    const mockDb = createMockDb(async () => {
      throw new Error('permission denied');
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);

    await expect(manager.cleanupWebhookDeliveries(daysAgo(14))).rejects.toThrow(ControlPlaneError);
  });

  it('includes DELIVERY_CLEANUP_FAILED error code', async () => {
    const mockDb = createMockDb(async () => {
      throw new Error('permission denied');
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);

    try {
      await manager.cleanupWebhookDeliveries(daysAgo(14));
      expect.fail('Expected ControlPlaneError');
    } catch (err) {
      expect((err as ControlPlaneError).code).toBe('DELIVERY_CLEANUP_FAILED');
    }
  });
});

// =============================================================================
// cleanupCheckpoints
// =============================================================================

describe('cleanupCheckpoints', () => {
  it('deletes old checkpoints and returns count', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('DELETE')) {
        return { rows: [], rowCount: 12 };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    const result = await manager.cleanupCheckpoints(daysAgo(7));

    expect(result.deleted).toBe(12);
  });

  it('returns count without deleting in dryRun mode', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('COUNT')) {
        return { rows: [{ count: 7 }] };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig({ dryRun: true }), mockDb as never);
    const result = await manager.cleanupCheckpoints(daysAgo(7));

    expect(result.deleted).toBe(7);
  });

  it('handles zero records to delete', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('DELETE')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    const result = await manager.cleanupCheckpoints(daysAgo(7));

    expect(result.deleted).toBe(0);
  });

  it('queries the loop_checkpoints table', async () => {
    const queries: string[] = [];
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      queries.push(sqlStr);
      if (sqlStr.includes('DELETE')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    await manager.cleanupCheckpoints(daysAgo(7));

    const deleteQuery = queries.find((q) => q.includes('DELETE'));
    expect(deleteQuery).toContain('loop_checkpoints');
  });

  it('throws ControlPlaneError on database failure', async () => {
    const mockDb = createMockDb(async () => {
      throw new Error('deadlock detected');
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);

    await expect(manager.cleanupCheckpoints(daysAgo(7))).rejects.toThrow(ControlPlaneError);
  });

  it('includes CHECKPOINT_CLEANUP_FAILED error code', async () => {
    const mockDb = createMockDb(async () => {
      throw new Error('deadlock detected');
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);

    try {
      await manager.cleanupCheckpoints(daysAgo(7));
      expect.fail('Expected ControlPlaneError');
    } catch (err) {
      expect((err as ControlPlaneError).code).toBe('CHECKPOINT_CLEANUP_FAILED');
    }
  });
});

// =============================================================================
// runFullCleanup
// =============================================================================

describe('runFullCleanup', () => {
  it('runs all four cleanups and returns combined results', async () => {
    let deleteCallCount = 0;
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('INSERT')) {
        return { rows: [], rowCount: 1 };
      }
      if (sqlStr.includes('DELETE')) {
        deleteCallCount++;
        // Return different counts for different tables
        if (deleteCallCount === 1) return { rows: [], rowCount: 10 }; // audit
        if (deleteCallCount === 2) return { rows: [], rowCount: 5 }; // runs
        if (deleteCallCount === 3) return { rows: [], rowCount: 20 }; // deliveries
        if (deleteCallCount === 4) return { rows: [], rowCount: 3 }; // checkpoints
        return { rows: [], rowCount: 0 };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    const result = await manager.runFullCleanup();

    expect(result.auditActionsDeleted).toBe(10);
    expect(result.agentRunsDeleted).toBe(5);
    expect(result.webhookDeliveriesDeleted).toBe(20);
    expect(result.checkpointsDeleted).toBe(3);
    expect(result.dryRun).toBe(false);
    expect(result.executedAt).toBeInstanceOf(Date);
  });

  it('reports dryRun=true in results when dryRun is enabled', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('COUNT')) {
        return { rows: [{ count: 10 }] };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig({ dryRun: true }), mockDb as never);
    const result = await manager.runFullCleanup();

    expect(result.dryRun).toBe(true);
    expect(result.auditActionsDeleted).toBe(10);
    expect(result.agentRunsDeleted).toBe(10);
    expect(result.webhookDeliveriesDeleted).toBe(10);
    expect(result.checkpointsDeleted).toBe(10);
  });

  it('returns zero for all counts when tables are empty', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('DELETE')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    const result = await manager.runFullCleanup();

    expect(result.auditActionsDeleted).toBe(0);
    expect(result.agentRunsDeleted).toBe(0);
    expect(result.webhookDeliveriesDeleted).toBe(0);
    expect(result.checkpointsDeleted).toBe(0);
  });

  it('sets executedAt to a recent timestamp', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('DELETE')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });

    const before = new Date();
    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    const result = await manager.runFullCleanup();
    const after = new Date();

    expect(result.executedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(result.executedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('propagates error from first failing cleanup', async () => {
    const mockDb = createMockDb(async () => {
      throw new Error('network timeout');
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);

    await expect(manager.runFullCleanup()).rejects.toThrow(ControlPlaneError);
  });
});

// =============================================================================
// estimateStorageUsage
// =============================================================================

describe('estimateStorageUsage', () => {
  it('returns storage sizes in MB for all tables', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('pg_class')) {
        return {
          rows: [
            { table_name: 'agent_actions', size_bytes: 104857600 }, // 100 MB
            { table_name: 'agent_runs', size_bytes: 52428800 }, // 50 MB
            { table_name: 'webhook_deliveries', size_bytes: 20971520 }, // 20 MB
            { table_name: 'loop_checkpoints', size_bytes: 5242880 }, // 5 MB
          ],
        };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    const estimate = await manager.estimateStorageUsage();

    expect(estimate.auditActionsMb).toBe(100);
    expect(estimate.agentRunsMb).toBe(50);
    expect(estimate.webhookDeliveriesMb).toBe(20);
    expect(estimate.checkpointsMb).toBe(5);
    expect(estimate.totalMb).toBe(175);
  });

  it('returns zero for missing tables', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('pg_class')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    const estimate = await manager.estimateStorageUsage();

    expect(estimate.auditActionsMb).toBe(0);
    expect(estimate.agentRunsMb).toBe(0);
    expect(estimate.webhookDeliveriesMb).toBe(0);
    expect(estimate.checkpointsMb).toBe(0);
    expect(estimate.totalMb).toBe(0);
  });

  it('correctly calculates totalMb as sum of all table sizes', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('pg_class')) {
        return {
          rows: [
            { table_name: 'agent_actions', size_bytes: 1048576 }, // 1 MB
            { table_name: 'agent_runs', size_bytes: 2097152 }, // 2 MB
          ],
        };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    const estimate = await manager.estimateStorageUsage();

    expect(estimate.totalMb).toBe(3);
  });

  it('handles partial table results (some tables missing from pg_class)', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('pg_class')) {
        return {
          rows: [{ table_name: 'agent_actions', size_bytes: 10485760 }], // 10 MB
        };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    const estimate = await manager.estimateStorageUsage();

    expect(estimate.auditActionsMb).toBe(10);
    expect(estimate.agentRunsMb).toBe(0);
    expect(estimate.webhookDeliveriesMb).toBe(0);
    expect(estimate.checkpointsMb).toBe(0);
    expect(estimate.totalMb).toBe(10);
  });

  it('throws ControlPlaneError on database failure', async () => {
    const mockDb = createMockDb(async () => {
      throw new Error('insufficient privileges');
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);

    await expect(manager.estimateStorageUsage()).rejects.toThrow(ControlPlaneError);
  });

  it('includes STORAGE_ESTIMATE_FAILED error code', async () => {
    const mockDb = createMockDb(async () => {
      throw new Error('insufficient privileges');
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);

    try {
      await manager.estimateStorageUsage();
      expect.fail('Expected ControlPlaneError');
    } catch (err) {
      expect((err as ControlPlaneError).code).toBe('STORAGE_ESTIMATE_FAILED');
    }
  });

  it('handles string size_bytes values (bigint returned as string)', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('pg_class')) {
        return {
          rows: [{ table_name: 'agent_actions', size_bytes: '1073741824' }], // 1 GB as string
        };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    const estimate = await manager.estimateStorageUsage();

    expect(estimate.auditActionsMb).toBe(1024);
  });
});

// =============================================================================
// Batch processing
// =============================================================================

describe('batch processing', () => {
  it('uses the configured batchSize in DELETE LIMIT clauses', async () => {
    const deleteParams: unknown[][] = [];
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr, params } = extractQuery(query);
      if (sqlStr.includes('DELETE')) {
        deleteParams.push(params);
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });

    const manager = createLogRetentionManager(defaultConfig({ batchSize: 250 }), mockDb as never);
    await manager.cleanupAuditActions(daysAgo(90));

    expect(deleteParams.length).toBeGreaterThan(0);
    // Last param should be the batch size limit
    const limitParam = deleteParams[0][deleteParams[0].length - 1];
    expect(limitParam).toBe(250);
  });

  it('small batchSize of 1 still works correctly', async () => {
    let deleteCallCount = 0;
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('INSERT')) {
        return { rows: [], rowCount: 1 };
      }
      if (sqlStr.includes('DELETE')) {
        deleteCallCount++;
        // 3 rows to delete, one per batch
        if (deleteCallCount <= 3) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig({ batchSize: 1 }), mockDb as never);
    const result = await manager.cleanupAuditActions(daysAgo(90));

    expect(result.deleted).toBe(3);
    expect(deleteCallCount).toBe(4); // 3 deletes + 1 final empty
  });

  it('large batchSize processes everything in one batch when fewer rows exist', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('INSERT')) {
        return { rows: [], rowCount: 1 };
      }
      if (sqlStr.includes('DELETE')) {
        return { rows: [], rowCount: 50 }; // Less than batchSize of 10000
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig({ batchSize: 10000 }), mockDb as never);
    const result = await manager.cleanupAuditActions(daysAgo(90));

    expect(result.deleted).toBe(50);
  });
});

// =============================================================================
// Edge cases
// =============================================================================

describe('edge cases', () => {
  it('handles date at exact boundary (today minus retention days)', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('COUNT')) {
        return { rows: [{ count: 1 }] };
      }
      if (sqlStr.includes('MIN')) {
        return { rows: [{ oldest: new Date().toISOString() }] };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(
      defaultConfig({ auditRetentionDays: 0 }),
      mockDb as never,
    );
    const summary = await manager.calculateRetention();

    // With 0 retention days, everything should potentially be marked for deletion
    expect(summary.auditActions.total).toBe(1);
  });

  it('handles very large retention days (365)', async () => {
    const mockDb = createMockDb();
    const manager = createLogRetentionManager(
      defaultConfig({ auditRetentionDays: 365 }),
      mockDb as never,
    );

    // Should not throw
    const summary = await manager.calculateRetention();
    expect(summary).toBeDefined();
  });

  it('dryRun=true does not issue any INSERT or DELETE queries for any cleanup method', async () => {
    const queries: string[] = [];
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      queries.push(sqlStr);
      if (sqlStr.includes('COUNT')) {
        return { rows: [{ count: 5 }] };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig({ dryRun: true }), mockDb as never);

    await manager.cleanupAuditActions(daysAgo(90));
    await manager.cleanupAgentRuns(daysAgo(30));
    await manager.cleanupWebhookDeliveries(daysAgo(14));
    await manager.cleanupCheckpoints(daysAgo(7));

    for (const q of queries) {
      expect(q).not.toContain('DELETE');
      expect(q).not.toContain('INSERT');
    }
  });

  it('partial DB failure in full cleanup propagates the first error', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      // Let the gap marker INSERT succeed, then fail on DELETE
      if (sqlStr.includes('INSERT')) {
        return { rows: [], rowCount: 1 };
      }
      if (sqlStr.includes('DELETE')) {
        throw new Error('partial failure');
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);

    await expect(manager.runFullCleanup()).rejects.toThrow(ControlPlaneError);
  });

  it('returns type-safe RetentionSummary structure', async () => {
    const mockDb = createMockDb();
    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    const summary: RetentionSummary = await manager.calculateRetention();

    expect(summary).toHaveProperty('auditActions');
    expect(summary).toHaveProperty('agentRuns');
    expect(summary).toHaveProperty('webhookDeliveries');
    expect(summary).toHaveProperty('checkpoints');

    expect(summary.auditActions).toHaveProperty('total');
    expect(summary.auditActions).toHaveProperty('toDelete');
    expect(summary.auditActions).toHaveProperty('oldestDate');
  });

  it('returns type-safe CleanupResult structure', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('DELETE')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    const result: CleanupResult = await manager.runFullCleanup();

    expect(result).toHaveProperty('auditActionsDeleted');
    expect(result).toHaveProperty('agentRunsDeleted');
    expect(result).toHaveProperty('webhookDeliveriesDeleted');
    expect(result).toHaveProperty('checkpointsDeleted');
    expect(result).toHaveProperty('dryRun');
    expect(result).toHaveProperty('executedAt');
  });

  it('returns type-safe StorageEstimate structure', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('pg_class')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);
    const estimate: StorageEstimate = await manager.estimateStorageUsage();

    expect(estimate).toHaveProperty('auditActionsMb');
    expect(estimate).toHaveProperty('agentRunsMb');
    expect(estimate).toHaveProperty('webhookDeliveriesMb');
    expect(estimate).toHaveProperty('checkpointsMb');
    expect(estimate).toHaveProperty('totalMb');
  });

  it('each cleanup method can be called independently', async () => {
    const mockDb = createMockDb(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      if (sqlStr.includes('DELETE')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);

    const r1 = await manager.cleanupAgentRuns(daysAgo(30));
    expect(r1.deleted).toBe(1);

    const r2 = await manager.cleanupWebhookDeliveries(daysAgo(14));
    expect(r2.deleted).toBe(1);
  });
});

// =============================================================================
// Error handling
// =============================================================================

describe('error handling', () => {
  it('wraps non-ControlPlaneError in ControlPlaneError for calculateRetention', async () => {
    const mockDb = createMockDb(async () => {
      throw new TypeError('Cannot read properties of undefined');
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);

    try {
      await manager.calculateRetention();
      expect.fail('Expected error');
    } catch (err) {
      expect(err).toBeInstanceOf(ControlPlaneError);
      expect((err as ControlPlaneError).message).toContain('Cannot read properties of undefined');
    }
  });

  it('wraps non-ControlPlaneError in ControlPlaneError for cleanupAuditActions', async () => {
    const mockDb = createMockDb(async () => {
      throw new RangeError('out of bounds');
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);

    try {
      await manager.cleanupAuditActions(daysAgo(90));
      expect.fail('Expected error');
    } catch (err) {
      expect(err).toBeInstanceOf(ControlPlaneError);
      expect((err as ControlPlaneError).message).toContain('out of bounds');
    }
  });

  it('wraps non-ControlPlaneError in ControlPlaneError for estimateStorageUsage', async () => {
    const mockDb = createMockDb(async () => {
      throw new SyntaxError('unexpected token');
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);

    try {
      await manager.estimateStorageUsage();
      expect.fail('Expected error');
    } catch (err) {
      expect(err).toBeInstanceOf(ControlPlaneError);
      expect((err as ControlPlaneError).message).toContain('unexpected token');
    }
  });

  it('preserves original ControlPlaneError when re-thrown from inner functions', async () => {
    const original = new ControlPlaneError('CUSTOM_ERROR', 'custom message', { key: 'val' });
    const mockDb = createMockDb(async () => {
      throw original;
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);

    try {
      await manager.calculateRetention();
      expect.fail('Expected error');
    } catch (err) {
      expect(err).toBe(original);
      expect((err as ControlPlaneError).code).toBe('CUSTOM_ERROR');
    }
  });

  it('handles non-Error thrown objects gracefully', async () => {
    const mockDb = createMockDb(async () => {
      throw 'string error';
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);

    try {
      await manager.cleanupAgentRuns(daysAgo(30));
      expect.fail('Expected error');
    } catch (err) {
      expect(err).toBeInstanceOf(ControlPlaneError);
      expect((err as ControlPlaneError).message).toContain('string error');
    }
  });

  it('includes context in error for cleanupAuditActions', async () => {
    const mockDb = createMockDb(async () => {
      throw new Error('timeout');
    });

    const manager = createLogRetentionManager(defaultConfig(), mockDb as never);

    try {
      await manager.cleanupAuditActions(daysAgo(90));
      expect.fail('Expected error');
    } catch (err) {
      expect((err as ControlPlaneError).context).toHaveProperty('before');
    }
  });
});
