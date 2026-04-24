import { ControlPlaneError, EMBEDDING_MODEL_CATALOG } from '@agentctl/shared';
import { and, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { apiAccounts } from '../db/schema.js';
import { decryptCredential } from '../utils/credential-crypto.js';
import { EmbeddingClient } from './embedding-client.js';
import { type ProviderChangedId, providerInvalidationBus } from './provider-invalidation-bus.js';

export type ResolvedEmbeddingClient = {
  client: EmbeddingClient;
  model: string;
  providerKind: string;
  providerHost: string;
  priceUsdPerMtoken: number;
  credentialId: string;
};

export type EmbeddingClientResolver = () => Promise<ResolvedEmbeddingClient>;

export type ResolveEmbeddingClientInput = {
  pool: Pool;
  db: Database;
  encryptionKey: string;
  logger: Logger;
  credentialId?: string;
};

type ApiAccountRow = typeof apiAccounts.$inferSelect;
type CacheEntry = {
  resolved: ResolvedEmbeddingClient;
  expiresAt: number;
};

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

function clearCacheForProvider(id: ProviderChangedId): void {
  cache.delete('active');
  cache.delete(id);
}

function ensureCacheInvalidationListener(): void {
  if (!providerInvalidationBus.listeners('provider.changed').includes(clearCacheForProvider)) {
    providerInvalidationBus.on('provider.changed', clearCacheForProvider);
  }
}

ensureCacheInvalidationListener();

export async function resolveEmbeddingClient(
  input: ResolveEmbeddingClientInput,
): Promise<ResolvedEmbeddingClient> {
  ensureCacheInvalidationListener();
  const cacheKey = input.credentialId ?? 'active';
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.resolved;
  }

  const row = input.credentialId
    ? await loadProviderById(input.db, input.credentialId)
    : await loadActiveProvider(input.db);

  if (!row) {
    throw new ControlPlaneError(
      input.credentialId ? 'EMBEDDING_CREDENTIAL_NOT_FOUND' : 'EMBEDDING_NO_PROVIDER',
      input.credentialId
        ? `Embedding credential '${input.credentialId}' was not found`
        : 'No active embedding provider is configured',
      input.credentialId ? { credentialId: input.credentialId } : undefined,
    );
  }

  const model = readProviderModel(row);
  const catalogEntry = EMBEDDING_MODEL_CATALOG.find(
    (entry) => entry.provider === row.provider && entry.model === model,
  );
  if (!catalogEntry) {
    throw new ControlPlaneError('CATALOG_INVALID', 'Embedding provider/model is not in catalog', {
      provider: row.provider,
      model,
    });
  }

  let apiKey: string;
  try {
    apiKey = decryptCredential(row.credential, row.credentialIv, input.encryptionKey);
  } catch (error) {
    throw new ControlPlaneError(
      'EMBEDDING_CREDENTIAL_DECRYPT_FAILED',
      'Failed to decrypt embedding provider credential',
      { credentialId: row.id, cause: error instanceof Error ? error.message : String(error) },
    );
  }

  const resolved: ResolvedEmbeddingClient = {
    client: new EmbeddingClient({
      baseUrl: catalogEntry.baseUrl,
      model,
      apiKey,
      embeddingsPath: catalogEntry.embeddingsPath,
      extraBody: catalogEntry.extraBody,
      logger: input.logger.child({ component: 'embedding-client', provider: row.provider, model }),
    }),
    model,
    providerKind: row.provider,
    providerHost: catalogEntry.baseUrl,
    priceUsdPerMtoken: catalogEntry.pricePerMtoken,
    credentialId: row.id,
  };

  cache.set(cacheKey, { resolved, expiresAt: Date.now() + CACHE_TTL_MS });
  return resolved;
}

export function resetFactoryForTesting(): void {
  cache.clear();
  ensureCacheInvalidationListener();
}

async function loadProviderById(db: Database, credentialId: string): Promise<ApiAccountRow | null> {
  const rows = await db
    .select()
    .from(apiAccounts)
    .where(and(eq(apiAccounts.id, credentialId), eq(apiAccounts.credentialKind, 'embedding')))
    .limit(1);
  return rows[0] ?? null;
}

async function loadActiveProvider(db: Database): Promise<ApiAccountRow | null> {
  const rows = await db
    .select()
    .from(apiAccounts)
    .where(and(eq(apiAccounts.isActive, true), eq(apiAccounts.credentialKind, 'embedding')))
    .limit(1);
  return rows[0] ?? null;
}

function readProviderModel(row: ApiAccountRow): string {
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  const model = metadata.model;
  if (typeof model === 'string' && model.length > 0) {
    return model;
  }
  const fallback = EMBEDDING_MODEL_CATALOG.find((entry) => entry.provider === row.provider);
  if (!fallback) {
    throw new ControlPlaneError('CATALOG_INVALID', 'Embedding provider is not in catalog', {
      provider: row.provider,
    });
  }
  return fallback.model;
}
