import type { Agent, AgentRun, Machine, RegisterWorkerRequest } from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import { desc, eq } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { agentActions, agentRuns, agents, machines } from '../db/index.js';

type CreateAgentData = {
  machineId: string;
  name: string;
  type: string;
  schedule?: string | null;
  projectPath?: string | null;
  worktreeBranch?: string | null;
  config?: Record<string, unknown>;
};

type CreateRunData = {
  agentId: string;
  trigger: string;
  model?: string | null;
  provider?: string | null;
  sessionId?: string | null;
};

type CompleteRunData = {
  status: string;
  costUsd?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  errorMessage?: string | null;
  resultSummary?: string | null;
};

type InsertActionData = {
  actionType: string;
  toolName?: string | null;
  toolInput?: Record<string, unknown> | null;
  toolOutputHash?: string | null;
  durationMs?: number | null;
  approvedBy?: string | null;
};

export class DbAgentRegistry {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  // ---------------------------------------------------------------------------
  // Machine CRUD
  // ---------------------------------------------------------------------------

  async registerMachine(data: RegisterWorkerRequest): Promise<void> {
    const { machineId, hostname, tailscaleIp, os, arch, capabilities } = data;

    await this.db
      .insert(machines)
      .values({
        id: machineId,
        hostname,
        tailscaleIp,
        os,
        arch,
        status: 'online',
        lastHeartbeat: new Date(),
        capabilities,
      })
      .onConflictDoUpdate({
        target: machines.id,
        set: {
          hostname,
          tailscaleIp,
          os,
          arch,
          status: 'online',
          lastHeartbeat: new Date(),
          capabilities,
        },
      });

    this.logger.info({ machineId, hostname }, 'Machine registered');
  }

  async heartbeat(machineId: string): Promise<void> {
    const result = await this.db
      .update(machines)
      .set({
        lastHeartbeat: new Date(),
        status: 'online',
      })
      .where(eq(machines.id, machineId))
      .returning({ id: machines.id });

    if (result.length === 0) {
      throw new ControlPlaneError('MACHINE_NOT_FOUND', `Machine '${machineId}' is not registered`, {
        machineId,
      });
    }
  }

  async listMachines(): Promise<Machine[]> {
    const rows = await this.db.select().from(machines);

    return rows.map((row) => this.toMachine(row));
  }

  async getMachine(machineId: string): Promise<Machine | undefined> {
    const rows = await this.db.select().from(machines).where(eq(machines.id, machineId));

    if (rows.length === 0) {
      return undefined;
    }

    return this.toMachine(rows[0]);
  }

  // ---------------------------------------------------------------------------
  // Agent CRUD
  // ---------------------------------------------------------------------------

  async createAgent(data: CreateAgentData): Promise<string> {
    const rows = await this.db
      .insert(agents)
      .values({
        machineId: data.machineId,
        name: data.name,
        type: data.type,
        status: 'registered',
        schedule: data.schedule ?? null,
        projectPath: data.projectPath ?? null,
        worktreeBranch: data.worktreeBranch ?? null,
        config: data.config ?? {},
      })
      .returning({ id: agents.id });

    if (rows.length === 0) {
      throw new ControlPlaneError('AGENT_CREATE_FAILED', 'Failed to insert agent row', { data });
    }

    const agentId = rows[0].id;
    this.logger.info({ agentId, name: data.name }, 'Agent created');
    return agentId;
  }

  async getAgent(agentId: string): Promise<Agent | undefined> {
    const rows = await this.db.select().from(agents).where(eq(agents.id, agentId));

    if (rows.length === 0) {
      return undefined;
    }

    return this.toAgent(rows[0]);
  }

  async updateAgentStatus(agentId: string, status: string): Promise<void> {
    const result = await this.db
      .update(agents)
      .set({ status })
      .where(eq(agents.id, agentId))
      .returning({ id: agents.id });

    if (result.length === 0) {
      throw new ControlPlaneError('AGENT_NOT_FOUND', `Agent '${agentId}' does not exist`, {
        agentId,
      });
    }

    this.logger.info({ agentId, status }, 'Agent status updated');
  }

  async listAgents(machineId?: string): Promise<Agent[]> {
    const query = machineId
      ? this.db.select().from(agents).where(eq(agents.machineId, machineId))
      : this.db.select().from(agents);

    const rows = await query;
    return rows.map((row) => this.toAgent(row));
  }

  // ---------------------------------------------------------------------------
  // Run tracking
  // ---------------------------------------------------------------------------

