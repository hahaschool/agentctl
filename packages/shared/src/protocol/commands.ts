export type StartAgentRequest = {
  prompt?: string;
  resumeSession?: string;
  model?: string;
  tools?: string[];
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
  capabilities: {
    gpu: boolean;
    docker: boolean;
    maxConcurrentAgents: number;
  };
};

export type HeartbeatRequest = {
  machineId: string;
  runningAgents: string[];
  cpuPercent: number;
  memoryPercent: number;
};

export type SignalAgentRequest = {
  prompt: string;
  metadata?: Record<string, unknown>;
};
