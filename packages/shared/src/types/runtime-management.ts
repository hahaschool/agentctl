export const MANAGED_RUNTIMES = ['claude-code', 'codex'] as const;

export type ManagedRuntime = (typeof MANAGED_RUNTIMES)[number];

export const EXECUTION_ENVIRONMENTS = ['direct', 'docker'] as const;

export type ExecutionEnvironmentId = (typeof EXECUTION_ENVIRONMENTS)[number];

export type ExecutionEnvironmentCapability = {
  id: ExecutionEnvironmentId;
  available: boolean;
  isDefault: boolean;
  isolation: 'host' | 'container';
  reasonUnavailable?: string | null;
  metadata: Record<string, unknown>;
};

export type ManagedExecutionRequirements = {
  environment?: ExecutionEnvironmentId | null;
};

export const MANAGED_SESSION_STATUSES = [
  'starting',
  'active',
  'paused',
  'handing_off',
  'ended',
  'error',
] as const;

export type ManagedSessionStatus = (typeof MANAGED_SESSION_STATUSES)[number];

export const MANUAL_TAKEOVER_STATUSES = [
  'starting',
  'online',
  'reconnecting',
  'stopped',
  'error',
] as const;

export type ManualTakeoverStatus = (typeof MANUAL_TAKEOVER_STATUSES)[number];

export const MANUAL_TAKEOVER_PERMISSION_MODES = ['default', 'accept-edits', 'plan'] as const;

export type ManualTakeoverPermissionMode = (typeof MANUAL_TAKEOVER_PERMISSION_MODES)[number];

export const HANDOFF_STRATEGIES = ['native-import', 'snapshot-handoff'] as const;

export type HandoffStrategy = (typeof HANDOFF_STRATEGIES)[number];

export const HANDOFF_REASONS = [
  'manual',
  'model-affinity',
  'cost-optimization',
  'rate-limit-failover',
] as const;

export type HandoffReason = (typeof HANDOFF_REASONS)[number];

export type ManagedInstructionBundle = {
  userGlobal: string;
  projectTemplate: string;
};

export type ManagedMcpServer = {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
};

export type ManagedSkill = {
  id: string;
  path: string;
  enabled: boolean;
};

export type ManagedEnvironmentPolicy = {
  inherit: string[];
  set: Record<string, string>;
};

export type ManagedRuntimeOverrideMap = Partial<
  Record<ManagedRuntime extends string ? ManagedRuntime : never, Record<string, unknown>>
> & {
  claudeCode?: Record<string, unknown>;
  codex?: Record<string, unknown>;
};

export type ManagedRuntimeConfig = {
  version: number;
  hash: string;
  instructions: ManagedInstructionBundle;
  mcpServers: ManagedMcpServer[];
  skills: ManagedSkill[];
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
  approvalPolicy: 'untrusted' | 'on-failure' | 'on-request' | 'never';
  environmentPolicy: ManagedEnvironmentPolicy;
  runtimeOverrides: {
    claudeCode?: Record<string, unknown>;
    codex?: Record<string, unknown>;
  };
};

export type ManagedSession = {
  id: string;
  runtime: ManagedRuntime;
  nativeSessionId: string | null;
  machineId: string;
  agentId: string | null;
  projectPath: string;
  worktreePath: string | null;
  status: ManagedSessionStatus;
  configRevision: number;
  executionEnvironment?: ExecutionEnvironmentId | null;
  handoffStrategy: HandoffStrategy | null;
  handoffSourceSessionId: string | null;
  metadata: Record<string, unknown>;
};

export type ManualTakeoverState = {
  workerSessionId: string;
  nativeSessionId: string;
  projectPath: string;
  status: ManualTakeoverStatus;
  permissionMode: ManualTakeoverPermissionMode;
  sessionUrl: string | null;
  startedAt: string;
  lastHeartbeat: string | null;
  lastVerifiedAt: string | null;
  error: string | null;
};

export type HandoffSnapshot = {
  sourceRuntime: ManagedRuntime;
  sourceSessionId: string;
  sourceNativeSessionId: string | null;
  projectPath: string;
  worktreePath: string | null;
  branch: string | null;
  headSha: string | null;
  dirtyFiles: string[];
  diffSummary: string;
  conversationSummary: string;
  openTodos: string[];
  nextSuggestedPrompt: string;
  activeConfigRevision: number;
  activeMcpServers: string[];
  activeSkills: string[];
  reason: HandoffReason;
};

export function isManagedRuntime(value: string): value is ManagedRuntime {
  return (MANAGED_RUNTIMES as readonly string[]).includes(value);
}

export function isExecutionEnvironmentId(value: string): value is ExecutionEnvironmentId {
  return (EXECUTION_ENVIRONMENTS as readonly string[]).includes(value);
}

export function isManagedSessionStatus(value: string): value is ManagedSessionStatus {
  return (MANAGED_SESSION_STATUSES as readonly string[]).includes(value);
}

export function isManualTakeoverStatus(value: string): value is ManualTakeoverStatus {
  return (MANUAL_TAKEOVER_STATUSES as readonly string[]).includes(value);
}

export function isManualTakeoverPermissionMode(
  value: string,
): value is ManualTakeoverPermissionMode {
  return (MANUAL_TAKEOVER_PERMISSION_MODES as readonly string[]).includes(value);
}

export function isHandoffStrategy(value: string): value is HandoffStrategy {
  return (HANDOFF_STRATEGIES as readonly string[]).includes(value);
}
