import type { ManagedRuntime, ManagedRuntimeConfig } from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { machineRuntimeState, runtimeConfigRevisions } from '../db/index.js';

export type RuntimeConfigRevisionRecord = {
  id: string;
  version: number;
  hash: string;
  config: ManagedRuntimeConfig;
  createdAt: Date | null;
};

export type MachineRuntimeStateRecord = {
  id: string;
  machineId: string;
  runtime: ManagedRuntime;
  isInstalled: boolean;
  isAuthenticated: boolean;
  syncStatus: string;
  configVersion: number | null;
  configHash: string | null;
  metadata: Record<string, unknown>;
  lastConfigAppliedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type UpsertMachineRuntimeStateInput = Omit<
  MachineRuntimeStateRecord,
  'id' | 'createdAt' | 'updatedAt' | 'lastConfigAppliedAt'
> & {
  lastConfigAppliedAt?: Date | null;
};

export class RuntimeConfigStore {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  async saveRevision(config: ManagedRuntimeConfig): Promise<RuntimeConfigRevisionRecord> {
    const rows = await this.db
      .insert(runtimeConfigRevisions)
      .values({
        version: config.version,
        hash: config.hash,
        config,
      })
      .onConflictDoUpdate({
        target: runtimeConfigRevisions.version,
        set: {
          hash: config.hash,
          config,
        },
      })
      .returning();

    const row = rows[0];
    if (!row) {
      throw new ControlPlaneError(
        'RUNTIME_CONFIG_SAVE_FAILED',
        'Failed to persist runtime config revision',
        { version: config.version, hash: config.hash },
      );
    }

    this.logger.info({ revisionId: row.id, version: row.version }, 'Runtime config revision saved');
    return mapRuntimeConfigRevision(row);
  }

  async getLatestRevision(): Promise<RuntimeConfigRevisionRecord | null> {
    const rows = await this.db
      .select()
      .from(runtimeConfigRevisions)
      .orderBy(desc(runtimeConfigRevisions.version))
      .limit(1);

    const row = rows[0];
    return row ? mapRuntimeConfigRevision(row) : null;
  }

  async upsertMachineState(
    input: UpsertMachineRuntimeStateInput,
  ): Promise<MachineRuntimeStateRecord> {
    const setValues = {
      isInstalled: input.isInstalled,
      isAuthenticated: input.isAuthenticated,
      syncStatus: input.syncStatus,
      configVersion: input.configVersion,
      configHash: input.configHash,
      metadata: input.metadata,
      lastConfigAppliedAt: input.lastConfigAppliedAt ?? new Date(),
      updatedAt: new Date(),
    };

    const updatedRows = await this.db
      .update(machineRuntimeState)
      .set(setValues)
      .where(
        and(
          eq(machineRuntimeState.machineId, input.machineId),
          eq(machineRuntimeState.runtime, input.runtime),
        ),
      )
      .returning();

    const updated = updatedRows[0];
    if (updated) {
      this.logger.info(
        { machineId: updated.machineId, runtime: updated.runtime },
        'Machine runtime state updated',
      );
      return mapMachineRuntimeState(updated);
    }

    const insertedRows = await this.db
      .insert(machineRuntimeState)
      .values({
        machineId: input.machineId,
        runtime: input.runtime,
        isInstalled: input.isInstalled,
        isAuthenticated: input.isAuthenticated,
        syncStatus: input.syncStatus,
        configVersion: input.configVersion,
        configHash: input.configHash,
        metadata: input.metadata,
        lastConfigAppliedAt: input.lastConfigAppliedAt ?? new Date(),
      })
      .returning();

    const inserted = insertedRows[0];
    if (!inserted) {
      throw new ControlPlaneError(
        'MACHINE_RUNTIME_STATE_UPSERT_FAILED',
        'Failed to upsert machine runtime state',
        { machineId: input.machineId, runtime: input.runtime },
      );
    }

    this.logger.info(
      { machineId: inserted.machineId, runtime: inserted.runtime },
      'Machine runtime state inserted',
    );
    return mapMachineRuntimeState(inserted);
  }

  async listMachineStates(machineId?: string): Promise<MachineRuntimeStateRecord[]> {
    const rows = machineId
      ? await this.db
          .select()
          .from(machineRuntimeState)
          .where(eq(machineRuntimeState.machineId, machineId))
          .orderBy(desc(machineRuntimeState.updatedAt))
      : await this.db
          .select()
          .from(machineRuntimeState)
          .orderBy(desc(machineRuntimeState.updatedAt));

    return rows.map(mapMachineRuntimeState);
  }
}

function mapRuntimeConfigRevision(
  row: typeof runtimeConfigRevisions.$inferSelect,
): RuntimeConfigRevisionRecord {
  return {
    id: row.id,
    version: row.version,
    hash: row.hash,
    config: row.config as ManagedRuntimeConfig,
    createdAt: row.createdAt ?? null,
  };
}

function mapMachineRuntimeState(
  row: typeof machineRuntimeState.$inferSelect,
): MachineRuntimeStateRecord {
  return {
    id: row.id,
    machineId: row.machineId,
    runtime: row.runtime as ManagedRuntime,
    isInstalled: row.isInstalled ?? false,
    isAuthenticated: row.isAuthenticated ?? false,
    syncStatus: row.syncStatus,
    configVersion: row.configVersion ?? null,
    configHash: row.configHash ?? null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
    lastConfigAppliedAt: row.lastConfigAppliedAt ?? null,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}
