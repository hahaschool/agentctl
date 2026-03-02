import { WorkerError } from '@agentctl/shared';

export type CheckpointData = {
  agentId: string;
  runId: string;
  iteration: number;
  totalCost: number;
  elapsedMs: number;
  lastResult?: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
};

export type CheckpointConfig = {
  /** Control plane base URL. */
  controlPlaneUrl: string;
  /** How often to checkpoint (in iterations). Default: 5. */
  checkpointInterval?: number;
  /** Maximum consecutive checkpoint failures before auto-pause. Default: 3. */
  maxCheckpointFailures?: number;
};

const DEFAULT_CHECKPOINT_INTERVAL = 5;
const DEFAULT_MAX_CHECKPOINT_FAILURES = 3;
const CHECKPOINT_TIMEOUT_MS = 10_000;

/**
 * Periodically reports loop status back to the control plane.
 *
 * Used by the LoopController to report progress at configurable intervals.
 * Tracks consecutive failures and signals when the loop should auto-pause.
 */
export class LoopCheckpoint {
  private readonly controlPlaneUrl: string;
  private readonly checkpointInterval: number;
  private readonly maxCheckpointFailures: number;
  private consecutiveFailures: number = 0;

  constructor(config: CheckpointConfig) {
    if (!config.controlPlaneUrl || typeof config.controlPlaneUrl !== 'string') {
      throw new WorkerError(
        'CHECKPOINT_INVALID_CONFIG',
        'controlPlaneUrl is required and must be a non-empty string',
        { controlPlaneUrl: config.controlPlaneUrl },
      );
    }

    this.controlPlaneUrl = config.controlPlaneUrl.replace(/\/+$/, '');
    this.checkpointInterval = Math.max(1, config.checkpointInterval ?? DEFAULT_CHECKPOINT_INTERVAL);
    this.maxCheckpointFailures = Math.max(
      1,
      config.maxCheckpointFailures ?? DEFAULT_MAX_CHECKPOINT_FAILURES,
    );
  }

  /**
   * Report a checkpoint to the control plane.
   * Returns true if successful, false on failure (does not throw).
   */
  async report(data: CheckpointData): Promise<boolean> {
    const url = `${this.controlPlaneUrl}/api/agents/${encodeURIComponent(data.agentId)}/checkpoint`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(CHECKPOINT_TIMEOUT_MS),
      });

      if (response.ok) {
        this.resetFailures();
        return true;
      }

      this.consecutiveFailures++;
      return false;
    } catch {
      this.consecutiveFailures++;
      return false;
    }
  }

  /**
   * Check if we should checkpoint at this iteration.
   * Returns true every `checkpointInterval` iterations (1-indexed).
   */
  shouldCheckpoint(iteration: number): boolean {
    if (iteration < 1) {
      return false;
    }
    return iteration % this.checkpointInterval === 0;
  }

  /**
   * Check if we should auto-pause due to too many consecutive checkpoint failures.
   */
  shouldAutoPause(): boolean {
    return this.consecutiveFailures >= this.maxCheckpointFailures;
  }

  /**
   * Reset the consecutive failure counter (e.g., after a successful checkpoint).
   */
  resetFailures(): void {
    this.consecutiveFailures = 0;
  }

  /**
   * Get the current number of consecutive failures.
   */
  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  /**
   * Get the configured checkpoint interval.
   */
  getCheckpointInterval(): number {
    return this.checkpointInterval;
  }

  /**
   * Get the configured max checkpoint failures threshold.
   */
  getMaxCheckpointFailures(): number {
    return this.maxCheckpointFailures;
  }
}
