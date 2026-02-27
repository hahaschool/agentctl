export type MachineStatus = 'online' | 'offline' | 'degraded';

export type MachineCapabilities = {
  gpu: boolean;
  docker: boolean;
  maxConcurrentAgents: number;
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
