import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { AgentError } from '@agentctl/shared';
import type { Logger } from 'pino';
import { safeReadFileSync, safeWriteFileSync, sanitizePath } from '../utils/path-security.js';

const execFileAsync = promisify(execFile);
const TIER_LOCK_DIR = '/tmp/agentctl-tier-locks';
const DEV_ENV_FILE_PREFIX = '.env.dev-';
const WORKTREE_AGENTCTL_DIR = '.agentctl';
const WORKTREE_TIER_SCRIPT = 'source-tier-env.sh';
const WORKTREE_TIER_METADATA = 'tier-assignment.json';
const DEFAULT_ENV_LOAD_COMMAND = `source ./${WORKTREE_AGENTCTL_DIR}/${WORKTREE_TIER_SCRIPT}`;
const ENV_FILE_NAME_PATTERN = /^\.env\.dev-\d+$/;

export type WorktreeInfo = {
  path: string;
  branch: string;
  head: string;
  isLocked: boolean;
  tier?: string;
  envFilePath?: string;
  envLoadCommand?: string;
};

export type CreateWorktreeOptions = {
  agentId: string;
  baseBranch?: string;
  description?: string;
  projectPath: string;
};

export type WorktreeManagerOptions = {
  projectPath: string;
  treesDir?: string;
  logger: Logger;
};

/**
 * Manages git worktrees for agent isolation.
 *
 * Each agent gets its own worktree under `.trees/agent-{id}`, with a
 * branch named `agent-{id}/{description}`. This provides full filesystem
 * isolation between concurrent agents working on the same repository.
 */
/** Validates that an agentId contains only safe characters for use in branch names and paths. */
const SAFE_AGENT_ID = /^[a-zA-Z0-9_-]+$/;

function assertSafeAgentId(agentId: string): void {
  if (!SAFE_AGENT_ID.test(agentId)) {
    throw new AgentError('INVALID_AGENT_ID', `Agent ID '${agentId}' contains invalid characters`, {
      agentId,
      pattern: SAFE_AGENT_ID.source,
    });
  }
}

export class WorktreeManager {
  private readonly projectPath: string;
  private readonly treesDir: string;
  private readonly logger: Logger;
  private readonly tierAssignments: Map<string, string> = new Map();

  constructor(options: WorktreeManagerOptions) {
    this.projectPath = options.projectPath;
    this.treesDir = options.treesDir ?? path.join(options.projectPath, '.trees');
    this.logger = options.logger;
  }

  /**
   * Create a new worktree for an agent.
   *
   * Creates a worktree at `.trees/agent-{agentId}` on a new branch
   * `agent-{agentId}/{description}` based off the given base branch.
   */
  async create(options: CreateWorktreeOptions): Promise<WorktreeInfo> {
    const { agentId, description } = options;
    assertSafeAgentId(agentId);
    const baseBranch = options.baseBranch ?? 'main';
    const worktreePath = this.getWorktreePath(agentId);
    const branchName = this.buildBranchName(agentId, description);

    await this.assertGitRepo(options.projectPath);

    const alreadyExists = await this.exists(agentId);
    if (alreadyExists) {
      throw new AgentError(
        'WORKTREE_CREATE_FAILED',
        `Worktree already exists for agent '${agentId}'`,
        { agentId, path: worktreePath },
      );
    }

    const branchExists = await this.branchExists(branchName);
    if (branchExists) {
      throw new AgentError('BRANCH_EXISTS', `Branch '${branchName}' already exists`, {
        agentId,
        branch: branchName,
      });
    }

    const tierAssignment = await this.assignTierIfAvailable(agentId);
    let worktreeCreated = false;

    try {
      await execFileAsync('git', ['worktree', 'add', worktreePath, '-b', branchName, baseBranch], {
        cwd: this.projectPath,
      });
      worktreeCreated = true;
    } catch (err) {
      if (tierAssignment) {
        this.releaseTier(agentId);
      }

      throw new AgentError(
        'WORKTREE_CREATE_FAILED',
        `Failed to create worktree for agent '${agentId}': ${err instanceof Error ? err.message : String(err)}`,
        { agentId, branch: branchName, baseBranch, path: worktreePath },
      );
    }

    if (tierAssignment) {
      try {
        await this.prepareTierBootstrap(agentId, tierAssignment);
      } catch (err) {
        this.releaseTier(agentId);
        if (worktreeCreated) {
          await this.cleanupWorktreePath(worktreePath);
        }

        throw new AgentError(
          'WORKTREE_CREATE_FAILED',
          `Failed to prepare worktree tier env for agent '${agentId}': ${err instanceof Error ? err.message : String(err)}`,
          {
            agentId,
            tier: tierAssignment.tier,
            path: worktreePath,
          },
        );
      }
    }

    this.logger.info(
      { agentId, branch: branchName, baseBranch, path: worktreePath, tier: tierAssignment?.tier },
      'Worktree created',
    );

    const info = await this.get(agentId);
    if (!info) {
      if (tierAssignment) {
        this.releaseTier(agentId);
        await this.cleanupWorktreePath(worktreePath);
      }

      throw new AgentError(
        'WORKTREE_CREATE_FAILED',
        `Worktree was created but could not be read back for agent '${agentId}'`,
        { agentId, path: worktreePath },
      );
    }

    return tierAssignment
      ? {
          ...info,
          tier: tierAssignment.tier,
          envFilePath: path.join(worktreePath, tierAssignment.envFileName),
          envLoadCommand: DEFAULT_ENV_LOAD_COMMAND,
        }
      : info;
  }

