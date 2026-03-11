import { execSync } from 'node:child_process';
import os from 'node:os';

import {
  type DispatchVerificationConfig,
  type ExecutionEnvironmentCapability,
  isDispatchVerificationConfig,
  WorkerError,
} from '@agentctl/shared';
import type { Logger } from 'pino';

import type { AgentPool } from './runtime/agent-pool.js';

const TAILSCALE_CLI_TIMEOUT_MS = 5_000;

type HealthReporterOptions = {
  machineId: string;
  controlPlaneUrl: string;
  intervalMs: number;
  logger: Logger;
  agentPool?: AgentPool;
  executionEnvironmentRegistry?: {
    detectAll: () => Promise<ExecutionEnvironmentCapability[]>;
    getDefault: () => Promise<ExecutionEnvironmentCapability | null>;
  };
};

/**
 * Resolves the Tailscale IPv4 address for this machine.
 *
 * Resolution order:
 *   1. `TAILSCALE_IP` environment variable (allows explicit override)
 *   2. Output of `tailscale ip -4` CLI command
 *   3. Falls back to `127.0.0.1` with a warning log
 */
async function resolveTailscaleIp(logger: Logger): Promise<string> {
  const envIp = process.env.TAILSCALE_IP;

  if (envIp) {
    logger.info({ tailscaleIp: envIp }, 'Using Tailscale IP from TAILSCALE_IP env var');
    return envIp;
  }

  try {
    const output = execSync('tailscale ip -4', {
      timeout: TAILSCALE_CLI_TIMEOUT_MS,
      encoding: 'utf-8',
    }).trim();

    if (output) {
      logger.info({ tailscaleIp: output }, 'Resolved Tailscale IP via CLI');
      return output;
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to resolve Tailscale IP via CLI, falling back to 127.0.0.1');
  }

  logger.warn(
    'Tailscale IP unavailable — using 127.0.0.1 (machine will not be reachable by peers)',
  );
  return '127.0.0.1';
}

export class HealthReporter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly machineId: string;
  private readonly controlPlaneUrl: string;
  private readonly intervalMs: number;
  private readonly logger: Logger;
  private readonly agentPool: AgentPool | null;
  private readonly executionEnvironmentRegistry: HealthReporterOptions['executionEnvironmentRegistry'];
  private tailscaleIp: string = '127.0.0.1';
  private dispatchVerificationConfig: DispatchVerificationConfig | null = null;

  constructor(options: HealthReporterOptions) {
    this.machineId = options.machineId;
    this.controlPlaneUrl = options.controlPlaneUrl;
    this.intervalMs = options.intervalMs;
    this.logger = options.logger;
    this.agentPool = options.agentPool ?? null;
    this.executionEnvironmentRegistry = options.executionEnvironmentRegistry;
  }

  async register(): Promise<void> {
    this.tailscaleIp = await resolveTailscaleIp(this.logger);

    try {
      const capabilities = await this.buildCapabilitiesSnapshot();
      const response = await fetch(`${this.controlPlaneUrl}/api/agents/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machineId: this.machineId,
          hostname: os.hostname(),
          tailscaleIp: this.tailscaleIp,
          os: process.platform === 'darwin' ? 'darwin' : 'linux',
          arch: process.arch === 'arm64' ? 'arm64' : 'x64',
          capabilities,
        }),
      });

      if (!response.ok) {
        throw new WorkerError('REGISTER_FAILED', `Registration returned ${response.status}`);
      }

      this.updateDispatchVerificationConfig(await readJsonBody(response));

      this.logger.info({ machineId: this.machineId }, 'Registered with control plane');
    } catch (err) {
      this.logger.warn(
        { err, machineId: this.machineId },
        'Failed to register (will retry via heartbeat)',
      );
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

  getDispatchVerificationConfig(): DispatchVerificationConfig | null {
    return this.dispatchVerificationConfig;
  }

  private getRunningAgentsSummary(): Array<{ agentId: string; sessionId: string | null }> {
    if (!this.agentPool) {
      return [];
    }

    return this.agentPool
      .listAgents()
      .filter((a) => a.status === 'running')
      .map((a) => ({ agentId: a.agentId, sessionId: a.sessionId }));
  }

  private async sendHeartbeat(): Promise<void> {
    const capabilities = await this.buildCapabilitiesSnapshot();
    const heartbeatRequest = () =>
      fetch(`${this.controlPlaneUrl}/api/agents/${this.machineId}/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machineId: this.machineId,
          runningAgents: this.getRunningAgentsSummary(),
          cpuPercent: (os.loadavg()[0] * 100) / os.cpus().length,
          memoryPercent: (1 - os.freemem() / os.totalmem()) * 100,
          capabilities,
        }),
      });

    const response = await heartbeatRequest();
    if (response.ok) {
      this.updateDispatchVerificationConfig(await readJsonBody(response));
      return;
    }

    this.logger.info(
      { machineId: this.machineId, statusCode: response.status },
      'Heartbeat rejected by control plane, retrying registration',
    );

    await this.register();

    const retryResponse = await heartbeatRequest();
    if (!retryResponse.ok) {
      throw new WorkerError(
        'HEARTBEAT_FAILED',
        `Heartbeat returned ${retryResponse.status} after registration retry`,
        {
          machineId: this.machineId,
          statusCode: retryResponse.status,
        },
      );
    }

    this.updateDispatchVerificationConfig(await readJsonBody(retryResponse));
  }

  private updateDispatchVerificationConfig(payload: unknown): void {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    const candidate = (payload as { dispatchVerification?: unknown }).dispatchVerification;
    if (!isDispatchVerificationConfig(candidate)) {
      return;
    }

    this.dispatchVerificationConfig = candidate;
  }

  private async buildCapabilitiesSnapshot(): Promise<{
    gpu: boolean;
    docker: boolean;
    maxConcurrentAgents: number;
    executionEnvironments?: ExecutionEnvironmentCapability[];
    defaultExecutionEnvironment?: ExecutionEnvironmentCapability['id'] | null;
  }> {
    const executionEnvironments = this.executionEnvironmentRegistry
      ? await this.executionEnvironmentRegistry.detectAll()
      : undefined;
    const defaultEnvironment = this.executionEnvironmentRegistry
      ? await this.executionEnvironmentRegistry.getDefault()
      : null;

    return {
      gpu: false,
      docker:
        executionEnvironments?.some(
          (capability) => capability.id === 'docker' && capability.available,
        ) ?? false,
      maxConcurrentAgents: this.agentPool?.getMaxConcurrent() ?? 3,
      ...(executionEnvironments ? { executionEnvironments } : {}),
      ...(defaultEnvironment ? { defaultExecutionEnvironment: defaultEnvironment.id } : {}),
    };
  }
}

async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
