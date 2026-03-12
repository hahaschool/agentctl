import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { ExecutionEnvironmentCapability } from '@agentctl/shared';
import { WorkerError } from '@agentctl/shared';

import type {
  ExecutionEnvironment,
  ExecutionEnvironmentPreparation,
  PrepareExecutionEnvironmentInput,
} from './execution-environment.js';

const execFileAsync = promisify(execFile);

// ── Constants ───────────────────────────────────────────────────────

const DOCKER_ENVIRONMENT_ID = 'docker' as const;

const DEFAULT_AGENT_IMAGE = 'agentctl/agent-runner:latest';

const DOCKER_EXEC_TIMEOUT_MS = 30_000;

/**
 * Security-sensitive host paths that must never be mounted into an agent container.
 * These are checked against both explicit mounts and the worktree path itself.
 */
const BLOCKED_MOUNT_PATHS: readonly string[] = ['.ssh', '.gnupg', '.aws', '.env', 'credentials'];

// ── Types ───────────────────────────────────────────────────────────

type DockerEnvironmentOptions = {
  agentImage?: string;
  enableGvisor?: boolean;
  networkMode?: 'none' | 'bridge' | 'host';
  extraDockerArgs?: readonly string[];
};

type DockerCleanupToken = {
  containerId: string;
  containerName: string;
};

// ── Helpers ─────────────────────────────────────────────────────────

function containsBlockedPath(hostPath: string): boolean {
  const segments = hostPath.split('/');
  return segments.some((segment) => BLOCKED_MOUNT_PATHS.some((blocked) => segment === blocked));
}

function buildContainerName(executionRoot: string): string {
  const slug = executionRoot
    .replace(/^\/+/, '')
    .replace(/[^a-zA-Z0-9_.-]/g, '-')
    .slice(0, 60);
  const suffix = randomUUID().slice(0, 8);
  return `agentctl-${slug}-${suffix}`;
}

function buildRunArgs(input: {
  containerName: string;
  image: string;
  executionRoot: string;
  worktreePath: string | null;
  runtimeHomeDir: string | null;
  env: Record<string, string>;
  enableGvisor: boolean;
  networkMode: 'none' | 'bridge' | 'host';
  extraDockerArgs: readonly string[];
}): string[] {
  const args: string[] = [
    'run',
    '--detach',
    `--name=${input.containerName}`,
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--read-only',
  ];

  if (input.enableGvisor) {
    args.push('--runtime=runsc');
  }

  args.push(`--network=${input.networkMode}`);

  // Mount the worktree (or executionRoot) as the single writable volume.
  const mountSource = input.worktreePath ?? input.executionRoot;
  args.push(`--volume=${mountSource}:/workspace:rw`);

  // Provide a writable /tmp inside the container for the agent runtime.
  args.push('--tmpfs=/tmp:rw,noexec,nosuid,size=256m');

  if (input.runtimeHomeDir) {
    args.push(`--volume=${input.runtimeHomeDir}:/home/agent:ro`);
  }

  // Forward environment variables.
  for (const [key, value] of Object.entries(input.env)) {
    args.push(`--env=${key}=${value}`);
  }

  // Set the working directory inside the container.
  args.push('--workdir=/workspace');

  // Append any extra Docker args provided by the caller.
  for (const extra of input.extraDockerArgs) {
    args.push(extra);
  }

  args.push(input.image);

  return args;
}

// ── DockerEnvironment ───────────────────────────────────────────────

export class DockerEnvironment implements ExecutionEnvironment {
  readonly id = DOCKER_ENVIRONMENT_ID;
  readonly name = 'Docker Environment (gVisor)';

  private readonly agentImage: string;
  private readonly enableGvisor: boolean;
  private readonly networkMode: 'none' | 'bridge' | 'host';
  private readonly extraDockerArgs: readonly string[];

  constructor(options: DockerEnvironmentOptions = {}) {
    this.agentImage = options.agentImage ?? DEFAULT_AGENT_IMAGE;
    this.enableGvisor = options.enableGvisor ?? true;
    this.networkMode = options.networkMode ?? 'none';
    this.extraDockerArgs = options.extraDockerArgs ?? [];
  }

