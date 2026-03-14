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
  /** Provenance of each discovered/manual MCP server, keyed by server name. */
  mcpServerSources?: Record<string, 'discovered' | 'manual'>;
  /** Provenance of each discovered/manual skill, keyed by skill id. */
  skillSources?: Record<string, 'discovered' | 'manual'>;
  /** ISO timestamp of the last successful discovery scan. */
  lastDiscoveredAt?: string;
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
