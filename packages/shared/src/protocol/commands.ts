import type { MachineCapabilities } from '../types/machine.js';

export type StartAgentRequest = {
  prompt?: string;
  resumeSession?: string;
  model?: string;
  allowedTools?: string[];
};

export type StopAgentRequest = {
  reason: 'user' | 'timeout' | 'error' | 'schedule';
  graceful: boolean;
};

export type SendMessageRequest = {
  content: string;
  approval?: boolean;
};

export type RegisterWorkerRequest = {
  machineId: string;
  hostname: string;
  tailscaleIp: string;
  os: 'linux' | 'darwin';
  arch: 'x64' | 'arm64';
  capabilities: MachineCapabilities;
};

export type HeartbeatRequest = {
  machineId: string;
  runningAgents: Array<{ agentId: string; sessionId: string | null }>;
  cpuPercent: number;
  memoryPercent: number;
  capabilities?: MachineCapabilities;
};

export type SignalAgentRequest = {
  prompt: string;
  metadata?: Record<string, unknown>;
};

export const WORKDIR_SAFETY_TIERS = ['safe', 'guarded', 'risky', 'unsafe'] as const;

export type WorkdirSafetyTier = (typeof WORKDIR_SAFETY_TIERS)[number];

export const SAFETY_DECISIONS = ['approve', 'reject', 'sandbox'] as const;

export type SafetyDecision = (typeof SAFETY_DECISIONS)[number];

export type SafetyDecisionRequest = {
  decision: SafetyDecision;
};
