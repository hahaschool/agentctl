import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CoordinationContext, CoordinationDeps, ExecFileLike } from './agent-coord.js';
import {
  claimResource,
  getCoordinationStatus,
  heartbeatClaim,
  loadClaims,
  postBoardMessage,
  pruneClaims,
  releaseClaim,
  resolveCoordinationContext,
} from './agent-coord.js';

function makeContext(root: string): CoordinationContext {
  const gitCommonDir = path.join(root, '.git-common');
  const coordinationDir = path.join(gitCommonDir, 'agentctl', 'coordination');
  return {
    cwd: root,
    repoRoot: root,
    gitCommonDir,
    coordinationDir,
    claimsPath: path.join(coordinationDir, 'claims.json'),
    boardPath: path.join(coordinationDir, 'board.ndjson'),
    lockDir: path.join(coordinationDir, '.lock'),
  };
}

describe('agent-coord', () => {
  let tempDir: string;
  let context: CoordinationContext;
  let execFile: ExecFileLike;
  let deps: CoordinationDeps;
  let now: Date;
  const gitCalls: Array<{ file: string; args: string[]; cwd?: string }> = [];

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-coord-'));
    context = makeContext(tempDir);
    await mkdir(context.coordinationDir, { recursive: true });
    await mkdir(path.join(tempDir, '.trees', 'active-worktree'), { recursive: true });
    gitCalls.length = 0;
    now = new Date('2026-03-15T14:00:00.000Z');
    execFile = vi.fn(async (file, args, options) => {
      gitCalls.push({ file, args, cwd: options?.cwd });
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
        return { stdout: `${tempDir}\n`, stderr: '' };
      }
      if (args[0] === 'rev-parse' && args[1] === '--git-common-dir') {
        return { stdout: '.git-common\n', stderr: '' };
      }
      if (args[0] === 'branch' && args[1] === '--show-current') {
        return { stdout: 'agent/claude-21/feat/coordination-board\n', stderr: '' };
      }
      if (args[0] === 'worktree' && (args[1] === 'lock' || args[1] === 'unlock')) {
        return { stdout: '', stderr: '' };
      }
      throw new Error(`Unexpected execFile call: ${file} ${args.join(' ')}`);
    });
    deps = {
      execFile,
      now: () => now,
      sleep: async () => {},
      getUsername: () => 'test-agent',
    };
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('resolves the git common dir into a shared coordination context', async () => {
    const resolved = await resolveCoordinationContext(tempDir, deps);
    expect(resolved.repoRoot).toBe(tempDir);
    expect(resolved.gitCommonDir).toBe(path.join(tempDir, '.git-common'));
    expect(resolved.claimsPath).toBe(
      path.join(tempDir, '.git-common', 'agentctl', 'coordination', 'claims.json'),
    );
  });

  it('claims a worktree, stores branch metadata, and locks the worktree', async () => {
    const worktreePath = path.join(tempDir, '.trees', 'active-worktree');

    const claim = await claimResource(
      {
        resourceType: 'worktree',
        purpose: 'finish residual security branch',
        path: worktreePath,
      },
      context,
      deps,
    );

    expect(claim.resourceId).toBe(`worktree:${realpathSync(worktreePath)}`);
    expect(claim.metadata.branch).toBe('agent/claude-21/feat/coordination-board');
    expect(gitCalls.some((call) => call.args[0] === 'worktree' && call.args[1] === 'lock')).toBe(
      true,
    );

    const claims = await loadClaims(context);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.purpose).toBe('finish residual security branch');
  });

  it('updates heartbeat timestamps for existing claims', async () => {
    await claimResource(
      {
        resourceType: 'task',
        resourceId: 'task:roadmap-sync',
        purpose: 'sync roadmap after PR merge',
      },
      context,
      deps,
    );

    now = new Date('2026-03-15T15:30:00.000Z');
    const claim = await heartbeatClaim(
      {
        resourceType: 'task',
        resourceId: 'task:roadmap-sync',
      },
      context,
      deps,
    );

    expect(claim.heartbeatAt).toBe('2026-03-15T15:30:00.000Z');
  });

  it('releases worktree claims and unlocks the worktree', async () => {
    const worktreePath = path.join(tempDir, '.trees', 'active-worktree');
    await claimResource(
      {
        resourceType: 'worktree',
        purpose: 'parallel branch',
        path: worktreePath,
      },
      context,
      deps,
    );

    now = new Date('2026-03-15T16:00:00.000Z');
    const claim = await releaseClaim(
      {
        resourceType: 'worktree',
        path: worktreePath,
      },
      context,
      deps,
    );

    expect(claim.status).toBe('released');
    expect(claim.releasedAt).toBe('2026-03-15T16:00:00.000Z');
    expect(gitCalls.some((call) => call.args[0] === 'worktree' && call.args[1] === 'unlock')).toBe(
      true,
    );
  });

  it('refuses to release a claim owned by another agent unless forced', async () => {
    await claimResource(
      {
        resourceType: 'task',
        resourceId: 'task:owned-by-someone-else',
        purpose: 'shared work item',
        owner: 'claude-21',
      },
      context,
      deps,
    );

    await expect(
      releaseClaim(
        {
          resourceType: 'task',
          resourceId: 'task:owned-by-someone-else',
          owner: 'codex-64',
        },
        context,
        deps,
      ),
    ).rejects.toThrow('owned by claude-21');

    const forced = await releaseClaim(
      {
        resourceType: 'task',
        resourceId: 'task:owned-by-someone-else',
        owner: 'codex-64',
        force: true,
      },
      context,
      deps,
    );

    expect(forced.status).toBe('released');
  });

  it('posts board messages and includes them in status output', async () => {
    await postBoardMessage(
      {
        kind: 'handoff',
        message: 'PR 190 opened, waiting on CI',
        resourceId: 'pr:190',
      },
      context,
      deps,
    );

    const status = await getCoordinationStatus(context, 5);
    expect(status.board).toHaveLength(1);
    expect(status.board[0]).toMatchObject({
      kind: 'handoff',
      message: 'PR 190 opened, waiting on CI',
      resourceId: 'pr:190',
    });

    const boardRaw = await readFile(context.boardPath, 'utf8');
    expect(boardRaw).toContain('PR 190 opened, waiting on CI');
  });

  it('prunes released claims, removes missing worktrees, and marks old active claims stale', async () => {
    await claimResource(
      {
        resourceType: 'task',
        resourceId: 'task:old-active',
        purpose: 'old active claim',
      },
      context,
      deps,
    );
    await claimResource(
      {
        resourceType: 'task',
        resourceId: 'task:release-me',
        purpose: 'released claim',
      },
      context,
      deps,
    );
    await claimResource(
      {
        resourceType: 'worktree',
        purpose: 'missing worktree',
        path: path.join(tempDir, '.trees', 'missing-worktree'),
      },
      context,
      deps,
    );

    await releaseClaim(
      {
        resourceType: 'task',
        resourceId: 'task:release-me',
      },
      context,
      deps,
    );

    now = new Date('2026-03-15T20:30:00.000Z');
    const result = await pruneClaims(context, deps, 2 * 60 * 60 * 1000);

    expect(result.removed).toContain('task:release-me');
    expect(result.removed).toContain(
      `worktree:${path.join(tempDir, '.trees', 'missing-worktree')}`,
    );
    expect(result.markedStale).toContain('task:old-active');

    const claims = await loadClaims(context);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.resourceId).toBe('task:old-active');
    expect(claims[0]?.status).toBe('stale');
  });
});
