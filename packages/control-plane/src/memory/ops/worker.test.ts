import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../db/index.js';
import { resolveEmbeddingClient } from '../embedding-client-factory.js';
import { drawerBackfillHandler } from './drawer-backfill.js';
import { embeddingBackfillHandler } from './embedding-backfill.js';
import type { JobEventsRepository } from './job-events-repository.js';
import type { JobsRepository } from './jobs-repository.js';
import { createMemoryOpsHandlers } from './worker.js';

vi.mock('../embedding-client-factory.js', () => ({
  resolveEmbeddingClient: vi.fn(),
}));

vi.mock('./embedding-backfill.js', () => ({
  embeddingBackfillHandler: vi.fn(),
}));

vi.mock('./drawer-backfill.js', () => ({
  drawerBackfillHandler: vi.fn(),
}));

const logger = {
  warn: vi.fn(),
} as unknown as Logger;

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    kind: 'embedding-backfill',
    params: { batchSize: 10 },
    credentialId: '11111111-1111-4111-8111-111111111111',
    priceUsdPerMtoken: '0.02',
    ...overrides,
  };
}

function makeHandlers(
  overrides: { encryptionKey?: string; job?: ReturnType<typeof makeJob> | null } = {},
) {
  const jobsRepository = {
    findById: vi.fn().mockResolvedValue(overrides.job === undefined ? makeJob() : overrides.job),
    isCancelRequested: vi.fn(),
    transition: vi.fn(),
  } as unknown as JobsRepository;
  const eventsRepository = {
    insert: vi.fn(),
  } as unknown as JobEventsRepository;

  return {
    jobsRepository,
    eventsRepository,
    handlers: createMemoryOpsHandlers({
      pool: {} as never,
      db: {} as Database,
      encryptionKey: overrides.encryptionKey ?? 'a'.repeat(64),
      logger,
      jobsRepository,
      eventsRepository,
    }),
  };
}

describe('createMemoryOpsHandlers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(resolveEmbeddingClient).mockResolvedValue({
      client: { embedBatchWithUsage: vi.fn() },
      model: 'gemini-embedding-001',
      providerKind: 'gemini',
      providerHost: 'https://generativelanguage.googleapis.com',
      priceUsdPerMtoken: 0.5,
      credentialId: '11111111-1111-4111-8111-111111111111',
    } as never);
    vi.mocked(embeddingBackfillHandler).mockResolvedValue(undefined);
    vi.mocked(drawerBackfillHandler).mockResolvedValue(undefined);
  });

  it('dispatches embedding-backfill with the stored job row price', async () => {
    const { handlers, jobsRepository, eventsRepository } = makeHandlers();

    await handlers['embedding-backfill']?.({
      data: { dbJobId: 'job-1' },
      name: 'embedding-backfill',
    } as never);

    expect(resolveEmbeddingClient).toHaveBeenCalledWith(
      expect.objectContaining({
        encryptionKey: 'a'.repeat(64),
        credentialId: '11111111-1111-4111-8111-111111111111',
      }),
    );
    expect(embeddingBackfillHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        params: { batchSize: 10 },
        priceUsdPerMtoken: '0.02',
        jobsRepository,
        eventsRepository,
      }),
    );
  });

  it('fails before resolving credentials when CREDENTIAL_ENCRYPTION_KEY is missing', async () => {
    const { handlers } = makeHandlers({ encryptionKey: '' });

    await expect(
      handlers['drawer-backfill']?.({
        data: { dbJobId: 'job-1' },
        name: 'drawer-backfill',
      } as never),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_ENCRYPTION_KEY_MISSING' });

    expect(resolveEmbeddingClient).not.toHaveBeenCalled();
    expect(drawerBackfillHandler).not.toHaveBeenCalled();
  });
});
