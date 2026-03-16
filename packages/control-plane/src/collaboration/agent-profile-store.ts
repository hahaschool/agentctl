import type { AgentInstance, AgentProfile } from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import { eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { agentInstances, agentProfiles } from '../db/index.js';

// ── Input types ─────────────────────────────────────────────

type CreateProfileInput = {
  readonly name: string;
  readonly runtimeType: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly capabilities?: readonly string[];
  readonly toolScopes?: readonly string[];
  readonly maxTokensPerTask?: number | null;
  readonly maxCostPerHour?: number | null;
};

type CreateInstanceInput = {
  readonly profileId: string;
  readonly machineId?: string | null;
  readonly worktreeId?: string | null;
  readonly runtimeSessionId?: string | null;
  readonly status?: string;
};

type UpdateInstanceInput = {
  readonly status?: string;
  readonly machineId?: string | null;
  readonly worktreeId?: string | null;
  readonly runtimeSessionId?: string | null;
};

// ── Store ───────────────────────────────────────────────────

export class AgentProfileStore {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  // ── Profiles ────────────────────────────────────────────

  async createProfile(input: CreateProfileInput): Promise<AgentProfile> {
    const rows = await this.db
      .insert(agentProfiles)
      .values({
        name: input.name,
        runtimeType: input.runtimeType,
        modelId: input.modelId,
        providerId: input.providerId,
        capabilities: [...(input.capabilities ?? [])],
        toolScopes: [...(input.toolScopes ?? [])],
        maxTokensPerTask: input.maxTokensPerTask ?? null,
        maxCostPerHour: input.maxCostPerHour ?? null,
      })
      .returning();

    if (rows.length === 0) {
      throw new ControlPlaneError('PROFILE_CREATE_FAILED', 'Failed to insert agent profile', {
        input,
      });
    }

    this.logger.info({ profileId: rows[0].id, name: input.name }, 'Agent profile created');
    return this.toProfile(rows[0]);
  }

  async getProfile(id: string): Promise<AgentProfile | undefined> {
    const rows = await this.db.select().from(agentProfiles).where(eq(agentProfiles.id, id));
    return rows.length > 0 ? this.toProfile(rows[0]) : undefined;
  }

  async listProfiles(): Promise<AgentProfile[]> {
    const rows = await this.db.select().from(agentProfiles);
    return rows.map((row) => this.toProfile(row));
  }

  async deleteProfile(id: string): Promise<void> {
    const result = await this.db
      .delete(agentProfiles)
      .where(eq(agentProfiles.id, id))
      .returning({ id: agentProfiles.id });

    if (result.length === 0) {
      throw new ControlPlaneError('PROFILE_NOT_FOUND', `Agent profile '${id}' not found`, { id });
    }

    this.logger.info({ profileId: id }, 'Agent profile deleted');
  }

  // ── Instances ───────────────────────────────────────────

  async createInstance(input: CreateInstanceInput): Promise<AgentInstance> {
    const rows = await this.db
      .insert(agentInstances)
      .values({
        profileId: input.profileId,
        machineId: input.machineId ?? null,
        worktreeId: input.worktreeId ?? null,
        runtimeSessionId: input.runtimeSessionId ?? null,
        status: input.status ?? 'idle',
      })
      .returning();

    if (rows.length === 0) {
      throw new ControlPlaneError('INSTANCE_CREATE_FAILED', 'Failed to insert agent instance', {
        input,
      });
    }

    this.logger.info(
      { instanceId: rows[0].id, profileId: input.profileId },
      'Agent instance created',
    );
    return this.toInstance(rows[0]);
  }

  async getInstance(id: string): Promise<AgentInstance | undefined> {
    const rows = await this.db.select().from(agentInstances).where(eq(agentInstances.id, id));
    return rows.length > 0 ? this.toInstance(rows[0]) : undefined;
  }

  async listInstancesByProfile(profileId: string): Promise<AgentInstance[]> {
    const rows = await this.db
      .select()
      .from(agentInstances)
      .where(eq(agentInstances.profileId, profileId));
    return rows.map((row) => this.toInstance(row));
  }

  async countInstances(): Promise<number> {
    const rows = await this.db.select({ count: sql<number>`count(*)::int` }).from(agentInstances);
    return rows[0]?.count ?? 0;
  }

  async updateInstance(id: string, input: UpdateInstanceInput): Promise<AgentInstance> {
    const updateFields: Record<string, unknown> = {};

    if (input.status !== undefined) {
      updateFields.status = input.status;
    }
    if (input.machineId !== undefined) {
      updateFields.machineId = input.machineId;
    }
    if (input.worktreeId !== undefined) {
      updateFields.worktreeId = input.worktreeId;
    }
    if (input.runtimeSessionId !== undefined) {
      updateFields.runtimeSessionId = input.runtimeSessionId;
    }

    // Always update heartbeat on any update
    updateFields.heartbeatAt = new Date();

    const rows = await this.db
      .update(agentInstances)
      .set(updateFields)
      .where(eq(agentInstances.id, id))
      .returning();

    if (rows.length === 0) {
      throw new ControlPlaneError('INSTANCE_NOT_FOUND', `Agent instance '${id}' not found`, {
        id,
      });
    }

    this.logger.info({ instanceId: id }, 'Agent instance updated');
    return this.toInstance(rows[0]);
  }

  async deleteInstance(id: string): Promise<void> {
    const result = await this.db
      .delete(agentInstances)
      .where(eq(agentInstances.id, id))
      .returning({ id: agentInstances.id });

    if (result.length === 0) {
      throw new ControlPlaneError('INSTANCE_NOT_FOUND', `Agent instance '${id}' not found`, {
        id,
      });
    }

    this.logger.info({ instanceId: id }, 'Agent instance deleted');
  }

  // ── Mappers ─────────────────────────────────────────────

  private toProfile(row: typeof agentProfiles.$inferSelect): AgentProfile {
    return {
      id: row.id,
      name: row.name,
      runtimeType: row.runtimeType as AgentProfile['runtimeType'],
      modelId: row.modelId,
      providerId: row.providerId,
      capabilities: row.capabilities ?? [],
      toolScopes: row.toolScopes ?? [],
      maxTokensPerTask: row.maxTokensPerTask ?? null,
      maxCostPerHour: row.maxCostPerHour ?? null,
      createdAt: (row.createdAt ?? new Date()).toISOString(),
    };
  }

  private toInstance(row: typeof agentInstances.$inferSelect): AgentInstance {
    return {
      id: row.id,
      profileId: row.profileId,
      machineId: row.machineId ?? null,
      worktreeId: row.worktreeId ?? null,
      runtimeSessionId: row.runtimeSessionId ?? null,
      status: (row.status ?? 'idle') as AgentInstance['status'],
      heartbeatAt: (row.heartbeatAt ?? new Date()).toISOString(),
      startedAt: (row.startedAt ?? new Date()).toISOString(),
    };
  }
}
