// packages/shared/src/memory/ops.ts

export type MemoryOpsJobKind =
  | 'embedding-backfill'
  | 'drawer-backfill'
  | 'consolidation'
  | 'synthesis';

export type MemoryOpsJobStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type MemoryOpsProgress = {
  processed: number;
  embedded: number;
  failed: number;
  total: number;
  costUsd: number;
  usageEstimated: boolean;
  etaSeconds?: number;
  currentBatch?: number;
};

export type MemoryOpsJob = {
  id: string;
  kind: MemoryOpsJobKind;
  status: MemoryOpsJobStatus;
  params: Record<string, unknown>;
  progress: MemoryOpsProgress;
  result: Record<string, unknown> | null;
  error: string | null;
  errorCode: string | null;
  credentialId: string | null;
  providerKind: string | null;
  providerModel: string | null;
  providerHost: string | null;
  priceUsdPerMtoken: string | null;
  originMachineId: string;
  executorMachineId: string;
  cancelRequestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  egressConfirmedAt: string | null;
  egressConfirmedBy: string | null;
  egressSnapshot: Record<string, unknown> | null;
};

/** Normalize a scope string: trim + lowercase + treat blank as empty string. */
export function scopeNormalize(scope: string | undefined | null): string {
  return (scope ?? '').trim().toLowerCase();
}

export const MEMORY_OPS_JOB_KINDS = [
  'embedding-backfill',
  'drawer-backfill',
  'consolidation',
  'synthesis',
] as const satisfies MemoryOpsJobKind[];

export const REQUIRES_PROVIDER: Record<MemoryOpsJobKind, boolean> = {
  'embedding-backfill': true,
  'drawer-backfill': true,
  consolidation: false,
  synthesis: false,
};
