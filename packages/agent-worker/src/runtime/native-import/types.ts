import type {
  HandoffSnapshot,
  ManagedRuntime,
  NativeImportAttempt,
  NativeImportAttemptReason,
} from '@agentctl/shared';

import type { ManagedSessionHandle } from '../runtime-adapter.js';

export type NativeImportProbeInput = {
  agentId: string;
  projectPath: string;
  prompt?: string | null;
  model?: string | null;
  snapshot: HandoffSnapshot;
};

export type NativeImportAttemptResult = NativeImportAttempt & {
  session?: ManagedSessionHandle;
};

export function failedNativeImportAttempt(input: {
  sourceRuntime: ManagedRuntime;
  targetRuntime: ManagedRuntime;
  reason: NativeImportAttemptReason;
  metadata?: Record<string, unknown>;
}): NativeImportAttemptResult {
  return {
    ok: false,
    sourceRuntime: input.sourceRuntime,
    targetRuntime: input.targetRuntime,
    reason: input.reason,
    metadata: input.metadata ?? {},
  };
}
