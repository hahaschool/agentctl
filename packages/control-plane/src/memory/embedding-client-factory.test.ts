import type { ControlPlaneError } from '@agentctl/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { encryptCredential } from '../utils/credential-crypto.js';
import { resetFactoryForTesting, resolveEmbeddingClient } from './embedding-client-factory.js';
import { providerInvalidationBus, resetBusForTesting } from './provider-invalidation-bus.js';

const TEST_ENCRYPTION_KEY = 'a'.repeat(64);
const NOW = new Date('2026-04-25T00:00:00Z');

function createLogger() {
  return {
    child: () => createLogger(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createDb(rows: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(async () => rows),
  };
  return {
    select: vi.fn(() => chain),
  };
}

function makeEmbeddingAccount(overrides: Record<string, unknown> = {}) {
  const encrypted = encryptCredential('sk-test-provider', TEST_ENCRYPTION_KEY);
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'OpenAI Embeddings',
    provider: 'openai',
    credential: encrypted.encrypted,
    credentialIv: encrypted.iv,
    priority: 0,
    rateLimit: {},
    isActive: true,
    metadata: { model: 'text-embedding-3-small' },
    credentialKind: 'embedding',
    credentialLast4: 'ider',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('resolveEmbeddingClient', () => {
  beforeEach(() => {
    resetBusForTesting();
    resetFactoryForTesting();
  });

  it('throws EMBEDDING_NO_PROVIDER when no active embedding account exists', async () => {
    const db = createDb([]);

    await expect(
      resolveEmbeddingClient({
        pool: {} as never,
        db: db as never,
        encryptionKey: TEST_ENCRYPTION_KEY,
        logger: createLogger() as never,
      }),
    ).rejects.toMatchObject({ code: 'EMBEDDING_NO_PROVIDER' } satisfies Partial<ControlPlaneError>);
  });

  it('caches the active provider between calls', async () => {
    const db = createDb([makeEmbeddingAccount()]);

    await resolveEmbeddingClient({
      pool: {} as never,
      db: db as never,
      encryptionKey: TEST_ENCRYPTION_KEY,
      logger: createLogger() as never,
    });
    await resolveEmbeddingClient({
      pool: {} as never,
      db: db as never,
      encryptionKey: TEST_ENCRYPTION_KEY,
      logger: createLogger() as never,
    });

    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('clears the cached active provider on provider.changed', async () => {
    const db = createDb([makeEmbeddingAccount()]);

    await resolveEmbeddingClient({
      pool: {} as never,
      db: db as never,
      encryptionKey: TEST_ENCRYPTION_KEY,
      logger: createLogger() as never,
    });
    providerInvalidationBus.emit('provider.changed', 'active');
    await resolveEmbeddingClient({
      pool: {} as never,
      db: db as never,
      encryptionKey: TEST_ENCRYPTION_KEY,
      logger: createLogger() as never,
    });

    expect(db.select).toHaveBeenCalledTimes(2);
  });
});
