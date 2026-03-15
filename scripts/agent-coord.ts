import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const COORDINATION_SUBDIR = path.join('agentctl', 'coordination');
const CLAIMS_FILE = 'claims.json';
const BOARD_FILE = 'board.ndjson';
const LOCK_DIR = '.lock';
const WORKTREE_LEASE_FILE = '.agentcoord.json';
const LOCK_RETRY_DELAY_MS = 50;
const LOCK_RETRY_ATTEMPTS = 40;
const DEFAULT_BOARD_LIMIT = 10;
const DEFAULT_STALE_AFTER_MS = 4 * 60 * 60 * 1000;

export type ResourceType = 'worktree' | 'task' | 'pr' | 'note-scope';
export type ClaimStatus = 'active' | 'released' | 'stale';
export type BoardKind = 'note' | 'warning' | 'handoff' | 'cleanup' | 'blocked';

export type ResourceClaim = {
  resourceId: string;
  resourceType: ResourceType;
  owner: string;
  purpose: string;
  status: ClaimStatus;
  claimedAt: string;
  heartbeatAt: string;
  releasedAt: string | null;
  metadata: Record<string, string>;
};

export type BoardEntry = {
  id: string;
  createdAt: string;
  author: string;
  kind: BoardKind;
  message: string;
  resourceId: string | null;
  metadata: Record<string, string>;
};

export type CoordinationContext = {
  cwd: string;
  repoRoot: string;
  gitCommonDir: string;
  coordinationDir: string;
  claimsPath: string;
  boardPath: string;
  lockDir: string;
};

type ExecFileResult = {
  stdout: string;
  stderr: string;
};

export type ExecFileLike = (
  file: string,
  args: string[],
  options?: { cwd?: string },
) => Promise<ExecFileResult>;

export type CoordinationDeps = {
  execFile: ExecFileLike;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  getUsername: () => string;
};

export type CoordinationStatus = {
  claims: ResourceClaim[];
  board: BoardEntry[];
};

type WorktreeLease = {
  leaseVersion: 1;
  resourceId: string;
  owner: string;
  purpose: string;
  branch: string;
  claimedAt: string;
  heartbeatAt: string;
  boardPath: string;
};

export type ClaimInput = {
  resourceType: ResourceType;
  purpose: string;
  owner?: string;
  resourceId?: string;
  path?: string;
  steal?: boolean;
  metadata?: Record<string, string>;
};

export type ReleaseInput = {
  resourceType: ResourceType;
  resourceId?: string;
  path?: string;
  owner?: string;
  force?: boolean;
};

export type HeartbeatInput = {
  resourceType: ResourceType;
  resourceId?: string;
  path?: string;
  owner?: string;
  force?: boolean;
};

export type PostInput = {
  kind: BoardKind;
  message: string;
  author?: string;
  resourceId?: string;
  metadata?: Record<string, string>;
};

export type PruneResult = {
  removed: string[];
  markedStale: string[];
  kept: string[];
};

const defaultDeps: CoordinationDeps = {
  execFile: (file, args, options) => execFileAsync(file, args, options),
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  getUsername: () => os.userInfo().username,
};

function toIso(now: Date): string {
  return now.toISOString();
}

function getErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { code?: unknown };
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function resolveOwner(owner: string | undefined, deps: CoordinationDeps): string {
  return owner ?? process.env.AGENT_COORD_OWNER ?? process.env.AGENT_NAME ?? deps.getUsername();
}

function isBoardKind(value: string): value is BoardKind {
  return ['note', 'warning', 'handoff', 'cleanup', 'blocked'].includes(value);
}

function isResourceType(value: string): value is ResourceType {
  return ['worktree', 'task', 'pr', 'note-scope'].includes(value);
}

function parseOptionValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function requireOption(args: string[], flag: string): string {
  const value = parseOptionValue(args, flag);
  if (!value) {
    throw new Error(`Missing required option ${flag}`);
  }
  return value;
}

