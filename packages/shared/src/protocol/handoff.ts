import type {
  HandoffReason,
  HandoffSnapshot,
  HandoffStrategy,
  ManagedRuntime,
  ManagedSession,
  ManagedSessionStatus,
} from '../types/runtime-management.js';

export type RuntimeSessionSummary = {
  runtime: ManagedRuntime;
  sessionId: string;
  nativeSessionId: string | null;
  agentId: string | null;
  projectPath: string;
  model: string | null;
  status: ManagedSessionStatus;
};

export type ExportHandoffSnapshotRequest = {
  sourceRuntime: ManagedRuntime;
  sourceSessionId: string;
  projectPath: string;
  worktreePath?: string | null;
  activeConfigRevision: number;
  reason: HandoffReason;
  prompt?: string | null;
  activeMcpServers?: string[];
  activeSkills?: string[];
};

export type ExportHandoffSnapshotResponse = {
  ok: true;
  strategy: 'snapshot-handoff';
  snapshot: HandoffSnapshot;
};

export type StartHandoffRequest = {
  targetRuntime: ManagedRuntime;
  agentId: string;
  projectPath: string;
  snapshot: HandoffSnapshot;
  prompt?: string | null;
  model?: string | null;
};

export type StartHandoffResponse = {
  ok: true;
  strategy: HandoffStrategy;
  attemptedStrategies: HandoffStrategy[];
  snapshot: HandoffSnapshot;
  session: RuntimeSessionSummary;
};

export type ManagedSessionHandoffResponse = {
  ok: true;
  handoffId: string;
  strategy: HandoffStrategy;
  attemptedStrategies: HandoffStrategy[];
  snapshot: HandoffSnapshot;
  session: ManagedSession;
};