  async createRun(data: CreateRunData): Promise<string> {
    const rows = await this.db
      .insert(agentRuns)
      .values({
        agentId: data.agentId,
        trigger: data.trigger,
        status: 'running',
        startedAt: new Date(),
        model: data.model ?? null,
        provider: data.provider ?? null,
        sessionId: data.sessionId ?? null,
      })
      .returning({ id: agentRuns.id });

    if (rows.length === 0) {
      throw new ControlPlaneError('RUN_CREATE_FAILED', 'Failed to insert agent run row', { data });
    }

    const runId = rows[0].id;
    this.logger.info({ runId, agentId: data.agentId, trigger: data.trigger }, 'Agent run created');
    return runId;
  }

  async completeRun(runId: string, data: CompleteRunData): Promise<void> {
    const result = await this.db
      .update(agentRuns)
      .set({
        status: data.status,
        finishedAt: new Date(),
        costUsd: data.costUsd ?? null,
        tokensIn: data.tokensIn ?? null,
        tokensOut: data.tokensOut ?? null,
        errorMessage: data.errorMessage ?? null,
        resultSummary: data.resultSummary ?? null,
      })
      .where(eq(agentRuns.id, runId))
      .returning({ id: agentRuns.id });

    if (result.length === 0) {
      throw new ControlPlaneError('RUN_NOT_FOUND', `Run '${runId}' does not exist`, { runId });
    }

    this.logger.info({ runId, status: data.status }, 'Agent run completed');
  }

  async getRecentRuns(agentId: string, limit = 20): Promise<AgentRun[]> {
    const rows = await this.db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.agentId, agentId))
      .orderBy(desc(agentRuns.startedAt))
      .limit(limit);

    return rows.map((row) => this.toRun(row));
  }

  // ---------------------------------------------------------------------------
  // Audit action ingestion
  // ---------------------------------------------------------------------------

  async insertActions(runId: string, actions: InsertActionData[]): Promise<number> {
    if (actions.length === 0) {
      return 0;
    }

    const rows = actions.map((action) => ({
      runId,
      actionType: action.actionType,
      toolName: action.toolName ?? null,
      toolInput: action.toolInput ?? null,
      toolOutputHash: action.toolOutputHash ?? null,
      durationMs: action.durationMs ?? null,
      approvedBy: action.approvedBy ?? null,
    }));

    try {
      const result = await this.db
        .insert(agentActions)
        .values(rows)
        .returning({ id: agentActions.id });

      this.logger.info({ runId, insertedCount: result.length }, 'Audit actions inserted');

      return result.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ControlPlaneError(
        'AUDIT_INSERT_FAILED',
        `Failed to insert audit actions: ${message}`,
        {
          runId,
          actionCount: actions.length,
        },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Row-to-domain mappers
  // ---------------------------------------------------------------------------

  private toMachine(row: typeof machines.$inferSelect): Machine {
    return {
      id: row.id,
      hostname: row.hostname,
      tailscaleIp: row.tailscaleIp,
      os: row.os as Machine['os'],
      arch: row.arch as Machine['arch'],
      status: (row.status ?? 'online') as Machine['status'],
      lastHeartbeat: row.lastHeartbeat,
      capabilities: (row.capabilities ?? {
        gpu: false,
        docker: false,
        maxConcurrentAgents: 1,
      }) as Machine['capabilities'],
      createdAt: row.createdAt ?? new Date(),
    };
  }

  private toAgent(row: typeof agents.$inferSelect): Agent {
    return {
      id: row.id,
      machineId: row.machineId ?? '',
      name: row.name,
      type: row.type as Agent['type'],
      status: (row.status ?? 'registered') as Agent['status'],
      schedule: row.schedule,
      projectPath: row.projectPath,
      worktreeBranch: row.worktreeBranch,
      currentSessionId: row.currentSessionId,
      config: (row.config ?? {}) as Agent['config'],
      lastRunAt: row.lastRunAt,
      lastCostUsd: row.lastCostUsd ? Number(row.lastCostUsd) : null,
      totalCostUsd: Number(row.totalCostUsd ?? 0),
      createdAt: row.createdAt ?? new Date(),
    };
  }

  private toRun(row: typeof agentRuns.$inferSelect): AgentRun {
    return {
      id: row.id,
      agentId: row.agentId ?? '',
      trigger: row.trigger as AgentRun['trigger'],
      status: row.status as AgentRun['status'],
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      costUsd: row.costUsd ? Number(row.costUsd) : null,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      model: row.model,
      provider: row.provider as AgentRun['provider'],
      sessionId: row.sessionId,
      errorMessage: row.errorMessage,
      resultSummary: row.resultSummary,
    };
  }
}
