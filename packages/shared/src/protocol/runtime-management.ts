import type {
  HandoffReason,
  ManagedRuntime,
  ManagedRuntimeConfig,
  ManagedSession,
  ManualTakeoverPermissionMode,
  ManualTakeoverState,
} from '../types/runtime-management.js';

export type RuntimeCapabilityState = {
  installed: boolean;
  authenticated: boolean;
};

export type ApplyRuntimeConfigRequest = {
  machineId: string;
  config: ManagedRuntimeConfig;
};

export type ApplyRuntimeConfigResponse = {
  applied: boolean;
  machineId: string;
  configVersion: number;
  configHash: string;
  files: Array<{ path: string; hash: string }>;
  runtimes: Record<ManagedRuntime, RuntimeCapabilityState>;
};

export type RuntimeConfigSyncRequest = {
  machineIds: string[];
  configVersion: number;
};

export type RuntimeConfigSyncResponse = {
  queued: number;
  machineIds: string[];
  configVersion: number;
};

export type CreateManagedSessionRequest = {
  runtime: ManagedRuntime;
  machineId: string;
  agentId?: string | null;
  runId?: string | null;
  projectPath: string;
  prompt: string;
  model?: string | null;
};

export type ResumeManagedSessionRequest = {
  prompt: string;
  nativeSessionId?: string | null;
  model?: string | null;
};

export type ForkManagedSessionRequest = {
  prompt?: string | null;
  model?: string | null;
  targetMachineId?: string | null;
};

export type HandoffManagedSessionRequest = {
  targetRuntime: ManagedRuntime;
  reason: HandoffReason;
  targetMachineId?: string | null;
  prompt?: string | null;
};

export type ManagedSessionResponse = {
  ok: true;
  session: ManagedSession;
};

// Valid only for Claude managed runtime sessions in the first manual takeover slice.
export type StartManualTakeoverRequest = {
  permissionMode?: ManualTakeoverPermissionMode | null;
};

export type ManualTakeoverResponse = {
  ok: true;
  manualTakeover: ManualTakeoverState | null;
};
