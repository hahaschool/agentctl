import { EventEmitter } from 'node:events';

import type { AgentEvent, AgentStatus } from '@agentctl/shared';
import { AgentError } from '@agentctl/shared';
import type { Logger } from 'pino';

import type { WorktreeManager } from '../worktree/index.js';
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

export class AgentPool extends EventEmitter {
  private readonly agents: Map<string, AgentInstance> = new Map();
  private readonly maxConcurrent: number;
  private readonly auditLogDir: string | undefined;
  private readonly log: Logger;
  private readonly worktreeManager: WorktreeManager | undefined;
  /** Tracks which agents have an active worktree so we can clean up on removal. */
  private readonly agentWorktrees: Set<string> = new Set();

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
    });

    // Forward agent events from the instance to the pool level,
    // enriching with the agentId for pool-level consumers.
    instance.onEvent((event: AgentEvent) => {
      this.emit('agent-event', { agentId: options.agentId, event });
    });

    this.agents.set(options.agentId, instance);

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
}
