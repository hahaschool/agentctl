import type { AgentProfile, AggregateStats, SpaceEvent } from '@agentctl/shared';
import type { Logger } from 'pino';

import type { AgentProfileStore } from '../collaboration/agent-profile-store.js';
import type { EventBus } from '../collaboration/event-bus.js';
import type { RoutingStore } from '../collaboration/routing-store.js';
import type { TaskGraphStore } from '../collaboration/task-graph-store.js';
import type { TaskRunStore } from '../collaboration/task-run-store.js';
import type { WorkerNodeStore } from '../collaboration/worker-node-store.js';
import type { RoutingEngine, StatsMap } from './routing-engine.js';

const DEFAULT_AUTO_ASSIGN_THRESHOLD = 0.5;

type AutoAssignerDeps = {
  readonly eventBus: EventBus;
  readonly routingEngine: RoutingEngine;
  readonly routingStore: RoutingStore;
  readonly taskGraphStore: TaskGraphStore;
  readonly taskRunStore: TaskRunStore;
  readonly agentProfileStore: AgentProfileStore;
  readonly workerNodeStore: WorkerNodeStore;
  readonly logger: Logger;
  readonly autoAssignThreshold?: number;
};

/**
 * Subscribes to task-state events and auto-assigns agents to ready tasks
 * when the top routing candidate exceeds the configured threshold.
 */
export class AutoAssigner {
  private readonly threshold: number;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: AutoAssignerDeps) {
    this.threshold = deps.autoAssignThreshold ?? DEFAULT_AUTO_ASSIGN_THRESHOLD;
  }

  /**
   * Start listening on the given spaceId for task-state events.
   */
  start(spaceId: string): void {
    if (this.unsubscribe) {
      return; // already subscribed
    }

    this.unsubscribe = this.deps.eventBus.subscribe(spaceId, (event) => {
      this.handleEvent(event).catch((err) => {
        this.deps.logger.error({ err, eventId: event.id }, 'AutoAssigner event handling failed');
      });
    });

    this.deps.logger.info({ spaceId }, 'AutoAssigner started');
  }

  /**
   * Stop listening for events.
   */
  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
      this.deps.logger.info('AutoAssigner stopped');
    }
  }

  private async handleEvent(event: SpaceEvent): Promise<void> {
    // Only interested in task-state events indicating a task is ready
    if (event.type !== 'task-state') {
      return;
    }

    const payload = event.payload as Record<string, unknown> | undefined;
    if (!payload || payload.status !== 'pending') {
      return;
    }

    const taskRunId = payload.taskRunId as string | undefined;
    const definitionId = payload.definitionId as string | undefined;

    if (!taskRunId || !definitionId) {
      return;
    }

    this.deps.logger.info({ taskRunId, definitionId }, 'AutoAssigner evaluating task');

    try {
      await this.evaluateAndAssign(taskRunId, definitionId);
    } catch (err) {
      this.deps.logger.error({ err, taskRunId, definitionId }, 'Auto-assignment evaluation failed');
    }
  }

  private async evaluateAndAssign(taskRunId: string, definitionId: string): Promise<void> {
    // Look up the task definition for required capabilities
    const definition = await this.deps.taskGraphStore.getDefinition(definitionId);
    if (!definition) {
      this.deps.logger.warn({ definitionId }, 'Task definition not found for auto-assign');
      return;
    }

    const profiles = await this.deps.agentProfileStore.listProfiles();
    const nodes = await this.deps.workerNodeStore.listNodes();

    // Gather all instances across profiles
    const instanceArrays = await Promise.all(
      profiles.map((p) => this.deps.agentProfileStore.listInstancesByProfile(p.id)),
    );
    const instances = instanceArrays.flat();

    // Gather stats for each profile
    const statsMap = await this.buildStatsMap(profiles, definition.requiredCapabilities);

    const candidates = this.deps.routingEngine.rankCandidates(
      {
        taskDefinitionId: definitionId,
        requiredCapabilities: definition.requiredCapabilities,
        estimatedTokens: definition.estimatedTokens,
      },
      profiles,
      nodes,
      instances,
      statsMap,
    );

    if (candidates.length === 0) {
      this.deps.logger.info({ definitionId }, 'No eligible candidates for auto-assignment');
      return;
    }

    const topCandidate = candidates[0];

    if (topCandidate.score < this.threshold) {
      this.deps.logger.info(
        { definitionId, topScore: topCandidate.score, threshold: this.threshold },
        'Top candidate below threshold, skipping auto-assign',
      );
      return;
    }

    // Record the routing decision
    await this.deps.routingStore.recordDecision({
      taskDefId: definitionId,
      taskRunId,
      profileId: topCandidate.profileId,
      nodeId: topCandidate.nodeId,
      score: topCandidate.score,
      breakdown: topCandidate.breakdown,
      mode: 'auto',
    });

    this.deps.logger.info(
      {
        taskRunId,
        profileId: topCandidate.profileId,
        nodeId: topCandidate.nodeId,
        score: topCandidate.score,
      },
      'Auto-assigned task to agent',
    );
  }

  private async buildStatsMap(
    profiles: readonly AgentProfile[],
    capabilities: readonly string[],
  ): Promise<StatsMap> {
    const map = new Map<string, AggregateStats>();

    for (const profile of profiles) {
      try {
        const stats = await this.deps.routingStore.getAggregateStats(profile.id, capabilities);
        map.set(profile.id, stats);
      } catch {
        // If stats lookup fails, skip -- the engine uses neutral defaults
      }
    }

    return map;
  }
}