function parseIntegerOption(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid numeric value: ${value}`);
  }
  return parsed;
}

function createBoardEntryId(now: Date): string {
  return `${now.getTime()}-${Math.random().toString(16).slice(2, 10)}`;
}

export async function resolveCoordinationContext(
  cwd = process.cwd(),
  deps: CoordinationDeps = defaultDeps,
): Promise<CoordinationContext> {
  const repoRoot = (
    await deps.execFile('git', ['rev-parse', '--show-toplevel'], {
      cwd,
    })
  ).stdout.trim();
  const gitCommonDirRaw = (
    await deps.execFile('git', ['rev-parse', '--git-common-dir'], {
      cwd: repoRoot,
    })
  ).stdout.trim();
  const gitCommonDir = path.resolve(repoRoot, gitCommonDirRaw);
  const coordinationDir = path.join(gitCommonDir, COORDINATION_SUBDIR);
  return {
    cwd,
    repoRoot,
    gitCommonDir,
    coordinationDir,
    claimsPath: path.join(coordinationDir, CLAIMS_FILE),
    boardPath: path.join(coordinationDir, BOARD_FILE),
    lockDir: path.join(coordinationDir, LOCK_DIR),
  };
}

export async function ensureCoordinationDir(context: CoordinationContext): Promise<void> {
  await mkdir(context.coordinationDir, { recursive: true });
}

export async function withCoordinationLock<T>(
  context: CoordinationContext,
  deps: CoordinationDeps,
  task: () => Promise<T>,
): Promise<T> {
  await ensureCoordinationDir(context);

  let acquired = false;
  for (let attempt = 0; attempt < LOCK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await mkdir(context.lockDir);
      acquired = true;
      break;
    } catch (error) {
      if (getErrorCode(error) !== 'EEXIST' || attempt === LOCK_RETRY_ATTEMPTS - 1) {
        throw error;
      }
      await deps.sleep(LOCK_RETRY_DELAY_MS);
    }
  }

  if (!acquired) {
    throw new Error(`Failed to acquire coordination lock at ${context.lockDir}`);
  }

  try {
    return await task();
  } finally {
    await rm(context.lockDir, { recursive: true, force: true });
  }
}

export async function loadClaims(context: CoordinationContext): Promise<ResourceClaim[]> {
  try {
    const raw = await readFile(context.claimsPath, 'utf8');
    const parsed = JSON.parse(raw) as ResourceClaim[];
    return [...parsed].sort((left, right) => left.resourceId.localeCompare(right.resourceId));
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function saveClaims(
  context: CoordinationContext,
  claims: ResourceClaim[],
): Promise<void> {
  await ensureCoordinationDir(context);
  const tempPath = `${context.claimsPath}.${process.pid}.${Date.now()}.tmp`;
  const sortedClaims = [...claims].sort((left, right) =>
    left.resourceId.localeCompare(right.resourceId),
  );
  await writeFile(tempPath, `${JSON.stringify(sortedClaims, null, 2)}\n`, 'utf8');
  await rename(tempPath, context.claimsPath);
}

export async function appendBoardEntry(
  context: CoordinationContext,
  entry: BoardEntry,
): Promise<void> {
  await ensureCoordinationDir(context);
  await appendFile(context.boardPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

export async function loadBoardEntries(
  context: CoordinationContext,
  limit = DEFAULT_BOARD_LIMIT,
): Promise<BoardEntry[]> {
  try {
    const raw = await readFile(context.boardPath, 'utf8');
    const entries = raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as BoardEntry);
    return entries.slice(-limit).reverse();
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function resolveBranch(branchCwd: string, deps: CoordinationDeps): Promise<string> {
  const result = await deps.execFile('git', ['branch', '--show-current'], {
    cwd: branchCwd,
  });
  return result.stdout.trim() || 'detached';
}

function resolveWorktreePath(context: CoordinationContext, pathArg?: string): string {
  const rawPath = pathArg ? path.resolve(context.cwd, pathArg) : context.repoRoot;
  return existsSync(rawPath) ? realpathSync(rawPath) : rawPath;
}

function resolveWorktreeLeasePath(worktreePath: string): string {
  return path.join(worktreePath, WORKTREE_LEASE_FILE);
}

function buildResourceId(
  resourceType: ResourceType,
  context: CoordinationContext,
  resourceId?: string,
  pathArg?: string,
): string {
  if (resourceId) {
    return resourceId;
  }
  if (resourceType === 'worktree') {
    return `worktree:${resolveWorktreePath(context, pathArg)}`;
  }
  throw new Error(`--id is required for resource type ${resourceType}`);
}

async function lockWorktree(
  context: CoordinationContext,
  worktreePath: string,
  reason: string,
  deps: CoordinationDeps,
): Promise<void> {
  try {
    await deps.execFile('git', ['worktree', 'lock', worktreePath, '--reason', reason], {
      cwd: context.repoRoot,
    });
  } catch (error) {
    const text = getErrorText(error);
    if (text.includes('already locked')) {
      return;
    }
    throw error;
  }
}

async function unlockWorktree(
  context: CoordinationContext,
  worktreePath: string,
  deps: CoordinationDeps,
): Promise<void> {
  try {
    await deps.execFile('git', ['worktree', 'unlock', worktreePath], {
      cwd: context.repoRoot,
    });
  } catch (error) {
    const text = getErrorText(error);
    if (text.includes('is not locked') || text.includes('not locked')) {
      return;
    }
    throw error;
  }
}

async function writeWorktreeLease(
  claim: ResourceClaim,
  worktreePath: string,
  context: CoordinationContext,
): Promise<void> {
  if (!existsSync(worktreePath)) {
    return;
  }

  const lease: WorktreeLease = {
    leaseVersion: 1,
    resourceId: claim.resourceId,
    owner: claim.owner,
    purpose: claim.purpose,
    branch: claim.metadata.branch ?? 'detached',
    claimedAt: claim.claimedAt,
    heartbeatAt: claim.heartbeatAt,
    boardPath: context.boardPath,
  };
  await writeFile(
    resolveWorktreeLeasePath(worktreePath),
    `${JSON.stringify(lease, null, 2)}\n`,
    'utf8',
  );
}

async function removeWorktreeLease(worktreePath: string): Promise<void> {
  await rm(resolveWorktreeLeasePath(worktreePath), { force: true });
}

export async function claimResource(
  input: ClaimInput,
  context: CoordinationContext,
  deps: CoordinationDeps = defaultDeps,
): Promise<ResourceClaim> {
  const resourceId = buildResourceId(input.resourceType, context, input.resourceId, input.path);
  const owner = resolveOwner(input.owner, deps);
  const now = deps.now();
  const worktreePath =
    input.resourceType === 'worktree' ? resolveWorktreePath(context, input.path) : undefined;
  return withCoordinationLock(context, deps, async () => {
    const claims = await loadClaims(context);
    const existing = claims.find((claim) => claim.resourceId === resourceId);
    if (
      existing &&
      existing.owner !== owner &&
      existing.status !== 'released' &&
      !(input.steal === true && existing.status === 'stale')
    ) {
      throw new Error(`Resource ${resourceId} is already claimed by ${existing.owner}`);
    }

    const metadata = {
      ...existing?.metadata,
      ...input.metadata,
      ...(worktreePath
        ? { path: worktreePath, branch: await resolveBranch(worktreePath, deps) }
        : {}),
    };

    if (worktreePath) {
      await lockWorktree(context, worktreePath, `${owner}: ${input.purpose}`, deps);
    }

    const claim: ResourceClaim = {
      resourceId,
      resourceType: input.resourceType,
      owner,
      purpose: input.purpose,
      status: 'active',
      claimedAt: toIso(now),
      heartbeatAt: toIso(now),
      releasedAt: null,
      metadata,
    };
    const nextClaims = claims.filter((existing) => existing.resourceId !== resourceId);
    nextClaims.push(claim);
    if (worktreePath) {
      try {
        await writeWorktreeLease(claim, worktreePath, context);
      } catch (error) {
        await unlockWorktree(context, worktreePath, deps);
        throw error;
      }
    }
    try {
      await saveClaims(context, nextClaims);
    } catch (error) {
      if (worktreePath) {
        await removeWorktreeLease(worktreePath);
        await unlockWorktree(context, worktreePath, deps);
      }
      throw error;
    }
    return claim;
  });
}

export async function heartbeatClaim(
  input: HeartbeatInput,
  context: CoordinationContext,
  deps: CoordinationDeps = defaultDeps,
): Promise<ResourceClaim> {
  const resourceId = buildResourceId(input.resourceType, context, input.resourceId, input.path);
  const owner = resolveOwner(input.owner, deps);
  return withCoordinationLock(context, deps, async () => {
    const claims = await loadClaims(context);
    const existing = claims.find((claim) => claim.resourceId === resourceId);
    if (!existing) {
      throw new Error(`No claim found for ${resourceId}`);
    }
    if (existing.owner !== owner && input.force !== true) {
      throw new Error(`Resource ${resourceId} is owned by ${existing.owner}`);
    }
    const nextClaim: ResourceClaim = {
      ...existing,
      heartbeatAt: toIso(deps.now()),
    };
    const nextClaims = claims.filter((claim) => claim.resourceId !== resourceId);
    nextClaims.push(nextClaim);
    await saveClaims(context, nextClaims);
    if (nextClaim.resourceType === 'worktree' && nextClaim.metadata.path) {
      await writeWorktreeLease(nextClaim, nextClaim.metadata.path, context);
    }
    return nextClaim;
  });
}

export async function releaseClaim(
  input: ReleaseInput,
  context: CoordinationContext,
  deps: CoordinationDeps = defaultDeps,
): Promise<ResourceClaim> {
  const resourceId = buildResourceId(input.resourceType, context, input.resourceId, input.path);
  const owner = resolveOwner(input.owner, deps);

  return withCoordinationLock(context, deps, async () => {
    const claims = await loadClaims(context);
    const existing = claims.find((claim) => claim.resourceId === resourceId);
    if (!existing) {
      throw new Error(`No claim found for ${resourceId}`);
    }
    if (existing.owner !== owner && input.force !== true) {
      throw new Error(`Resource ${resourceId} is owned by ${existing.owner}`);
    }

    const worktreePath =
      input.resourceType === 'worktree'
        ? (existing.metadata.path ?? resolveWorktreePath(context, input.path))
        : undefined;

    if (worktreePath) {
      await unlockWorktree(context, worktreePath, deps);
    }

    const now = toIso(deps.now());
    const nextClaim: ResourceClaim = {
      ...existing,
      status: 'released',
      heartbeatAt: now,
      releasedAt: now,
    };
    const nextClaims = claims.filter((claim) => claim.resourceId !== resourceId);
    nextClaims.push(nextClaim);
    await saveClaims(context, nextClaims);
    if (worktreePath) {
      await removeWorktreeLease(worktreePath);
    }
    return nextClaim;
  });
}

export async function postBoardMessage(
  input: PostInput,
  context: CoordinationContext,
  deps: CoordinationDeps = defaultDeps,
): Promise<BoardEntry> {
  const now = deps.now();
  const entry: BoardEntry = {
    id: createBoardEntryId(now),
    createdAt: toIso(now),
    author: resolveOwner(input.author, deps),
    kind: input.kind,
    message: input.message,
    resourceId: input.resourceId ?? null,
    metadata: input.metadata ?? {},
  };
  await withCoordinationLock(context, deps, async () => {
    await appendBoardEntry(context, entry);
  });
  return entry;
}

export async function pruneClaims(
  context: CoordinationContext,
  deps: CoordinationDeps = defaultDeps,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
): Promise<PruneResult> {
  return withCoordinationLock(context, deps, async () => {
    const claims = await loadClaims(context);
    const nowMs = deps.now().getTime();
    const removed: string[] = [];
    const markedStale: string[] = [];
    const kept: string[] = [];
    const nextClaims: ResourceClaim[] = [];

    for (const claim of claims) {
      const claimPath = claim.metadata.path;
      const missingWorktree =
        claim.resourceType === 'worktree' && claimPath != null && !existsSync(claimPath);

      if (claim.status === 'released' || missingWorktree) {
        if (claim.resourceType === 'worktree' && claimPath && existsSync(claimPath)) {
          await removeWorktreeLease(claimPath);
        }
        removed.push(claim.resourceId);
        continue;
      }

      const ageMs = nowMs - new Date(claim.heartbeatAt).getTime();
      if (claim.status === 'active' && ageMs > staleAfterMs) {
        nextClaims.push({
          ...claim,
          status: 'stale',
        });
        markedStale.push(claim.resourceId);
        continue;
      }

      nextClaims.push(claim);
      kept.push(claim.resourceId);
    }

    await saveClaims(context, nextClaims);
    return { removed, markedStale, kept };
  });
}

export async function getCoordinationStatus(
  context: CoordinationContext,
  boardLimit = DEFAULT_BOARD_LIMIT,
): Promise<CoordinationStatus> {
  const [claims, board] = await Promise.all([
    loadClaims(context),
    loadBoardEntries(context, boardLimit),
  ]);
  return { claims, board };
}

function formatStatusText(status: CoordinationStatus): string {
  const claimLines =
    status.claims.length === 0
      ? ['Claims: none']
      : [
          'Claims:',
          ...status.claims.map(
            (claim) =>
              `- [${claim.status}] ${claim.resourceId} owner=${claim.owner} purpose=${claim.purpose}`,
          ),
        ];
  const boardLines =
    status.board.length === 0
      ? ['Board: empty']
      : [
          'Board:',
          ...status.board.map(
            (entry) =>
              `- [${entry.kind}] ${entry.author}: ${entry.message}${entry.resourceId ? ` (${entry.resourceId})` : ''}`,
          ),
        ];
  return [...claimLines, ...boardLines].join('\n');
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printUsage(): void {
  console.log(`Usage:
  pnpm coord status [--json] [--limit 10]
  pnpm coord claim --type worktree|task|pr|note-scope --purpose <text> [--owner <name>] [--id <resource-id>] [--path <path>] [--steal]
  pnpm coord heartbeat --type worktree|task|pr|note-scope [--owner <name>] [--id <resource-id>] [--path <path>] [--force]
  pnpm coord release --type worktree|task|pr|note-scope [--owner <name>] [--id <resource-id>] [--path <path>] [--force]
  pnpm coord post --kind note|warning|handoff|cleanup|blocked --message <text> [--resource-id <resource-id>] [--owner <name>]
  pnpm coord prune [--stale-after-ms 14400000] [--json]`);
}

export async function runCli(
  argv = process.argv,
  deps: CoordinationDeps = defaultDeps,
): Promise<number> {
  const [, , command, ...args] = argv;
  if (!command) {
    printUsage();
    return 1;
  }

  try {
    const context = await resolveCoordinationContext(process.cwd(), deps);
    const wantsJson = hasFlag(args, '--json');

    switch (command) {
      case 'status': {
        const limit = parseIntegerOption(parseOptionValue(args, '--limit'), DEFAULT_BOARD_LIMIT);
        const status = await getCoordinationStatus(context, limit);
        if (wantsJson) {
          printJson(status);
        } else {
          console.log(formatStatusText(status));
        }
        return 0;
      }
      case 'claim': {
        const type = requireOption(args, '--type');
        if (!isResourceType(type)) {
          throw new Error(`Unsupported resource type: ${type}`);
        }
        const claim = await claimResource(
          {
            resourceType: type,
            purpose: requireOption(args, '--purpose'),
            owner: parseOptionValue(args, '--owner'),
            resourceId: parseOptionValue(args, '--id'),
            path: parseOptionValue(args, '--path'),
            steal: hasFlag(args, '--steal'),
          },
          context,
          deps,
        );
        if (wantsJson) {
          printJson(claim);
        } else {
          console.log(`Claimed ${claim.resourceId}`);
        }
        return 0;
      }
      case 'heartbeat': {
        const type = requireOption(args, '--type');
        if (!isResourceType(type)) {
          throw new Error(`Unsupported resource type: ${type}`);
        }
        const claim = await heartbeatClaim(
          {
            resourceType: type,
            owner: parseOptionValue(args, '--owner'),
            resourceId: parseOptionValue(args, '--id'),
            path: parseOptionValue(args, '--path'),
            force: hasFlag(args, '--force'),
          },
          context,
          deps,
        );
        if (wantsJson) {
          printJson(claim);
        } else {
          console.log(`Heartbeat updated for ${claim.resourceId}`);
        }
        return 0;
      }
      case 'release': {
        const type = requireOption(args, '--type');
        if (!isResourceType(type)) {
          throw new Error(`Unsupported resource type: ${type}`);
        }
        const claim = await releaseClaim(
          {
            resourceType: type,
            owner: parseOptionValue(args, '--owner'),
            resourceId: parseOptionValue(args, '--id'),
            path: parseOptionValue(args, '--path'),
            force: hasFlag(args, '--force'),
          },
          context,
          deps,
        );
        if (wantsJson) {
          printJson(claim);
        } else {
          console.log(`Released ${claim.resourceId}`);
        }
        return 0;
      }
      case 'post': {
        const kind = requireOption(args, '--kind');
        if (!isBoardKind(kind)) {
          throw new Error(`Unsupported board kind: ${kind}`);
        }
        const entry = await postBoardMessage(
          {
            kind,
            message: requireOption(args, '--message'),
            author: parseOptionValue(args, '--owner'),
            resourceId: parseOptionValue(args, '--resource-id'),
          },
          context,
          deps,
        );
        if (wantsJson) {
          printJson(entry);
        } else {
          console.log(`Posted ${entry.kind} entry ${entry.id}`);
        }
        return 0;
      }
      case 'prune': {
        const result = await pruneClaims(
          context,
          deps,
          parseIntegerOption(parseOptionValue(args, '--stale-after-ms'), DEFAULT_STALE_AFTER_MS),
        );
        if (wantsJson) {
          printJson(result);
        } else {
          console.log(
            `Pruned removed=${result.removed.length} markedStale=${result.markedStale.length} kept=${result.kept.length}`,
          );
        }
        return 0;
      }
      default: {
        printUsage();
        return 1;
      }
    }
  } catch (error) {
    console.error(getErrorText(error));
    return 1;
  }
}

async function main(): Promise<void> {
  const exitCode = await runCli(process.argv);
  process.exitCode = exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
