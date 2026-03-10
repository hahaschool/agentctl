import { EventEmitter } from 'node:events';

import type { AgentEvent, AgentStatus } from '@agentctl/shared';
import { AgentError } from '@agentctl/shared';
import type { Logger } from 'pino';

import type { WorktreeInfo, WorktreeManager } from '../worktree/index.js';
import { AgentInstance, type AgentInstanceOptions } from './agent-instance.js';

const DEFAULT_MAX_CONCURRENT = 3;

type AgentPoolOptions = {
  maxConcurrent?: number;
  auditLogDir?: string;
  logger: Logger;
  /** Optional WorktreeManager for creating per-agent git worktree isolation. */
  worktreeManager?: WorktreeManager;
};

type AgentSummary = {
  agentId: string;
  machineId: string;
  status: AgentStatus;
  sessionId: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  costUsd: number;
  projectPath: string;
};

type AgentStats = {
  poolSize: number;
  byStatus: Record<string, number>;
  totalCostUsd: number;
  oldestAgent: { agentId: string; startedAt: string } | null;
};

export class AgentPool extends EventEmitter {
  private readonly agents: Map<string, AgentInstance> = new Map();
  private readonly maxConcurrent: number;
  private readonly auditLogDir: string | undefined;
  private readonly log: Logger;
  private readonly worktreeManager: WorktreeManager | undefined;
  /** Tracks which agents have an active worktree so we can clean up on removal. */
  private readonly agentWorktrees: Set<string> = new Set();
  /** Lifetime count of agents created through this pool. */
  private totalAgentsStartedCount: number = 0;

  constructor(options: AgentPoolOptions) {
    super();
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.auditLogDir = options.auditLogDir;
    this.log = options.logger.child({ component: 'agent-pool' });
    this.worktreeManager = options.worktreeManager;
  }

  async createAgent(options: AgentInstanceOptions): Promise<AgentInstance> {
    if (this.agents.has(options.agentId)) {
      throw new AgentError(
        'AGENT_EXISTS',
        `Agent with id '${options.agentId}' already exists in the pool`,
        { agentId: options.agentId },
      );
    }

    const runningCount = this.getRunningCount();

    if (runningCount >= this.maxConcurrent) {
      throw new AgentError(
        'POOL_FULL',
        `Cannot create agent: ${runningCount}/${this.maxConcurrent} agents already running`,
        { agentId: options.agentId, runningCount, maxConcurrent: this.maxConcurrent },
      );
    }

    // Attempt to create a worktree for filesystem isolation.
    // If it fails (not a git repo, disk full, etc.), fall back to the original projectPath.
    let effectiveProjectPath = options.projectPath;

    if (this.worktreeManager) {
      try {
        const worktreeInfo = await this.worktreeManager.create({
          agentId: options.agentId,
          projectPath: options.projectPath,
          description: 'work',
        });
        effectiveProjectPath = worktreeInfo.path;
        this.agentWorktrees.add(options.agentId);
        this.log.info(
          {
            agentId: options.agentId,
            worktreePath: worktreeInfo.path,
            branch: worktreeInfo.branch,
          },
          'Agent worktree created',
        );
      } catch (err) {
        this.log.warn(
          { agentId: options.agentId, err },
          'Failed to create worktree for agent, falling back to original projectPath',
        );
      }
    }

    const instance = new AgentInstance({
      ...options,
      projectPath: effectiveProjectPath,
      auditLogDir: options.auditLogDir ?? this.auditLogDir,
      getActiveTaskCount: () => this.getRunningCount(),
    });

    // Forward agent events from the instance to the pool level,
    // enriching with the agentId for pool-level consumers.
    instance.onEvent((event: AgentEvent) => {
      this.emit('agent-event', { agentId: options.agentId, event });
    });

    this.agents.set(options.agentId, instance);
    this.totalAgentsStartedCount++;

    this.log.info(
      { agentId: options.agentId, projectPath: effectiveProjectPath },
      'Agent added to pool',
    );

    return instance;
  }

  getAgent(agentId: string): AgentInstance | undefined {
    return this.agents.get(agentId);
  }

  async stopAgent(agentId: string, graceful: boolean): Promise<void> {
    const instance = this.agents.get(agentId);

    if (!instance) {
      throw new AgentError('AGENT_NOT_FOUND', `Agent '${agentId}' not found in the pool`, {
        agentId,
      });
    }

    await instance.stop(graceful);
  }

