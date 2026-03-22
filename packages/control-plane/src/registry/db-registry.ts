import type {
  Agent,
  AgentRun,
  ExecutionSummary,
  Machine,
  RegisterWorkerRequest,
  RunPhase,
} from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import { and, count, desc, eq, gte, lte, notInArray, sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { agentActions, agentRuns, agents, machines, rcSessions } from '../db/index.js';

type CreateAgentData = {
  machineId: string;
  name: string;
  type: string;
  runtime?: string;
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
  /** ID of the original run this is a retry of (null for first attempts). */
  retryOf?: string | null;
  /** 1-based retry attempt number (null for first attempts). */
  retryIndex?: number | null;
};

type CompleteRunData = {
  status: string;
  phase?: RunPhase | null;
  sessionId?: string | null;
  costUsd?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  errorMessage?: string | null;
  resultSummary?: ExecutionSummary | string | null;
};

const TERMINAL_RUN_PHASE_BY_STATUS: Record<string, RunPhase> = {
  success: 'completed',
  failure: 'failed',
  error: 'failed',
  timeout: 'failed',
  cancelled: 'failed',
  empty: 'empty',
};

type InsertActionData = {
  actionType: string;
  toolName?: string | null;
  toolInput?: Record<string, unknown> | null;
  toolOutputHash?: string | null;
  durationMs?: number | null;
  approvedBy?: string | null;
};

export type AuditQueryFilters = {
  agentId?: string;
  runId?: string;
  from?: string;
  to?: string;
  tool?: string;
  limit?: number;
  offset?: number;
};

export type AuditAction = {
  id: number;
  runId: string | null;
  timestamp: Date | null;
  actionType: string;
  toolName: string | null;
  toolInput: unknown;
  toolOutputHash: string | null;
  durationMs: number | null;
  approvedBy: string | null;
  agentId: string | null;
};

export type AuditQueryResult = {
  actions: AuditAction[];
  total: number;
  hasMore: boolean;
};

export type AuditSummaryFilters = {
  agentId?: string;
  from?: string;
  to?: string;
};

export type AuditSummary = {
  totalActions: number;
  topTools: { tool: string; count: number }[];
  topAgents: { agentId: string; count: number }[];
  errorCount: number;
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

  async heartbeat(machineId: string, capabilities?: Machine['capabilities']): Promise<void> {
    const setClause: Partial<typeof machines.$inferInsert> = {
      lastHeartbeat: new Date(),
      status: 'online',
    };

    if (capabilities) {
      setClause.capabilities = capabilities;
    }

    const result = await this.db
      .update(machines)
      .set(setClause)
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

  async findOnlineMachine(): Promise<Machine | null> {
    const [machine] = await this.db
      .select()
      .from(machines)
      .where(eq(machines.status, 'online'))
      .limit(1);

    return machine ? this.toMachine(machine) : null;
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
        runtime: data.runtime ?? 'claude-code',
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

  async updateAgent(
    agentId: string,
    data: {
      accountId?: string | null;
      name?: string;
      machineId?: string;
      type?: string;
      schedule?: string | null;
      config?: Record<string, unknown>;
      currentSessionId?: string | null;
    },
  ): Promise<Agent> {
    const setClause: Record<string, unknown> = {};

    if ('accountId' in data) {
      setClause.accountId = data.accountId ?? null;
    }

    if ('name' in data && data.name !== undefined) {
      setClause.name = data.name;
    }

    if ('machineId' in data && data.machineId !== undefined) {
      setClause.machineId = data.machineId;
    }

    if ('type' in data && data.type !== undefined) {
      setClause.type = data.type;
    }

    if ('schedule' in data) {
      setClause.schedule = data.schedule ?? null;
    }

    if ('config' in data && data.config !== undefined) {
      setClause.config = data.config;
    }

    if ('currentSessionId' in data) {
      setClause.currentSessionId = data.currentSessionId ?? null;
    }

    if (Object.keys(setClause).length === 0) {
      const existing = await this.getAgent(agentId);

      if (!existing) {
        throw new ControlPlaneError('AGENT_NOT_FOUND', `Agent '${agentId}' does not exist`, {
          agentId,
        });
      }

      return existing;
    }

    const result = await this.db
      .update(agents)
      .set(setClause)
      .where(eq(agents.id, agentId))
      .returning();

    if (result.length === 0) {
      throw new ControlPlaneError('AGENT_NOT_FOUND', `Agent '${agentId}' does not exist`, {
        agentId,
      });
    }

    this.logger.info({ agentId, ...data }, 'Agent updated');
    return this.toAgent(result[0]);
  }

  async listAgents(machineId?: string): Promise<Agent[]> {
    const query = machineId
      ? this.db.select().from(agents).where(eq(agents.machineId, machineId))
      : this.db.select().from(agents);

    const rows = await query;
    return rows.map((row) => this.toAgent(row));
  }

  async listAgentsPaginated(opts: {
    machineId?: string;
    limit: number;
    offset: number;
  }): Promise<{ agents: Agent[]; total: number; hasMore: boolean }> {
    const condition = opts.machineId ? eq(agents.machineId, opts.machineId) : undefined;

    // Count total matching rows
    const countQuery = this.db.select({ value: count() }).from(agents);
    if (condition) {
      countQuery.where(condition);
    }
    const countResult = await countQuery;
    const total = countResult[0]?.value ?? 0;

    // Fetch the page of results
    const dataQuery = this.db.select().from(agents);
    if (condition) {
      dataQuery.where(condition);
    }
    const rows = await dataQuery
      .orderBy(desc(agents.createdAt))
      .limit(opts.limit)
      .offset(opts.offset);

    return {
      agents: rows.map((row) => this.toAgent(row)),
      total,
      hasMore: opts.offset + opts.limit < total,
    };
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
        phase: 'queued',
        startedAt: new Date(),
        model: data.model ?? null,
        provider: data.provider ?? null,
        sessionId: data.sessionId ?? null,
        retryOf: data.retryOf ?? null,
        retryIndex: data.retryIndex ?? null,
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
    const phase = data.phase ?? this.mapStatusToPhase(data.status);

    const result = await this.db
      .update(agentRuns)
      .set({
        status: data.status,
        phase,
        ...(data.sessionId !== undefined ? { sessionId: data.sessionId ?? null } : {}),
        finishedAt: new Date(),
        costUsd: data.costUsd ?? null,
        tokensIn: data.tokensIn ?? null,
        tokensOut: data.tokensOut ?? null,
        errorMessage: data.errorMessage ?? null,
        resultSummary: data.resultSummary ?? null,
      })
      .where(eq(agentRuns.id, runId))
      .returning({ id: agentRuns.id, agentId: agentRuns.agentId });

    if (result.length === 0) {
      throw new ControlPlaneError('RUN_NOT_FOUND', `Run '${runId}' does not exist`, { runId });
    }

    // Update the parent agent's cost fields and lastRunAt
    const agentId = result[0].agentId;
    if (agentId) {
      const costValue = data.costUsd ? data.costUsd : '0';
      await this.db
        .update(agents)
        .set({
          lastRunAt: new Date(),
          lastCostUsd: data.costUsd ?? null,
          totalCostUsd: sql`COALESCE(${agents.totalCostUsd}, 0) + ${costValue}`,
        })
        .where(eq(agents.id, agentId));

      this.logger.info(
        { runId, agentId, costUsd: data.costUsd ?? null },
        'Agent cost fields updated from run completion',
      );
    }

    this.logger.info({ runId, status: data.status }, 'Agent run completed');
  }

  async updateRunPhase(runId: string, phase: RunPhase): Promise<void> {
    // Never overwrite a terminal phase (completed, failed, empty) with a
    // non-terminal one. This prevents the race where the dispatch flow
    // sets phase='running' after the completion callback already set 'completed'.
    const terminalPhases = ['completed', 'failed', 'empty'];
    const result = await this.db
      .update(agentRuns)
      .set({ phase })
      .where(
        and(
          eq(agentRuns.id, runId),
          terminalPhases.includes(phase) ? undefined : notInArray(agentRuns.phase, terminalPhases),
        ),
      )
      .returning({ id: agentRuns.id });

    if (result.length === 0) {
      // Either run doesn't exist or phase is already terminal — both are fine
      this.logger.debug(
        { runId, phase },
        'Phase update skipped (run not found or already terminal)',
      );
      return;
    }

    this.logger.debug({ runId, phase }, 'Agent run phase updated');
  }

  /** Refresh a session's heartbeat to prevent reaper from marking it stale. */
  async refreshSessionHeartbeat(sessionId: string): Promise<void> {
    await this.db
      .update(rcSessions)
      .set({ lastHeartbeat: new Date(), status: 'active' })
      .where(eq(rcSessions.id, sessionId));
  }

  /** Update cost, tokens, and sessionId on a running run without changing status/phase. */
  async updateRunProgress(
    runId: string,
    data: { costUsd?: string; tokensIn?: number; tokensOut?: number; sessionId?: string },
  ): Promise<void> {
    const setFields: Record<string, unknown> = {};
    if (data.costUsd !== undefined) setFields.costUsd = data.costUsd;
    if (data.tokensIn !== undefined) setFields.tokensIn = data.tokensIn;
    if (data.tokensOut !== undefined) setFields.tokensOut = data.tokensOut;
    if (data.sessionId !== undefined) setFields.sessionId = data.sessionId;

    if (Object.keys(setFields).length === 0) return;

    await this.db.update(agentRuns).set(setFields).where(eq(agentRuns.id, runId));
  }

  async computeAgentCostFromRuns(
    agentId: string,
  ): Promise<{ lastCostUsd: number | null; totalCostUsd: number }> {
    const rows = await this.db
      .select({
        totalCost: sql<string>`COALESCE(SUM(${agentRuns.costUsd}), 0)`,
      })
      .from(agentRuns)
      .where(eq(agentRuns.agentId, agentId));

    const totalCostUsd = Number(rows[0]?.totalCost ?? 0);

    // Get most recent completed run's cost
    const lastRunRows = await this.db
      .select({ costUsd: agentRuns.costUsd })
      .from(agentRuns)
      .where(and(eq(agentRuns.agentId, agentId), eq(agentRuns.status, 'success')))
      .orderBy(desc(agentRuns.finishedAt))
      .limit(1);

    const lastCostUsd = lastRunRows[0]?.costUsd ? Number(lastRunRows[0].costUsd) : null;

    return { lastCostUsd, totalCostUsd };
  }

  async getRun(runId: string): Promise<AgentRun | undefined> {
    const rows = await this.db.select().from(agentRuns).where(eq(agentRuns.id, runId));

    if (rows.length === 0) {
      return undefined;
    }

    return this.toRun(rows[0]);
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

  async getAgentHealth(
    agentId: string,
    recentLimit = 10,
  ): Promise<{
    consecutiveFailures: number;
    failureRate24h: number;
    lastSuccessAt: string | null;
    status: 'healthy' | 'warning' | 'critical';
  }> {
    // Fetch last N runs (most recent first)
    const recentRows = await this.db
      .select({
        status: agentRuns.status,
        finishedAt: agentRuns.finishedAt,
      })
      .from(agentRuns)
      .where(eq(agentRuns.agentId, agentId))
      .orderBy(desc(agentRuns.startedAt))
      .limit(recentLimit);

    // Calculate consecutive failures from most recent
    let consecutiveFailures = 0;
    for (const row of recentRows) {
      if (row.status === 'failure' || row.status === 'timeout') {
        consecutiveFailures++;
      } else {
        break;
      }
    }

    // Find last success time
    let lastSuccessAt: string | null = null;
    for (const row of recentRows) {
      if (row.status === 'success' && row.finishedAt) {
        lastSuccessAt = row.finishedAt.toISOString();
        break;
      }
    }

    // If no success in recent runs, query specifically for the last success
    if (!lastSuccessAt) {
      const successRows = await this.db
        .select({ finishedAt: agentRuns.finishedAt })
        .from(agentRuns)
        .where(and(eq(agentRuns.agentId, agentId), eq(agentRuns.status, 'success')))
        .orderBy(desc(agentRuns.finishedAt))
        .limit(1);

      if (successRows.length > 0 && successRows[0].finishedAt) {
        lastSuccessAt = successRows[0].finishedAt.toISOString();
      }
    }

    // Calculate failure rate in last 24h
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const last24hRows = await this.db
      .select({
        status: agentRuns.status,
      })
      .from(agentRuns)
      .where(and(eq(agentRuns.agentId, agentId), gte(agentRuns.startedAt, twentyFourHoursAgo)));

    const total24h = last24hRows.length;
    const failures24h = last24hRows.filter(
      (r) => r.status === 'failure' || r.status === 'timeout',
    ).length;
    const failureRate24h = total24h > 0 ? failures24h / total24h : 0;

    // Determine health status
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (consecutiveFailures >= 5) {
      status = 'critical';
    } else if (consecutiveFailures >= 2) {
      status = 'warning';
    }

    return { consecutiveFailures, failureRate24h, lastSuccessAt, status };
  }

  // ---------------------------------------------------------------------------
  // Session creation from agent runs
  // ---------------------------------------------------------------------------

  async createSessionFromRun(data: {
    sessionId: string;
    agentId: string;
    machineId: string;
    status: string;
    projectPath?: string | null;
    model?: string | null;
    startedAt?: Date;
    endedAt?: Date;
  }): Promise<void> {
    await this.db
      .insert(rcSessions)
      .values({
        id: data.sessionId,
        agentId: data.agentId,
        machineId: data.machineId,
        claudeSessionId: data.sessionId,
        status: data.status === 'success' ? 'stopped' : 'error',
        projectPath: data.projectPath ?? null,
        model: data.model ?? null,
        startedAt: data.startedAt ?? new Date(),
        endedAt: data.endedAt ?? new Date(),
      })
      .onConflictDoUpdate({
        target: rcSessions.id,
        set: {
          status: data.status === 'success' ? 'stopped' : 'error',
          endedAt: data.endedAt ?? new Date(),
        },
      });

    this.logger.info(
      { sessionId: data.sessionId, agentId: data.agentId },
      'Session record created from agent run completion',
    );
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
  // Audit query
  // ---------------------------------------------------------------------------

  async queryActions(filters: AuditQueryFilters): Promise<AuditQueryResult> {
    const queryLimit = Math.min(Math.max(filters.limit ?? 100, 1), 1000);
    const queryOffset = Math.max(filters.offset ?? 0, 0);

    try {
      const conditions = this.buildAuditConditions(filters);

      // Count total matching rows
      const countQuery = this.db
        .select({ value: count() })
        .from(agentActions)
        .leftJoin(agentRuns, eq(agentActions.runId, agentRuns.id));

      if (conditions.length > 0) {
        countQuery.where(and(...conditions));
      }

      const countResult = await countQuery;
      const total = countResult[0]?.value ?? 0;

      // Fetch the page of results
      const dataQuery = this.db
        .select({
          id: agentActions.id,
          runId: agentActions.runId,
          timestamp: agentActions.timestamp,
          actionType: agentActions.actionType,
          toolName: agentActions.toolName,
          toolInput: agentActions.toolInput,
          toolOutputHash: agentActions.toolOutputHash,
          durationMs: agentActions.durationMs,
          approvedBy: agentActions.approvedBy,
          agentId: agentRuns.agentId,
        })
        .from(agentActions)
        .leftJoin(agentRuns, eq(agentActions.runId, agentRuns.id));

      if (conditions.length > 0) {
        dataQuery.where(and(...conditions));
      }

      const rows = await dataQuery
        .orderBy(desc(agentActions.timestamp))
        .limit(queryLimit)
        .offset(queryOffset);

      const actions: AuditAction[] = rows.map((row) => ({
        id: row.id,
        runId: row.runId,
        timestamp: row.timestamp,
        actionType: row.actionType,
        toolName: row.toolName,
        toolInput: row.toolInput,
        toolOutputHash: row.toolOutputHash,
        durationMs: row.durationMs,
        approvedBy: row.approvedBy,
        agentId: row.agentId,
      }));

      return {
        actions,
        total,
        hasMore: queryOffset + queryLimit < total,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ControlPlaneError(
        'AUDIT_QUERY_FAILED',
        `Failed to query audit actions: ${message}`,
        { filters },
      );
    }
  }

  async getAuditSummary(filters: AuditSummaryFilters): Promise<AuditSummary> {
    try {
      const conditions = this.buildAuditConditions(filters);
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // Total actions count
      const totalQuery = this.db
        .select({ value: count() })
        .from(agentActions)
        .leftJoin(agentRuns, eq(agentActions.runId, agentRuns.id));

      if (whereClause) {
        totalQuery.where(whereClause);
      }

      const totalResult = await totalQuery;
      const totalActions = totalResult[0]?.value ?? 0;

      // Top tools (group by tool_name, order by count desc, limit 10)
      const toolsQuery = this.db
        .select({
          tool: agentActions.toolName,
          count: count(),
        })
        .from(agentActions)
        .leftJoin(agentRuns, eq(agentActions.runId, agentRuns.id));

      if (whereClause) {
        toolsQuery.where(and(sql`${agentActions.toolName} IS NOT NULL`, whereClause));
      } else {
        toolsQuery.where(sql`${agentActions.toolName} IS NOT NULL`);
      }

      const toolRows = await toolsQuery
        .groupBy(agentActions.toolName)
        .orderBy(desc(count()))
        .limit(10);

      const topTools = toolRows.map((row) => ({
        tool: row.tool ?? '',
        count: row.count,
      }));

      // Top agents (group by agent_id via join, order by count desc, limit 10)
      const agentsQuery = this.db
        .select({
          agentId: agentRuns.agentId,
          count: count(),
        })
        .from(agentActions)
        .innerJoin(agentRuns, eq(agentActions.runId, agentRuns.id));

      if (whereClause) {
        agentsQuery.where(whereClause);
      }

      const agentRows = await agentsQuery
        .groupBy(agentRuns.agentId)
        .orderBy(desc(count()))
        .limit(10);

      const topAgents = agentRows.map((row) => ({
        agentId: row.agentId ?? '',
        count: row.count,
      }));

      // Error count (actions where action_type contains 'error' or 'deny')
      const errorQuery = this.db
        .select({ value: count() })
        .from(agentActions)
        .leftJoin(agentRuns, eq(agentActions.runId, agentRuns.id));

      const errorCondition = sql`(${agentActions.actionType} = 'error' OR ${agentActions.approvedBy} IS NULL AND ${agentActions.actionType} = 'pre_tool_use')`;
      if (whereClause) {
        errorQuery.where(and(errorCondition, whereClause));
      } else {
        errorQuery.where(errorCondition);
      }

      const errorResult = await errorQuery;
      const errorCount = errorResult[0]?.value ?? 0;

      return {
        totalActions,
        topTools,
        topAgents,
        errorCount,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ControlPlaneError(
        'AUDIT_SUMMARY_FAILED',
        `Failed to get audit summary: ${message}`,
        { filters },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Audit filter helpers
  // ---------------------------------------------------------------------------

  private buildAuditConditions(
    filters: AuditQueryFilters | AuditSummaryFilters,
  ): ReturnType<typeof eq>[] {
    const conditions: ReturnType<typeof eq>[] = [];

    if (filters.agentId) {
      conditions.push(eq(agentRuns.agentId, filters.agentId));
    }

    if ('runId' in filters && filters.runId) {
      conditions.push(eq(agentActions.runId, filters.runId));
    }

    if (filters.from) {
      conditions.push(gte(agentActions.timestamp, new Date(filters.from)));
    }

    if (filters.to) {
      conditions.push(lte(agentActions.timestamp, new Date(filters.to)));
    }

    if ('tool' in filters && filters.tool) {
      conditions.push(eq(agentActions.toolName, filters.tool));
    }

    return conditions;
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
      runtime: (row.runtime ?? 'claude-code') as Agent['runtime'],
      status: (row.status ?? 'registered') as Agent['status'],
      schedule: row.schedule,
      projectPath: row.projectPath,
      worktreeBranch: row.worktreeBranch,
      currentSessionId: row.currentSessionId,
      config: (row.config ?? {}) as Agent['config'],
      lastRunAt: row.lastRunAt,
      lastCostUsd: row.lastCostUsd ? Number(row.lastCostUsd) : null,
      totalCostUsd: Number(row.totalCostUsd ?? 0),
      accountId: row.accountId ?? null,
      createdAt: row.createdAt ?? new Date(),
    };
  }

  private toRun(row: typeof agentRuns.$inferSelect): AgentRun {
    return {
      id: row.id,
      agentId: row.agentId ?? '',
      trigger: row.trigger as AgentRun['trigger'],
      status: row.status as AgentRun['status'],
      phase: (row.phase ?? this.mapStatusToPhase(row.status)) as AgentRun['phase'],
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      costUsd: row.costUsd ? Number(row.costUsd) : null,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      model: row.model,
      provider: row.provider as AgentRun['provider'],
      sessionId: row.sessionId,
      errorMessage: row.errorMessage,
      resultSummary: row.resultSummary ?? null,
      retryOf: row.retryOf ?? null,
      retryIndex: row.retryIndex ?? null,
    };
  }

  private mapStatusToPhase(status: string): RunPhase {
    if (status === 'running') {
      return 'running';
    }

    return TERMINAL_RUN_PHASE_BY_STATUS[status] ?? 'queued';
  }
}
