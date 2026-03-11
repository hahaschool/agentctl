import type { ManagedRuntime, ManagedSessionStatus } from '@agentctl/shared';

export type ManagedSessionHandle = {
  runtime: ManagedRuntime;
  sessionId: string;
  nativeSessionId: string | null;
  agentId: string | null;
  projectPath: string;
  model: string | null;
  status: ManagedSessionStatus;
  pid: number | null;
  startedAt: Date;
  lastActivity: Date | null;
};

/** Sandbox level sourced from ManagedRuntimeConfig.sandbox. */
export type ManagedSandboxLevel = 'read-only' | 'workspace-write' | 'danger-full-access';

export type StartManagedSessionInput = {
  agentId: string;
  projectPath: string;
  prompt: string;
  model?: string | null;
  /** Sandbox constraint level to enforce for the spawned runtime process. */
  sandboxLevel?: ManagedSandboxLevel | null;
};

export type ResumeManagedSessionInput = StartManagedSessionInput & {
  nativeSessionId: string;
};

export type ForkManagedSessionInput = {
  agentId: string;
  projectPath: string;
  nativeSessionId: string;
  prompt?: string | null;
  model?: string | null;
  /** Sandbox constraint level to enforce for the spawned runtime process. */
  sandboxLevel?: ManagedSandboxLevel | null;
};

export type RuntimeCapabilities = {
  runtime: ManagedRuntime;
  supportsResume: boolean;
  supportsFork: boolean;
};

export interface RuntimeAdapter {
  readonly runtime: ManagedRuntime;
  startSession(input: StartManagedSessionInput): Promise<ManagedSessionHandle>;
  resumeSession(input: ResumeManagedSessionInput): Promise<ManagedSessionHandle>;
  forkSession(input: ForkManagedSessionInput): Promise<ManagedSessionHandle>;
  getCapabilities(): Promise<RuntimeCapabilities>;
}
