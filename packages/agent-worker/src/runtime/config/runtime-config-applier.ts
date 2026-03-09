import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import type {
  ApplyRuntimeConfigRequest,
  ApplyRuntimeConfigResponse,
  ManagedRuntime,
  RuntimeCapabilityState,
} from '@agentctl/shared';

import { ClaudeConfigRenderer } from './claude-config-renderer.js';
import { CodexConfigRenderer } from './codex-config-renderer.js';
import type { RenderedConfigFile } from './shared-rendering.js';

export type RuntimeCapabilityProbe = (
  runtime: ManagedRuntime,
) => Promise<RuntimeCapabilityState> | RuntimeCapabilityState;

export type WorkerRuntimeConfigState = {
  machineId: string;
  workspaceRoot: string;
  lastAppliedConfigVersion: number | null;
  lastAppliedConfigHash: string | null;
  runtimes: Record<ManagedRuntime, RuntimeCapabilityState>;
};

export type RuntimeConfigApplierOptions = {
  workspaceRoot?: string;
  homeDir?: string;
  probeRuntime?: RuntimeCapabilityProbe;
};

export class RuntimeConfigApplier {
  private readonly workspaceRoot: string;
  private readonly homeDir: string;
  private readonly probeRuntime: RuntimeCapabilityProbe;
  private lastAppliedConfigVersion: number | null = null;
  private lastAppliedConfigHash: string | null = null;

  constructor(options: RuntimeConfigApplierOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.homeDir = options.homeDir ?? homedir();
    this.probeRuntime = options.probeRuntime ?? ((runtime) => defaultProbeRuntime(runtime, this.homeDir));
  }

  async apply(request: ApplyRuntimeConfigRequest): Promise<ApplyRuntimeConfigResponse> {
    const claudeFiles = new ClaudeConfigRenderer().render(request.config).files;
    const codexFiles = new CodexConfigRenderer().render(request.config).files;
    const renderedFiles = [...claudeFiles, ...codexFiles];

    const files = [];
    for (const file of renderedFiles) {
      const targetPath = resolveTargetPath(file, this.workspaceRoot, this.homeDir);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, file.content, 'utf-8');
      files.push({
        path: file.path,
        hash: sha256(file.content),
      });
    }

    const runtimes = await this.probeAllRuntimes();
    this.lastAppliedConfigVersion = request.config.version;
    this.lastAppliedConfigHash = request.config.hash;

    return {
      applied: true,
      machineId: request.machineId,
      configVersion: request.config.version,
      configHash: request.config.hash,
      files,
      runtimes,
    };
  }

  async getState(machineId: string): Promise<WorkerRuntimeConfigState> {
    return {
      machineId,
      workspaceRoot: this.workspaceRoot,
      lastAppliedConfigVersion: this.lastAppliedConfigVersion,
      lastAppliedConfigHash: this.lastAppliedConfigHash,
      runtimes: await this.probeAllRuntimes(),
    };
  }

  private async probeAllRuntimes(): Promise<Record<ManagedRuntime, RuntimeCapabilityState>> {
    const claude = await this.probeRuntime('claude-code');
    const codex = await this.probeRuntime('codex');
    return {
      'claude-code': claude,
      codex,
    };
  }
}

function resolveTargetPath(file: RenderedConfigFile, workspaceRoot: string, homeDir: string): string {
  return file.scope === 'home'
    ? path.resolve(homeDir, file.path)
    : path.resolve(workspaceRoot, file.path);
}

function sha256(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function defaultProbeRuntime(runtime: ManagedRuntime, homeDir: string): RuntimeCapabilityState {
  const command = runtime === 'claude-code' ? 'claude' : 'codex';
  const installed = spawnSync('which', [command], { stdio: 'ignore' }).status === 0;
  const authenticated =
    runtime === 'claude-code'
      ? Boolean(process.env.ANTHROPIC_API_KEY) || existsSync(path.join(homeDir, '.claude.json'))
      : Boolean(process.env.OPENAI_API_KEY) || existsSync(path.join(homeDir, '.codex', 'auth.json'));

  return {
    installed,
    authenticated,
  };
}
