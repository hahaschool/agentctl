import { ControlPlaneError } from '@agentctl/shared';
import { sql } from 'drizzle-orm';

import type { Database } from '../db/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_AUDIT_RETENTION_DAYS = 90;
const DEFAULT_RUN_RETENTION_DAYS = 30;
const DEFAULT_DELIVERY_RETENTION_DAYS = 14;
const DEFAULT_CHECKPOINT_RETENTION_DAYS = 7;
const DEFAULT_MAX_STORAGE_MB = 1000;
const DEFAULT_BATCH_SIZE = 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogRetentionConfig = {
  auditRetentionDays: number;
  runRetentionDays: number;
  deliveryRetentionDays: number;
  checkpointRetentionDays: number;
  maxStorageMb: number;
  dryRun: boolean;
  batchSize: number;
};

export type TableRetentionInfo = {
  total: number;
  toDelete: number;
  oldestDate: Date | null;
};

export type RetentionSummary = {
  auditActions: TableRetentionInfo;
  agentRuns: TableRetentionInfo;
  webhookDeliveries: TableRetentionInfo;
  checkpoints: TableRetentionInfo;
};

export type CleanupResult = {
  auditActionsDeleted: number;
  agentRunsDeleted: number;
  webhookDeliveriesDeleted: number;
  checkpointsDeleted: number;
  dryRun: boolean;
  executedAt: Date;
};

export type StorageEstimate = {
  auditActionsMb: number;
  agentRunsMb: number;
  webhookDeliveriesMb: number;
  checkpointsMb: number;
  totalMb: number;
};

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

function validateConfig(config: Partial<LogRetentionConfig>): LogRetentionConfig {
  const auditRetentionDays = config.auditRetentionDays ?? DEFAULT_AUDIT_RETENTION_DAYS;
  const runRetentionDays = config.runRetentionDays ?? DEFAULT_RUN_RETENTION_DAYS;
  const deliveryRetentionDays = config.deliveryRetentionDays ?? DEFAULT_DELIVERY_RETENTION_DAYS;
  const checkpointRetentionDays =
    config.checkpointRetentionDays ?? DEFAULT_CHECKPOINT_RETENTION_DAYS;
  const maxStorageMb = config.maxStorageMb ?? DEFAULT_MAX_STORAGE_MB;
  const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
  const dryRun = config.dryRun ?? false;

  if (auditRetentionDays < 0) {
    throw new ControlPlaneError(
      'INVALID_RETENTION_CONFIG',
      'auditRetentionDays must be non-negative',
      { auditRetentionDays },
    );
  }

  if (runRetentionDays < 0) {
    throw new ControlPlaneError(
      'INVALID_RETENTION_CONFIG',
      'runRetentionDays must be non-negative',
      { runRetentionDays },
    );
  }

  if (deliveryRetentionDays < 0) {
    throw new ControlPlaneError(
      'INVALID_RETENTION_CONFIG',
      'deliveryRetentionDays must be non-negative',
      { deliveryRetentionDays },
    );
  }

  if (checkpointRetentionDays < 0) {
    throw new ControlPlaneError(
      'INVALID_RETENTION_CONFIG',
      'checkpointRetentionDays must be non-negative',
      { checkpointRetentionDays },
    );
  }

  if (maxStorageMb <= 0) {
    throw new ControlPlaneError('INVALID_RETENTION_CONFIG', 'maxStorageMb must be positive', {
      maxStorageMb,
    });
  }

  if (batchSize <= 0) {
    throw new ControlPlaneError('INVALID_RETENTION_CONFIG', 'batchSize must be positive', {
      batchSize,
    });
  }

  return {
    auditRetentionDays,
    runRetentionDays,
    deliveryRetentionDays,
    checkpointRetentionDays,
    maxStorageMb,
    dryRun,
    batchSize,
  };
}

// ---------------------------------------------------------------------------
// Cutoff date helper
// ---------------------------------------------------------------------------

