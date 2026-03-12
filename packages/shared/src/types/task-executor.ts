import type { TaskRun, TaskRunStatus } from './task-graph.js';

/**
 * Pluggable executor interface for task graph execution.
 * BullMQ now, Temporal later -- no domain rewrite needed.
 */
export type TaskExecutor = {
  submit(taskRun: TaskRun): Promise<void>;
  cancel(taskRunId: string): Promise<void>;
  getStatus(taskRunId: string): Promise<TaskRunStatus>;
};
