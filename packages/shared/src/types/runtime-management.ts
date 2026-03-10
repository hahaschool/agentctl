export const MANAGED_RUNTIMES = ['claude-code', 'codex'] as const;

export type ManagedRuntime = (typeof MANAGED_RUNTIMES)[number];

export const MANAGED_SESSION_STATUSES = [
  'starting',
  'active',
  'paused',
  'handing_off',
  'ended',
  'error',
] as const;

export type ManagedSessionStatus = (typeof MANAGED_SESSION_STATUSES)[number];

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
  handoffStrategy: HandoffStrategy | null;
  handoffSourceSessionId: string | null;
  metadata: Record<string, unknown>;
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

export function isManagedSessionStatus(value: string): value is ManagedSessionStatus {
  return (MANAGED_SESSION_STATUSES as readonly string[]).includes(value);
}

export function isHandoffStrategy(value: string): value is HandoffStrategy {
  return (HANDOFF_STRATEGIES as readonly string[]).includes(value);
}
