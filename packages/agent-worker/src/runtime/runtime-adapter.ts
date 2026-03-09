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

export type StartManagedSessionInput = {
  agentId: string;
  projectPath: string;
  prompt: string;
  model?: string | null;
};

export type ResumeManagedSessionInput = StartManagedSessionInput & {
  nativeSessionId: string;
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
  getCapabilities(): Promise<RuntimeCapabilities>;
}