  async removeAgent(agentId: string): Promise<boolean> {
    const instance = this.agents.get(agentId);

    if (!instance) {
      return false;
    }

    const status = instance.getStatus();

    if (status === 'running' || status === 'starting') {
      throw new AgentError(
        'AGENT_STILL_RUNNING',
        `Cannot remove agent '${agentId}' while it is ${status}. Stop it first.`,
        { agentId, status },
      );
    }

    // Clean up worktree if one was created for this agent.
    if (this.worktreeManager && this.agentWorktrees.has(agentId)) {
      try {
        await this.worktreeManager.remove(agentId);
        this.agentWorktrees.delete(agentId);
        this.log.info({ agentId }, 'Agent worktree removed');
      } catch (err) {
        this.log.warn({ agentId, err }, 'Failed to remove worktree for agent');
      }
    }

    instance.removeAllListeners();
    this.agents.delete(agentId);
    this.log.info({ agentId }, 'Agent removed from pool');

    return true;
  }

  listAgents(): AgentSummary[] {
    const result: AgentSummary[] = [];

    for (const instance of this.agents.values()) {
      result.push(instance.toJSON() as AgentSummary);
    }

    return result;
  }

  /**
   * Emergency stop a single agent: force-kill immediately and clean up its worktree.
   *
   * Unlike {@link stopAgent}, this always uses force mode and also removes
   * the worktree. Returns the timestamp of the stop.
   *
   * @throws {AgentError} AGENT_NOT_FOUND if the agent doesn't exist in the pool.
   */
  async emergencyStop(agentId: string): Promise<{ stoppedAt: Date }> {
    const instance = this.agents.get(agentId);

    if (!instance) {
      throw new AgentError('AGENT_NOT_FOUND', `Agent '${agentId}' not found in the pool`, {
        agentId,
      });
    }

    this.log.error({ agentId }, 'Emergency stop triggered for agent');

    // Force-kill the agent (graceful=false)
    await instance.stop(false);

    const stoppedAt = instance.getStoppedAt() ?? new Date();

    // Clean up worktree if one was created for this agent.
    if (this.worktreeManager && this.agentWorktrees.has(agentId)) {
      try {
        await this.worktreeManager.remove(agentId);
        this.agentWorktrees.delete(agentId);
        this.log.info({ agentId }, 'Agent worktree removed during emergency stop');
      } catch (err) {
        this.log.warn({ agentId, err }, 'Failed to remove worktree during emergency stop');
      }
    }

    return { stoppedAt };
  }

  /**
   * Emergency stop ALL running agents in the pool.
   *
   * Force-kills every active agent, cleans up all worktrees, and returns
   * the count of agents that were stopped.
   */
  async emergencyStopAll(): Promise<{ stoppedCount: number }> {
    this.log.error('Emergency stop ALL triggered');

    let stoppedCount = 0;
    const promises: Promise<void>[] = [];

    for (const [agentId, instance] of this.agents) {
      const status = instance.getStatus();

      if (status === 'running' || status === 'starting' || status === 'stopping') {
        stoppedCount++;
        this.log.error({ agentId }, 'Emergency stopping agent');
        promises.push(instance.stop(false));
      }
    }

    await Promise.all(promises);

    // Clean up all worktrees
    if (this.worktreeManager && this.agentWorktrees.size > 0) {
      this.log.info(
        { count: this.agentWorktrees.size },
        'Cleaning up worktrees during emergency stop all',
      );

      for (const agentId of this.agentWorktrees) {
        try {
          await this.worktreeManager.remove(agentId);
          this.log.info({ agentId }, 'Worktree cleaned up during emergency stop all');
        } catch (err) {
          this.log.warn({ agentId, err }, 'Failed to clean up worktree during emergency stop all');
        }
      }

      this.agentWorktrees.clear();
    }

    this.log.error({ stoppedCount }, 'Emergency stop ALL completed');

    return { stoppedCount };
  }