function cutoffDate(retentionDays: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - retentionDays);
  return d;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createLogRetentionManager(
  configInput: Partial<LogRetentionConfig>,
  db: Database,
): {
  calculateRetention: () => Promise<RetentionSummary>;
  cleanupAuditActions: (before: Date) => Promise<{ deleted: number }>;
  cleanupAgentRuns: (before: Date) => Promise<{ deleted: number }>;
  cleanupWebhookDeliveries: (before: Date) => Promise<{ deleted: number }>;
  cleanupCheckpoints: (before: Date) => Promise<{ deleted: number }>;
  runFullCleanup: () => Promise<CleanupResult>;
  estimateStorageUsage: () => Promise<StorageEstimate>;
} {
  const config = validateConfig(configInput);

  // -----------------------------------------------------------------------
  // calculateRetention
  // -----------------------------------------------------------------------

  async function calculateRetention(): Promise<RetentionSummary> {
    try {
      const auditCutoff = cutoffDate(config.auditRetentionDays);
      const runCutoff = cutoffDate(config.runRetentionDays);
      const deliveryCutoff = cutoffDate(config.deliveryRetentionDays);
      const checkpointCutoff = cutoffDate(config.checkpointRetentionDays);

      // Audit actions
      const auditTotalResult = await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM agent_actions`,
      );
      const auditTotal = (auditTotalResult.rows[0] as { count: number })?.count ?? 0;

      const auditDeleteResult = await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM agent_actions WHERE timestamp < ${auditCutoff}`,
      );
      const auditToDelete = (auditDeleteResult.rows[0] as { count: number })?.count ?? 0;

      const auditOldestResult = await db.execute(
        sql`SELECT MIN(timestamp) AS oldest FROM agent_actions`,
      );
      const auditOldestRaw = (auditOldestResult.rows[0] as { oldest: string | null })?.oldest;
      const auditOldest = auditOldestRaw ? new Date(auditOldestRaw) : null;

      // Agent runs
      const runTotalResult = await db.execute(sql`SELECT COUNT(*)::int AS count FROM agent_runs`);
      const runTotal = (runTotalResult.rows[0] as { count: number })?.count ?? 0;

      const runDeleteResult = await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM agent_runs WHERE started_at < ${runCutoff} AND status NOT IN ('running', 'paused')`,
      );
      const runToDelete = (runDeleteResult.rows[0] as { count: number })?.count ?? 0;

      const runOldestResult = await db.execute(
        sql`SELECT MIN(started_at) AS oldest FROM agent_runs`,
      );
      const runOldestRaw = (runOldestResult.rows[0] as { oldest: string | null })?.oldest;
      const runOldest = runOldestRaw ? new Date(runOldestRaw) : null;

      // Webhook deliveries
      const deliveryTotalResult = await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM webhook_deliveries`,
      );
      const deliveryTotal = (deliveryTotalResult.rows[0] as { count: number })?.count ?? 0;

      const deliveryDeleteResult = await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM webhook_deliveries WHERE delivered_at < ${deliveryCutoff}`,
      );
      const deliveryToDelete = (deliveryDeleteResult.rows[0] as { count: number })?.count ?? 0;

      const deliveryOldestResult = await db.execute(
        sql`SELECT MIN(delivered_at) AS oldest FROM webhook_deliveries`,
      );
      const deliveryOldestRaw = (deliveryOldestResult.rows[0] as { oldest: string | null })?.oldest;
      const deliveryOldest = deliveryOldestRaw ? new Date(deliveryOldestRaw) : null;

      // Checkpoints
      const checkpointTotalResult = await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM loop_checkpoints`,
      );
      const checkpointTotal = (checkpointTotalResult.rows[0] as { count: number })?.count ?? 0;

      const checkpointDeleteResult = await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM loop_checkpoints WHERE created_at < ${checkpointCutoff}`,
      );
      const checkpointToDelete = (checkpointDeleteResult.rows[0] as { count: number })?.count ?? 0;

      const checkpointOldestResult = await db.execute(
        sql`SELECT MIN(created_at) AS oldest FROM loop_checkpoints`,
      );
      const checkpointOldestRaw = (checkpointOldestResult.rows[0] as { oldest: string | null })
        ?.oldest;
      const checkpointOldest = checkpointOldestRaw ? new Date(checkpointOldestRaw) : null;

      return {
        auditActions: { total: auditTotal, toDelete: auditToDelete, oldestDate: auditOldest },
        agentRuns: { total: runTotal, toDelete: runToDelete, oldestDate: runOldest },
        webhookDeliveries: {
          total: deliveryTotal,
          toDelete: deliveryToDelete,
          oldestDate: deliveryOldest,
        },
        checkpoints: {
          total: checkpointTotal,
          toDelete: checkpointToDelete,
          oldestDate: checkpointOldest,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ControlPlaneError) {
        throw err;
      }
      throw new ControlPlaneError(
        'RETENTION_CALCULATION_FAILED',
        `Failed to calculate retention summary: ${message}`,
        {},
      );
    }
  }

  // -----------------------------------------------------------------------
  // cleanupAuditActions
  // -----------------------------------------------------------------------

  async function cleanupAuditActions(before: Date): Promise<{ deleted: number }> {
    try {
      if (config.dryRun) {
        const countResult = await db.execute(
          sql`SELECT COUNT(*)::int AS count FROM agent_actions WHERE timestamp < ${before}`,
        );
        const count = (countResult.rows[0] as { count: number })?.count ?? 0;
        return { deleted: count };
      }

      // Insert a gap marker to preserve hash chain integrity before deletion
      await db.execute(
        sql`INSERT INTO agent_actions (action_type, tool_name, tool_input, timestamp)
            VALUES ('retention_gap', 'log-retention', ${JSON.stringify({ deletedBefore: before.toISOString(), reason: 'log-retention-cleanup' })}, NOW())`,
      );

      let totalDeleted = 0;
      let batchDeleted: number;

      do {
        const result = await db.execute(
          sql`DELETE FROM agent_actions WHERE id IN (
            SELECT id FROM agent_actions WHERE timestamp < ${before} LIMIT ${config.batchSize}
          )`,
        );
        batchDeleted = result.rowCount ?? 0;
        totalDeleted += batchDeleted;
      } while (batchDeleted >= config.batchSize);

      return { deleted: totalDeleted };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ControlPlaneError) {
        throw err;
      }
      throw new ControlPlaneError(
        'AUDIT_CLEANUP_FAILED',
        `Failed to clean up audit actions: ${message}`,
        { before: before.toISOString() },
      );
    }
  }

  // -----------------------------------------------------------------------
  // cleanupAgentRuns
  // -----------------------------------------------------------------------

  async function cleanupAgentRuns(before: Date): Promise<{ deleted: number }> {
    try {
      if (config.dryRun) {
        const countResult = await db.execute(
          sql`SELECT COUNT(*)::int AS count FROM agent_runs WHERE started_at < ${before} AND status NOT IN ('running', 'paused')`,
        );
        const count = (countResult.rows[0] as { count: number })?.count ?? 0;
        return { deleted: count };
      }

      let totalDeleted = 0;
      let batchDeleted: number;

      do {
        const result = await db.execute(
          sql`DELETE FROM agent_runs WHERE id IN (
            SELECT id FROM agent_runs WHERE started_at < ${before} AND status NOT IN ('running', 'paused') LIMIT ${config.batchSize}
          )`,
        );
        batchDeleted = result.rowCount ?? 0;
        totalDeleted += batchDeleted;
      } while (batchDeleted >= config.batchSize);

      return { deleted: totalDeleted };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ControlPlaneError) {
        throw err;
      }
      throw new ControlPlaneError(
        'RUN_CLEANUP_FAILED',
        `Failed to clean up agent runs: ${message}`,
        { before: before.toISOString() },
      );
    }
  }

  // -----------------------------------------------------------------------
  // cleanupWebhookDeliveries
  // -----------------------------------------------------------------------

  async function cleanupWebhookDeliveries(before: Date): Promise<{ deleted: number }> {
    try {
      if (config.dryRun) {
        const countResult = await db.execute(
          sql`SELECT COUNT(*)::int AS count FROM webhook_deliveries WHERE delivered_at < ${before}`,
        );
        const count = (countResult.rows[0] as { count: number })?.count ?? 0;
        return { deleted: count };
      }

      let totalDeleted = 0;
      let batchDeleted: number;

      do {
        const result = await db.execute(
          sql`DELETE FROM webhook_deliveries WHERE id IN (
            SELECT id FROM webhook_deliveries WHERE delivered_at < ${before} LIMIT ${config.batchSize}
          )`,
        );
        batchDeleted = result.rowCount ?? 0;
        totalDeleted += batchDeleted;
      } while (batchDeleted >= config.batchSize);

      return { deleted: totalDeleted };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ControlPlaneError) {
        throw err;
      }
      throw new ControlPlaneError(
        'DELIVERY_CLEANUP_FAILED',
        `Failed to clean up webhook deliveries: ${message}`,
        { before: before.toISOString() },
      );
    }
  }

  // -----------------------------------------------------------------------
  // cleanupCheckpoints
  // -----------------------------------------------------------------------

  async function cleanupCheckpoints(before: Date): Promise<{ deleted: number }> {
    try {
      if (config.dryRun) {
        const countResult = await db.execute(
          sql`SELECT COUNT(*)::int AS count FROM loop_checkpoints WHERE created_at < ${before}`,
        );
        const count = (countResult.rows[0] as { count: number })?.count ?? 0;
        return { deleted: count };
      }

      let totalDeleted = 0;
      let batchDeleted: number;

      do {
        const result = await db.execute(
          sql`DELETE FROM loop_checkpoints WHERE id IN (
            SELECT id FROM loop_checkpoints WHERE created_at < ${before} LIMIT ${config.batchSize}
          )`,
        );
        batchDeleted = result.rowCount ?? 0;
        totalDeleted += batchDeleted;
      } while (batchDeleted >= config.batchSize);

      return { deleted: totalDeleted };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ControlPlaneError) {
        throw err;
      }
      throw new ControlPlaneError(
        'CHECKPOINT_CLEANUP_FAILED',
        `Failed to clean up checkpoints: ${message}`,
        { before: before.toISOString() },
      );
    }
  }

  // -----------------------------------------------------------------------
  // runFullCleanup
  // -----------------------------------------------------------------------

  async function runFullCleanup(): Promise<CleanupResult> {
    const auditCutoff = cutoffDate(config.auditRetentionDays);
    const runCutoff = cutoffDate(config.runRetentionDays);
    const deliveryCutoff = cutoffDate(config.deliveryRetentionDays);
    const checkpointCutoff = cutoffDate(config.checkpointRetentionDays);

    const auditResult = await cleanupAuditActions(auditCutoff);
    const runResult = await cleanupAgentRuns(runCutoff);
    const deliveryResult = await cleanupWebhookDeliveries(deliveryCutoff);
    const checkpointResult = await cleanupCheckpoints(checkpointCutoff);

    return {
      auditActionsDeleted: auditResult.deleted,
      agentRunsDeleted: runResult.deleted,
      webhookDeliveriesDeleted: deliveryResult.deleted,
      checkpointsDeleted: checkpointResult.deleted,
      dryRun: config.dryRun,
      executedAt: new Date(),
    };
  }

  // -----------------------------------------------------------------------
  // estimateStorageUsage
  // -----------------------------------------------------------------------

  async function estimateStorageUsage(): Promise<StorageEstimate> {
    try {
      const result = await db.execute(
        sql`SELECT
          relname AS table_name,
          pg_total_relation_size(quote_ident(relname))::bigint AS size_bytes
        FROM pg_class
        WHERE relname IN ('agent_actions', 'agent_runs', 'webhook_deliveries', 'loop_checkpoints')
          AND relkind = 'r'`,
      );

      const sizeMap = new Map<string, number>();
      for (const row of result.rows as { table_name: string; size_bytes: number | string }[]) {
        sizeMap.set(row.table_name, Number(row.size_bytes) / (1024 * 1024));
      }

      const auditActionsMb = sizeMap.get('agent_actions') ?? 0;
      const agentRunsMb = sizeMap.get('agent_runs') ?? 0;
      const webhookDeliveriesMb = sizeMap.get('webhook_deliveries') ?? 0;
      const checkpointsMb = sizeMap.get('loop_checkpoints') ?? 0;

      return {
        auditActionsMb,
        agentRunsMb,
        webhookDeliveriesMb,
        checkpointsMb,
        totalMb: auditActionsMb + agentRunsMb + webhookDeliveriesMb + checkpointsMb,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ControlPlaneError) {
        throw err;
      }
      throw new ControlPlaneError(
        'STORAGE_ESTIMATE_FAILED',
        `Failed to estimate storage usage: ${message}`,
        {},
      );
    }
  }

  return {
    calculateRetention,
    cleanupAuditActions,
    cleanupAgentRuns,
    cleanupWebhookDeliveries,
    cleanupCheckpoints,
    runFullCleanup,
    estimateStorageUsage,
  };
}