  /**
   * Remove a worktree for an agent. Unlocks it first if locked.
   */
  async remove(agentId: string): Promise<void> {
    assertSafeAgentId(agentId);
    const worktreePath = this.getWorktreePath(agentId);

    const info = await this.get(agentId);
    if (!info) {
      throw new AgentError('WORKTREE_NOT_FOUND', `No worktree found for agent '${agentId}'`, {
        agentId,
        path: worktreePath,
      });
    }

    // Unlock first if locked, otherwise `git worktree remove` will refuse.
    if (info.isLocked) {
      await this.unlock(agentId);
    }

    try {
      await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], {
        cwd: this.projectPath,
      });
    } catch (err) {
      throw new AgentError(
        'WORKTREE_REMOVE_FAILED',
        `Failed to remove worktree for agent '${agentId}': ${err instanceof Error ? err.message : String(err)}`,
        { agentId, path: worktreePath },
      );
    }

    this.releaseTier(agentId);
    this.logger.info({ agentId, path: worktreePath }, 'Worktree removed');
  }

  /**
   * List all worktrees for this repository.
   */
  async list(): Promise<WorktreeInfo[]> {
    await this.assertGitRepo(this.projectPath);

    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
      cwd: this.projectPath,
    });

    return this.parsePorcelainOutput(stdout);
  }

  /**
   * Get worktree info for a specific agent, or `null` if none exists.
   */
  async get(agentId: string): Promise<WorktreeInfo | null> {
    const worktreePath = this.getWorktreePath(agentId);
    const all = await this.list();

    // Resolve to absolute for comparison so relative `.trees/` paths match.
    const resolved = path.resolve(worktreePath);
    return all.find((w) => path.resolve(w.path) === resolved) ?? null;
  }

  /**
   * Lock a worktree to prevent accidental removal.
   */
  async lock(agentId: string, reason?: string): Promise<void> {
    const worktreePath = this.getWorktreePath(agentId);

    const info = await this.get(agentId);
    if (!info) {
      throw new AgentError('WORKTREE_NOT_FOUND', `No worktree found for agent '${agentId}'`, {
        agentId,
        path: worktreePath,
      });
    }

    const args = ['worktree', 'lock', worktreePath];
    if (reason) {
      args.push('--reason', reason);
    }

    try {
      await execFileAsync('git', args, { cwd: this.projectPath });
    } catch (err) {
      throw new AgentError(
        'WORKTREE_CREATE_FAILED',
        `Failed to lock worktree for agent '${agentId}': ${err instanceof Error ? err.message : String(err)}`,
        { agentId, path: worktreePath },
      );
    }

    this.logger.info({ agentId, reason }, 'Worktree locked');
  }

  /**
   * Unlock a previously locked worktree.
   */
  async unlock(agentId: string): Promise<void> {
    const worktreePath = this.getWorktreePath(agentId);

    try {
      await execFileAsync('git', ['worktree', 'unlock', worktreePath], { cwd: this.projectPath });
    } catch (err) {
      throw new AgentError(
        'WORKTREE_NOT_FOUND',
        `Failed to unlock worktree for agent '${agentId}': ${err instanceof Error ? err.message : String(err)}`,
        { agentId, path: worktreePath },
      );
    }

    this.logger.info({ agentId }, 'Worktree unlocked');
  }

  /**
   * Check whether a worktree exists for the given agent.
   */
  async exists(agentId: string): Promise<boolean> {
    const info = await this.get(agentId);
    return info !== null;
  }

  /**
   * Return the filesystem path where this agent's worktree lives (or would live).
   */
  getWorktreePath(agentId: string): string {
    return path.join(this.treesDir, `agent-${agentId}`);
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /**
   * Build the branch name for an agent.
   * Pattern: `agent-{id}/{description || 'work'}`
   */
  private buildBranchName(agentId: string, description?: string): string {
    const suffix = description ?? 'work';
    return `agent-${agentId}/${suffix}`;
  }

  /**
   * Verify that the given path is inside a git repository.
   */
  private async assertGitRepo(repoPath: string): Promise<void> {
    try {
      await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: repoPath });
    } catch {
      throw new AgentError('NOT_A_GIT_REPO', `Path '${repoPath}' is not inside a git repository`, {
        path: repoPath,
      });
    }
  }

  /**
   * Check whether a branch already exists (local refs).
   */
  private async branchExists(branchName: string): Promise<boolean> {
    try {
      await execFileAsync('git', ['rev-parse', '--verify', `refs/heads/${branchName}`], {
        cwd: this.projectPath,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async assignTierIfAvailable(agentId: string): Promise<{
    tier: string;
    envFileName: string;
  } | null> {
    const envFileNames = await this.listDevEnvFiles();
    if (envFileNames.length === 0) {
      return null;
    }

    const claimedTiers = new Set(this.tierAssignments.values());

    for (const envFileName of envFileNames) {
      const tier = envFileName.slice('.env.'.length);
      if (claimedTiers.has(tier)) {
        continue;
      }

      const locked = await this.tryAcquireTierSelectionLock(tier);
      if (!locked) {
        continue;
      }

      this.tierAssignments.set(agentId, tier);

      return {
        tier,
        envFileName,
      };
    }

    throw new AgentError(
      'WORKTREE_CREATE_FAILED',
      `No available dev tier env files for agent '${agentId}'`,
      {
        agentId,
        tiers: envFileNames.map((fileName) => fileName.slice('.env.'.length)),
      },
    );
  }

  private async listDevEnvFiles(): Promise<string[]> {
    let entries: string[];

    try {
      entries = await readdir(this.projectPath);
    } catch {
      return [];
    }

    return entries
      .filter((entry) => entry.startsWith(DEV_ENV_FILE_PREFIX))
      .sort((left, right) => this.compareTierEnvFiles(left, right));
  }

  private compareTierEnvFiles(left: string, right: string): number {
    const leftNumber = Number.parseInt(left.slice(DEV_ENV_FILE_PREFIX.length), 10);
    const rightNumber = Number.parseInt(right.slice(DEV_ENV_FILE_PREFIX.length), 10);

    if (Number.isNaN(leftNumber) || Number.isNaN(rightNumber)) {
      return left.localeCompare(right);
    }

    return leftNumber - rightNumber;
  }

  private async tryAcquireTierSelectionLock(tier: string): Promise<boolean> {
    const safeTierLockDir = sanitizePath(TIER_LOCK_DIR, '/tmp');
    mkdirSync(safeTierLockDir, { recursive: true });

    try {
      await execFileAsync('flock', ['-n', path.join(TIER_LOCK_DIR, `${tier}.lock`), '-c', 'true']);
      return true;
    } catch {
      return false;
    }
  }

  private async prepareTierBootstrap(
    agentId: string,
    assignment: {
      tier: string;
      envFileName: string;
    },
  ): Promise<void> {
    assertSafeAgentId(agentId);
    const safeEnvFileName = this.assertSafeEnvFileName(assignment.envFileName);
    const worktreePath = this.getWorktreePath(agentId);
    const sourceEnvPath = path.join(this.projectPath, safeEnvFileName);
    const worktreeEnvPath = path.join(worktreePath, safeEnvFileName);
    const agentctlDir = path.join(worktreePath, WORKTREE_AGENTCTL_DIR);
    const scriptPath = path.join(agentctlDir, WORKTREE_TIER_SCRIPT);
    const metadataPath = path.join(agentctlDir, WORKTREE_TIER_METADATA);
    const safeWorktreePath = sanitizePath(worktreePath, this.treesDir);
    const safeAgentctlDir = sanitizePath(agentctlDir, safeWorktreePath);
    const safeScriptPath = sanitizePath(scriptPath, safeAgentctlDir);

    mkdirSync(safeWorktreePath, { recursive: true });
    mkdirSync(safeAgentctlDir, { recursive: true });
    safeWriteFileSync(
      worktreeEnvPath,
      safeWorktreePath,
      safeReadFileSync(sourceEnvPath, this.projectPath),
    );

    const bootstrapScript = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      '',
      `WORKTREE_ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"`,
      '',
      'set -a',
      '# shellcheck source=/dev/null',
      `source "\${WORKTREE_ROOT}/${safeEnvFileName}"`,
      'set +a',
      '',
    ].join('\n');

    safeWriteFileSync(scriptPath, safeAgentctlDir, bootstrapScript);
    chmodSync(safeScriptPath, 0o755);
    safeWriteFileSync(
      metadataPath,
      safeAgentctlDir,
      `${JSON.stringify(
        {
          tier: assignment.tier,
          envFile: assignment.envFileName,
          envLoadCommand: DEFAULT_ENV_LOAD_COMMAND,
        },
        null,
        2,
      )}\n`,
    );
  }

  private releaseTier(agentId: string): void {
    this.tierAssignments.delete(agentId);
  }

  private async cleanupWorktreePath(worktreePath: string): Promise<void> {
    try {
      await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], {
        cwd: this.projectPath,
      });
    } catch {
      // Best effort cleanup only; the original create failure is more important.
    }
  }

  /**
   * Parse the porcelain output of `git worktree list --porcelain`.
   *
   * The format is blocks separated by blank lines, each block containing:
   *   worktree <path>
   *   HEAD <sha>
   *   branch refs/heads/<name>
   *   locked                       (optional)
   *
   * Bare repositories and detached HEADs are handled gracefully.
   */
  private parsePorcelainOutput(output: string): WorktreeInfo[] {
    const results: WorktreeInfo[] = [];

    // Split into blocks separated by empty lines.
    const blocks = output.trim().split('\n\n');

    for (const block of blocks) {
      if (!block.trim()) {
        continue;
      }

      const lines = block.split('\n');

      let worktreePath = '';
      let head = '';
      let branch = '';
      let isLocked = false;
      let isBare = false;

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          worktreePath = line.slice('worktree '.length);
        } else if (line.startsWith('HEAD ')) {
          head = line.slice('HEAD '.length);
        } else if (line.startsWith('branch ')) {
          // Strip the refs/heads/ prefix
          const ref = line.slice('branch '.length);
          branch = ref.replace(/^refs\/heads\//, '');
        } else if (line === 'locked') {
          isLocked = true;
        } else if (line === 'bare') {
          isBare = true;
        }
      }

      // Skip the bare repository entry itself — it's not a real worktree.
      if (isBare) {
        continue;
      }

      if (worktreePath) {
        results.push({
          path: worktreePath,
          branch,
          head,
          isLocked,
        });
      }
    }

    return results;
  }

  private assertSafeEnvFileName(envFileName: string): string {
    if (!ENV_FILE_NAME_PATTERN.test(envFileName)) {
      throw new AgentError(
        'WORKTREE_CREATE_FAILED',
        `Invalid dev env file name '${envFileName}' for worktree tier bootstrap`,
        { envFileName },
      );
    }

    return envFileName;
  }
}