  async stopAll(graceful: boolean = true): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [agentId, instance] of this.agents) {
      const status = instance.getStatus();

      if (status === 'running' || status === 'starting' || status === 'stopping') {
        this.log.info({ agentId, graceful }, 'Stopping agent as part of stopAll');
        promises.push(instance.stop(graceful));
      }
    }

    await Promise.all(promises);
    this.log.info('All agents stopped');

    // Clean up any worktrees that remain after stopping all agents.
    // This catches worktrees left behind when agents crash or are not
    // individually removed before the pool shuts down.
    if (this.worktreeManager && this.agentWorktrees.size > 0) {
      this.log.info({ count: this.agentWorktrees.size }, 'Cleaning up remaining agent worktrees');

      for (const agentId of this.agentWorktrees) {
        try {
          await this.worktreeManager.remove(agentId);
          this.log.info({ agentId }, 'Worktree cleaned up during stopAll');
        } catch (err) {
          this.log.warn({ agentId, err }, 'Failed to clean up worktree during stopAll');
        }
      }

      this.agentWorktrees.clear();
    }
  }

  /**
   * Remove worktrees that are not associated with any currently tracked agent.
   *
   * This is intended to be called at startup to clean up worktrees that were
   * left behind after a crash or ungraceful shutdown. It lists all worktrees
   * via the WorktreeManager, identifies those whose branch names follow the
   * `agent-{id}/...` convention, and removes any whose agent ID is not present
   * in the current pool.
   */
  async cleanOrphanedWorktrees(): Promise<void> {
    if (!this.worktreeManager) {
      return;
    }

    let allWorktrees: WorktreeInfo[];

    try {
      allWorktrees = await this.worktreeManager.list();
    } catch (err) {
      this.log.warn({ err }, 'Failed to list worktrees for orphan cleanup');
      return;
    }

    const AGENT_BRANCH_PREFIX = 'agent-';

    for (const worktree of allWorktrees) {
      // Only consider worktrees whose branch follows the agent naming convention:
      //   agent-{agentId}/{description}
      if (!worktree.branch.startsWith(AGENT_BRANCH_PREFIX)) {
        continue;
      }

      const slashIndex = worktree.branch.indexOf('/');
      const agentId =
        slashIndex === -1
          ? worktree.branch.slice(AGENT_BRANCH_PREFIX.length)
          : worktree.branch.slice(AGENT_BRANCH_PREFIX.length, slashIndex);

      if (!agentId) {
        continue;
      }

      // Skip worktrees that belong to an agent currently tracked by the pool.
      if (this.agents.has(agentId) || this.agentWorktrees.has(agentId)) {
        continue;
      }

      this.log.info(
        { agentId, branch: worktree.branch, worktreePath: worktree.path },
        'Removing orphaned agent worktree',
      );

      try {
        await this.worktreeManager.remove(agentId);
        this.log.info({ agentId }, 'Orphaned worktree removed');
      } catch (err) {
        this.log.warn({ agentId, err }, 'Failed to remove orphaned worktree');
      }
    }
  }

  get size(): number {
    return this.agents.size;
  }

  getRunningCount(): number {
    let count = 0;

    for (const instance of this.agents.values()) {
      const status = instance.getStatus();

      if (status === 'running' || status === 'starting') {
        count++;
      }
    }

    return count;
  }

  getMaxConcurrent(): number {
    return this.maxConcurrent;
  }

  /** Lifetime count of agents created through this pool. */
  getTotalAgentsStarted(): number {
    return this.totalAgentsStartedCount;
  }

  /** Number of active worktrees currently tracked by the pool. */
  getWorktreeCount(): number {
    return this.agentWorktrees.size;
  }

  /**
   * Return aggregate statistics across all agents in the pool.
   *
   * Includes a per-status breakdown, summed cost, and the longest-running
   * agent (oldest `startedAt` among those currently running).
   */
  getAgentStats(): AgentStats {
    const byStatus: Record<string, number> = {};
    let totalCostUsd = 0;
    let oldestAgent: { agentId: string; startedAt: string } | null = null;
    let oldestTime: number | null = null;

    for (const instance of this.agents.values()) {
      const json = instance.toJSON();
      const status = json.status as string;

      byStatus[status] = (byStatus[status] ?? 0) + 1;
      totalCostUsd += json.costUsd as number;

      // Track the longest-running agent (earliest startedAt among running agents).
      if (status === 'running' && json.startedAt) {
        const startedMs = new Date(json.startedAt as string).getTime();
        if (oldestTime === null || startedMs < oldestTime) {
          oldestTime = startedMs;
          oldestAgent = {
            agentId: json.agentId as string,
            startedAt: json.startedAt as string,
          };
        }
      }
    }

    return {
      poolSize: this.agents.size,
      byStatus,
      totalCostUsd,
      oldestAgent,
    };
  }
}
