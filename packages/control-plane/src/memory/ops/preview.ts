import { createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  ControlPlaneError,
  type EgressSnapshot,
  type MemoryOpsJobKind,
  scopeNormalize,
} from '@agentctl/shared';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import type { Database } from '../../db/index.js';
import {
  type EmbeddingClientResolver,
  type ResolvedEmbeddingClient,
  resolveEmbeddingClient,
} from '../embedding-client-factory.js';
import { readMemoryOpsConfig } from './config.js';

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const STALE_DELTA_RATIO = 0.1;
const DRAWER_CHUNK_BYTES = 2_000;
const TEXT_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.css',
  '.go',
  '.h',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsonl',
  '.jsx',
  '.md',
  '.mdx',
  '.py',
  '.rs',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

export type PreviewableJobKind = Extract<
  MemoryOpsJobKind,
  'embedding-backfill' | 'drawer-backfill'
>;
type PoolLike = Pick<Pool, 'query'>;

export type BuildEgressSnapshotOptions = {
  params?: Record<string, unknown>;
  pool?: PoolLike;
  db?: Database;
  encryptionKey?: string;
  credentialId?: string;
  embeddingClientResolver?: EmbeddingClientResolver;
  logger?: Logger;
};

export function isPreviewableJobKind(kind: MemoryOpsJobKind): kind is PreviewableJobKind {
  return kind === 'embedding-backfill' || kind === 'drawer-backfill';
}

export async function buildEgressSnapshot(
  kind: PreviewableJobKind,
  options: BuildEgressSnapshotOptions,
): Promise<EgressSnapshot> {
  const provider = await resolveRequiredEmbeddingClient(options);
  return buildSnapshotWithProvider(kind, provider, options);
}

async function buildSnapshotWithProvider(
  kind: PreviewableJobKind,
  provider: ResolvedEmbeddingClient,
  options: BuildEgressSnapshotOptions,
): Promise<EgressSnapshot> {
  const baseSnapshot = {
    kind,
    providerKind: provider.providerKind,
    providerModel: provider.model,
    providerHost: provider.providerHost,
    priceUsdPerMtoken: provider.priceUsdPerMtoken,
    computedAt: new Date().toISOString(),
  } satisfies Pick<
    EgressSnapshot,
    'kind' | 'providerKind' | 'providerModel' | 'providerHost' | 'priceUsdPerMtoken' | 'computedAt'
  >;

  if (kind === 'embedding-backfill') {
    if (!options.pool) {
      throw new ControlPlaneError(
        'VALIDATION_ERROR',
        'Embedding preview requires a PostgreSQL pool',
      );
    }
    const scope = scopeNormalize(readString(options.params?.scope));
    const result = await options.pool.query<{
      row_count: number | string;
      char_count: number | string;
    }>(
      `SELECT COUNT(*)::int AS row_count,
              COALESCE(SUM(length(content)), 0)::int AS char_count
         FROM memory_facts
        WHERE embedding IS NULL
          AND valid_until IS NULL
          AND ($1::text = '' OR LOWER(scope) = $1)`,
      [scope],
    );
    const row = result.rows[0] ?? { row_count: 0, char_count: 0 };
    const rowCount = Number(row.row_count);
    const tokenEstimate = estimateTokens(Number(row.char_count));

    return {
      ...baseSnapshot,
      rowCount,
      tokenEstimate,
      costEstimate: estimateCost(tokenEstimate, provider.priceUsdPerMtoken),
      contentClass: 'memory-facts',
    };
  }

  const sourceRoot = readString(options.params?.sourceRoot);
  if (!sourceRoot) {
    throw new ControlPlaneError('VALIDATION_ERROR', 'drawer-backfill preview requires sourceRoot', {
      sourceRootViolation: true,
    });
  }

  const drawerStats = scanDrawerSourceRoot(sourceRoot);
  const tokenEstimate = estimateTokens(drawerStats.totalBytes);
  return {
    ...baseSnapshot,
    fileCount: drawerStats.fileCount,
    totalBytes: drawerStats.totalBytes,
    chunkCount: Math.ceil(drawerStats.totalBytes / DRAWER_CHUNK_BYTES),
    tokenEstimate,
    costEstimate: estimateCost(tokenEstimate, provider.priceUsdPerMtoken),
    contentClass: 'drawer-source-files',
  };
}

export function createPreviewToken(
  snapshot: EgressSnapshot,
  signingSecret = readMemoryOpsConfig().signingSecret,
  now = Date.now(),
): string {
  if (!signingSecret) {
    throw new ControlPlaneError(
      'SIGNING_SECRET_MISSING',
      'MEMORY_OPS_SIGNING_SECRET is not configured',
    );
  }
  const encoded = Buffer.from(JSON.stringify({ snapshot, ts: now }), 'utf8').toString('base64url');
  const signature = createHmac('sha256', signingSecret).update(encoded).digest('hex');
  return `${encoded}.${signature}`;
}

export function verifyPreviewToken(
  token: string,
  snapshot: EgressSnapshot,
  signingSecret = readMemoryOpsConfig().signingSecret,
  now = Date.now(),
): boolean {
  if (!signingSecret) {
    return false;
  }
  try {
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature) {
      return false;
    }
    const expectedSignature = createHmac('sha256', signingSecret).update(encoded).digest('hex');
    if (!safeCompare(signature, expectedSignature)) {
      return false;
    }

    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      snapshot?: EgressSnapshot;
      ts?: number;
    };
    if (
      typeof payload.ts !== 'number' ||
      payload.ts > now + 60_000 ||
      now - payload.ts > PREVIEW_TTL_MS
    ) {
      return false;
    }
    if (!payload.snapshot) {
      return false;
    }

    return snapshotsMatch(payload.snapshot, snapshot);
  } catch {
    return false;
  }
}

