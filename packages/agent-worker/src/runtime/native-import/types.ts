import type { HandoffSnapshot, ManagedRuntime } from '@agentctl/shared';

import type { ManagedSessionHandle } from '../runtime-adapter.js';

export type NativeImportProbeInput = {
  agentId: string;
  projectPath: string;
  prompt?: string | null;
  model?: string | null;
  snapshot: HandoffSnapshot;
};

export type NativeImportAttemptResult = {
  ok: boolean;
  sourceRuntime: ManagedRuntime;
  targetRuntime: ManagedRuntime;
  reason: string;
  metadata: Record<string, unknown>;
  session?: ManagedSessionHandle;
};
