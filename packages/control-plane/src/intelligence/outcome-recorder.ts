import type { RoutingOutcomeStatus, SpaceEvent } from '@agentctl/shared';
import { isRoutingOutcomeStatus } from '@agentctl/shared';
import type { Logger } from 'pino';

import type { EventBus } from '../collaboration/event-bus.js';
import type { RoutingStore } from '../collaboration/routing-store.js';
import type { TaskRunStore } from '../collaboration/task-run-store.js';

type OutcomeRecorderDeps = {
  readonly eventBus: EventBus;
  readonly routingStore: RoutingStore;
  readonly taskRunStore: TaskRunStore;
  readonly logger: Logger;
};

/**
 * Subscribes to task-state events and records routing outcomes
 * when a task run reaches a terminal status (completed, failed, cancelled).
 */
export class OutcomeRecorder {
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: OutcomeRecorderDeps) {}

  /**
   * Start listening on the given spaceId for task completion events.
   */
  start(spaceId: string): void {
    if (this.unsubscribe) {
      return;
    }

    this.unsubscribe = this.deps.eventBus.subscribe(spaceId, (event) => {
      this.handleEvent(event).catch((err) => {
        this.deps.logger.error({ err, eventId: event.id }, 'OutcomeRecorder event handling failed');
      });
    });

    this.deps.logger.info({ spaceId }, 'OutcomeRecorder started');
  }

  /**
   * Stop listening for events.
   */
  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
      this.deps.logger.info('OutcomeRecorder stopped');
    }
  }

  private async handleEvent(event: SpaceEvent): Promise<void> {
    if (event.type !== 'task-state') {
      return;
    }

    const payload = event.payload as Record<string, unknown> | undefined;
    if (!payload) {
      return;
    }

    const status = payload.status as string | undefined;
    if (!status || !isRoutingOutcomeStatus(status)) {
      return;
    }

    const taskRunId = payload.taskRunId as string | undefined;
    if (!taskRunId) {
      return;
    }

    await this.recordOutcome(taskRunId, status);
  }

  private async recordOutcome(taskRunId: string, status: RoutingOutcomeStatus): Promise<void> {
    try {
      const taskRun = await this.deps.taskRunStore.getRun(taskRunId);
      if (!taskRun) {
        this.deps.logger.warn({ taskRunId }, 'Task run not found for outcome recording');
        return;
      }

      // Skip if we don't know the assignee or machine
      if (!taskRun.assigneeInstanceId || !taskRun.machineId) {
        this.deps.logger.debug(
          { taskRunId },
          'Task run has no assignee/machine, skipping outcome recording',
        );
        return;
      }

      // Look up the routing decision for this task run
      const decision = await this.deps.routingStore.getDecisionByTaskRun(taskRunId);

      // Compute duration
      const durationMs =
        taskRun.startedAt && taskRun.completedAt
          ? new Date(taskRun.completedAt).getTime() - new Date(taskRun.startedAt).getTime()
          : null;

      // Extract cost from result payload if available
      const result = taskRun.result as Record<string, unknown> | null;
      const costUsd = typeof result?.costUsd === 'number' ? result.costUsd : null;
      const tokensUsed = typeof result?.tokensUsed === 'number' ? result.tokensUsed : null;
      const errorCode =
        taskRun.error && typeof (taskRun.error as Record<string, unknown>).code === 'string'
          ? ((taskRun.error as Record<string, unknown>).code as string)
          : null;

      await this.deps.routingStore.recordOutcome({
        routingDecisionId: decision?.id ?? null,
        taskRunId,
        profileId: taskRun.assigneeInstanceId, // instance ID maps to profile in the decision
        nodeId: taskRun.machineId,
        capabilities: decision?.breakdown
          ? [] // capabilities would come from the task definition
          : [],
        status,
        durationMs,
        costUsd,
        tokensUsed,
        errorCode,
      });

      this.deps.logger.info({ taskRunId, status }, 'Routing outcome recorded');
    } catch (err) {
      this.deps.logger.error({ err, taskRunId, status }, 'Failed to record routing outcome');
    }
  }
}
