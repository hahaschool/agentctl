import os from 'node:os';

import type { Logger } from 'pino';

import { WorkerError } from '@agentctl/shared';

type HealthReporterOptions = {
  machineId: string;
  controlPlaneUrl: string;
  intervalMs: number;
  logger: Logger;
};

export class HealthReporter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly machineId: string;
  private readonly controlPlaneUrl: string;
  private readonly intervalMs: number;
  private readonly logger: Logger;

  constructor(options: HealthReporterOptions) {
    this.machineId = options.machineId;
    this.controlPlaneUrl = options.controlPlaneUrl;
    this.intervalMs = options.intervalMs;
    this.logger = options.logger;
  }

  async register(): Promise<void> {
    try {
      const response = await fetch(`${this.controlPlaneUrl}/api/agents/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machineId: this.machineId,
          hostname: os.hostname(),
          tailscaleIp: '100.0.0.0', // TODO: resolve from Tailscale
          os: process.platform === 'darwin' ? 'darwin' : 'linux',
          arch: process.arch === 'arm64' ? 'arm64' : 'x64',
          capabilities: {
            gpu: false,
            docker: false,
            maxConcurrentAgents: 3,
          },
        }),
      });

      if (!response.ok) {
        throw new WorkerError('REGISTER_FAILED', `Registration returned ${response.status}`);
      }

      this.logger.info({ machineId: this.machineId }, 'Registered with control plane');
    } catch (err) {
      this.logger.warn({ err, machineId: this.machineId }, 'Failed to register (will retry via heartbeat)');
    }
  }

  start(): void {
    this.timer = setInterval(() => {
      this.sendHeartbeat().catch((err) => {
        this.logger.warn({ err, machineId: this.machineId }, 'Heartbeat failed');
      });
    }, this.intervalMs);

    this.logger.info({ intervalMs: this.intervalMs }, 'Health reporter started');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async sendHeartbeat(): Promise<void> {
    await fetch(`${this.controlPlaneUrl}/api/agents/${this.machineId}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        machineId: this.machineId,
        runningAgents: [], // TODO: populate from agent pool
        cpuPercent: os.loadavg()[0] * 100 / os.cpus().length,
        memoryPercent: (1 - os.freemem() / os.totalmem()) * 100,
      }),
    });
  }
}