export async function buildEgressPreview(
  input: { kind: PreviewableJobKind; params?: Record<string, unknown>; credentialId?: string },
  deps: BuildEgressSnapshotOptions,
): Promise<{ snapshot: EgressSnapshot; credentialId: string }> {
  const options = { ...deps, params: input.params, credentialId: input.credentialId };
  const provider = await resolveRequiredEmbeddingClient(options);
  const snapshot = await buildSnapshotWithProvider(input.kind, provider, options);
  return {
    snapshot,
    credentialId: provider.credentialId,
  };
}

export function signEgressSnapshot(
  snapshot: EgressSnapshot,
  signingSecret = readMemoryOpsConfig().signingSecret,
): string {
  return createPreviewToken(snapshot, signingSecret);
}

export function verifyEgressToken(
  token: string,
  expectedSnapshot: EgressSnapshot,
  signingSecret = readMemoryOpsConfig().signingSecret,
): { snapshot: EgressSnapshot; issuedAt: string } {
  const [encoded] = token.split('.');
  if (!verifyPreviewToken(token, expectedSnapshot, signingSecret)) {
    throw new ControlPlaneError(
      'EGRESS_SNAPSHOT_STALE',
      'The egress preview token is invalid or stale',
    );
  }

  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
    ts: number;
    snapshot: EgressSnapshot;
  };
  return {
    snapshot: payload.snapshot,
    issuedAt: new Date(payload.ts).toISOString(),
  };
}

function resolveRequiredEmbeddingClient(
  options: BuildEgressSnapshotOptions,
): Promise<ResolvedEmbeddingClient> {
  if (options.db && options.pool && options.encryptionKey && options.logger) {
    return resolveEmbeddingClient({
      pool: options.pool as Pool,
      db: options.db,
      encryptionKey: options.encryptionKey,
      logger: options.logger,
      credentialId: options.credentialId,
    });
  }

  if (options.embeddingClientResolver) {
    return options.embeddingClientResolver();
  }

  throw new ControlPlaneError(
    'EMBEDDING_NO_PROVIDER',
    'No active embedding provider is configured',
  );
}

function scanDrawerSourceRoot(sourceRoot: string): { fileCount: number; totalBytes: number } {
  const { drawerSourceRoots } = readMemoryOpsConfig();
  const allowedRoots = drawerSourceRoots.map(resolveRealPath);
  if (allowedRoots.length === 0) {
    throw new ControlPlaneError(
      'VALIDATION_ERROR',
      'MEMORY_OPS_DRAWER_SOURCE_ROOTS is not configured',
      { sourceRootViolation: true },
    );
  }

  const resolvedSourceRoot = resolveRealPath(sourceRoot);
  if (!allowedRoots.some((root) => isWithinRoot(resolvedSourceRoot, root))) {
    throw new ControlPlaneError('VALIDATION_ERROR', 'sourceRoot is outside allowed paths', {
      sourceRootViolation: true,
    });
  }

  let fileCount = 0;
  let totalBytes = 0;
  const stack = [resolvedSourceRoot];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      const resolved = resolveRealPath(current);
      if (!isWithinRoot(resolved, resolvedSourceRoot)) {
        throw new ControlPlaneError('VALIDATION_ERROR', 'sourceRoot contains a symlink escape', {
          sourceRootViolation: true,
        });
      }
      stack.push(resolved);
      continue;
    }

    if (stat.isDirectory()) {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        stack.push(path.join(current, entry.name));
      }
      continue;
    }

    if (!stat.isFile() || !TEXT_EXTENSIONS.has(path.extname(current).toLowerCase())) {
      continue;
    }

    fileCount += 1;
    totalBytes += stat.size;
  }

  return { fileCount, totalBytes };
}

function snapshotsMatch(left: EgressSnapshot, right: EgressSnapshot): boolean {
  const strictFields: (keyof EgressSnapshot)[] = [
    'kind',
    'providerKind',
    'providerModel',
    'providerHost',
    'contentClass',
  ];
  for (const field of strictFields) {
    if (left[field] !== right[field]) {
      return false;
    }
  }

  return (
    numericFieldWithinDelta(left.rowCount, right.rowCount) &&
    numericFieldWithinDelta(left.chunkCount, right.chunkCount) &&
    numericFieldWithinDelta(left.fileCount, right.fileCount) &&
    numericFieldWithinDelta(left.totalBytes, right.totalBytes) &&
    numericFieldWithinDelta(left.tokenEstimate, right.tokenEstimate)
  );
}

function numericFieldWithinDelta(left: number | undefined, right: number | undefined): boolean {
  if (left === undefined && right === undefined) {
    return true;
  }
  if (left === undefined || right === undefined) {
    return false;
  }
  if (left === right) {
    return true;
  }
  const baseline = Math.max(1, Math.abs(left));
  return Math.abs(right - left) / baseline <= STALE_DELTA_RATIO;
}

function estimateTokens(charCount: number): number {
  return Math.ceil(Math.max(0, charCount) / 4);
}

function estimateCost(tokenEstimate: number, priceUsdPerMtoken: number): number {
  return (tokenEstimate / 1_000_000) * priceUsdPerMtoken;
}

function resolveRealPath(target: string): string {
  try {
    return path.resolve(fs.realpathSync(target));
  } catch (error) {
    throw new ControlPlaneError('VALIDATION_ERROR', 'sourceRoot could not be resolved', {
      sourceRootViolation: true,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function isWithinRoot(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
