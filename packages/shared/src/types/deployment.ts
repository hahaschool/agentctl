export const PROMOTION_STATUSES = ['pending', 'running', 'success', 'failed'] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];

export const PREFLIGHT_CHECK_NAMES = [
  'source_health',
  'target_health',
  'migration_parity',
  'build',
] as const;
export type PreflightCheckName = (typeof PREFLIGHT_CHECK_NAMES)[number];

export const PREFLIGHT_CHECK_STATUSES = ['pass', 'fail', 'running', 'skipped'] as const;
export type PreflightCheckStatus = (typeof PREFLIGHT_CHECK_STATUSES)[number];

export type PreflightCheckResult = {
  readonly name: PreflightCheckName;
  readonly status: PreflightCheckStatus;
  readonly message?: string;
  readonly durationMs?: number;
};

export type ServiceHealth = {
  readonly name: 'cp' | 'worker' | 'web';
  readonly port: number;
  readonly healthy: boolean;
  readonly memoryMb?: number;
  readonly uptimeSeconds?: number;
  readonly restarts?: number;
  readonly pid?: number;
};

export type TierConfig = {
  readonly name: string;
  readonly label: string;
  readonly cpPort: number;
  readonly workerPort: number;
  readonly webPort: number;
  readonly database: string;
  readonly redisDb: number;
};

export type TierStatus = {
  readonly name: string;
  readonly label: string;
  readonly status: 'running' | 'degraded' | 'stopped';
  readonly services: readonly ServiceHealth[];
  readonly config: TierConfig;
};

export type PromotionRecord = {
  readonly id: string;
  readonly sourceTier: string;
  readonly targetTier: string;
  readonly status: PromotionStatus;
  readonly checks: readonly PreflightCheckResult[];
  readonly error?: string;
  readonly gitSha?: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly triggeredBy: string;
};

export type PromotionEvent =
  | {
      readonly type: 'check';
      readonly name: string;
      readonly status: PreflightCheckStatus;
      readonly message?: string;
    }
  | { readonly type: 'step'; readonly step: string; readonly message: string }
  | { readonly type: 'log'; readonly line: string }
  | {
      readonly type: 'complete';
      readonly status: 'success' | 'failed';
      readonly durationMs: number;
      readonly error?: string;
      readonly failedStep?: string;
    };
