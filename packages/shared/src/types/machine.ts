import type {
  ExecutionEnvironmentCapability,
  ExecutionEnvironmentId,
} from './runtime-management.js';

export type MachineStatus = 'online' | 'offline' | 'degraded';

export type MachineCapabilities = {
  gpu: boolean;
  docker: boolean;
  maxConcurrentAgents: number;
  executionEnvironments?: ExecutionEnvironmentCapability[];
  defaultExecutionEnvironment?: ExecutionEnvironmentId | null;
};

export type Machine = {
  id: string;
  hostname: string;
  tailscaleIp: string;
  os: 'linux' | 'darwin';
  arch: 'x64' | 'arm64';
  status: MachineStatus;
  lastHeartbeat: Date | null;
  capabilities: MachineCapabilities;
  createdAt: Date;
};