  async detect(): Promise<ExecutionEnvironmentCapability> {
    const dockerAvailable = await this.isDockerAvailable();
    if (!dockerAvailable) {
      return {
        id: this.id,
        available: false,
        isDefault: false,
        isolation: 'container',
        reasonUnavailable: 'Docker is not installed or not running',
        metadata: { gvisorAvailable: false },
      };
    }

    const gvisorAvailable = this.enableGvisor ? await this.isGvisorAvailable() : false;

    if (this.enableGvisor && !gvisorAvailable) {
      return {
        id: this.id,
        available: false,
        isDefault: false,
        isolation: 'container',
        reasonUnavailable: 'gVisor runtime (runsc) is not available',
        metadata: { dockerAvailable: true, gvisorAvailable: false },
      };
    }

    return {
      id: this.id,
      available: true,
      isDefault: false,
      isolation: 'container',
      reasonUnavailable: null,
      metadata: {
        dockerAvailable: true,
        gvisorAvailable,
        agentImage: this.agentImage,
        networkMode: this.networkMode,
      },
    };
  }

  async prepare(input: PrepareExecutionEnvironmentInput): Promise<ExecutionEnvironmentPreparation> {
    const mountSource = input.worktreePath ?? input.executionRoot;

    if (containsBlockedPath(mountSource)) {
      throw new WorkerError(
        'DOCKER_BLOCKED_MOUNT',
        `Worktree path contains a security-sensitive directory: ${mountSource}`,
        { mountSource },
      );
    }

    const containerName = buildContainerName(input.executionRoot);
    const env = { ...(input.env ?? {}) };

    const runArgs = buildRunArgs({
      containerName,
      image: this.agentImage,
      executionRoot: input.executionRoot,
      worktreePath: input.worktreePath ?? null,
      runtimeHomeDir: input.runtimeHomeDir ?? null,
      env,
      enableGvisor: this.enableGvisor,
      networkMode: this.networkMode,
      extraDockerArgs: this.extraDockerArgs,
    });

    const cleanupToken: DockerCleanupToken = {
      containerId: '', // populated after `docker run`
      containerName,
    };

    return {
      environmentId: this.id,
      executionRoot: '/workspace',
      worktreePath: '/workspace',
      runtimeHomeDir: input.runtimeHomeDir ? '/home/agent' : null,
      env,
      spawnContext: {
        containerName,
        runArgs,
        image: this.agentImage,
        hostWorkDir: mountSource,
      },
      metadata: {
        isolation: 'container',
        supportsPersistentWorktree: false,
        supportsContainerBoundary: true,
        enableGvisor: this.enableGvisor,
        networkMode: this.networkMode,
        ...(input.metadata ?? {}),
      },
      cleanupToken,
    };
  }

  async cleanup(preparation: ExecutionEnvironmentPreparation): Promise<void> {
    const token = preparation.cleanupToken as DockerCleanupToken | undefined;
    if (!token) {
      return;
    }

    const target = token.containerId || token.containerName;
    if (!target) {
      return;
    }

    try {
      await execFileAsync('docker', ['stop', '--time=10', target], {
        timeout: DOCKER_EXEC_TIMEOUT_MS,
      });
    } catch {
      // Container may already be stopped; proceed to remove.
    }

    try {
      await execFileAsync('docker', ['rm', '--force', target], {
        timeout: DOCKER_EXEC_TIMEOUT_MS,
      });
    } catch {
      // Best-effort removal; if it fails the container is likely already gone.
    }
  }

  // ── Private helpers ─────────────────────────────────────────────

  private async isDockerAvailable(): Promise<boolean> {
    try {
      await execFileAsync('docker', ['info', '--format', '{{.ServerVersion}}'], {
        timeout: DOCKER_EXEC_TIMEOUT_MS,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async isGvisorAvailable(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('docker', ['info', '--format', '{{.Runtimes}}'], {
        timeout: DOCKER_EXEC_TIMEOUT_MS,
      });
      return stdout.includes('runsc');
    } catch {
      return false;
    }
  }
}

export { buildRunArgs, containsBlockedPath, buildContainerName, BLOCKED_MOUNT_PATHS };
export type { DockerEnvironmentOptions, DockerCleanupToken };
