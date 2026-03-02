export type LoopMode = 'result-feedback' | 'fixed-prompt' | 'callback';

export type LoopConfig = {
  mode: LoopMode;
  /** Maximum number of iterations before the loop stops. At least one limit is required. */
  maxIterations?: number;
  /** Maximum total cost in USD before the loop stops. At least one limit is required. */
  costLimitUsd?: number;
  /** Maximum wall-clock duration in milliseconds before the loop stops. At least one limit is required. */
  maxDurationMs?: number;
  /** Delay between iterations in milliseconds. Minimum 500, default 1000. */
  iterationDelayMs?: number;
  /** Prompt to use every iteration when mode is 'fixed-prompt'. */
  fixedPrompt?: string;
};

export type LoopStatus = 'running' | 'paused' | 'completed' | 'stopped' | 'error';

export type LoopState = {
  status: LoopStatus;
  iteration: number;
  totalCostUsd: number;
  startedAt: Date;
  lastIterationAt: Date | null;
};
