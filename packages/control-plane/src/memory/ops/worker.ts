import { ControlPlaneError } from '@agentctl/shared';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { Database } from '../../db/index.js';

import { resolveEmbeddingClient } from '../embedding-client-factory.js';
import { drawerBackfillHandler } from './drawer-backfill.js';
import { embeddingBackfillHandler } from './embedding-backfill.js';
import type { JobEventsRepository } from './job-events-repository.js';
import type { JobsRepository } from './jobs-repository.js';
import type { MemoryOpsJobHandler } from './worker-runtime.js';

export type CreateMemoryOpsHandlersOptions = {
  pool: Pool;
  db: Database;
  encryptionKey: string;
  logger: Logger;
  jobsRepository: JobsRepository;
  eventsRepository: JobEventsRepository;
};

export function createMemoryOpsHandlers(
  opts: CreateMemoryOpsHandlersOptions,
): Partial<Record<'embedding-backfill' | 'drawer-backfill', MemoryOpsJobHandler>> {
  return {
    'embedding-backfill': async (bullJob) => {
      const job = await loadJob(opts.jobsRepository, bullJob.data.dbJobId);
      const resolvedClient = await resolveJobEmbeddingClient(opts, job.credentialId);
      await embeddingBackfillHandler({
        jobId: job.id,
        params: job.params,
        logger: opts.logger,
        pool: opts.pool,
        resolvedClient,
        priceUsdPerMtoken: job.priceUsdPerMtoken,
        jobsRepository: opts.jobsRepository,
        eventsRepository: opts.eventsRepository,
      });
    },
    'drawer-backfill': async (bullJob) => {
      const job = await loadJob(opts.jobsRepository, bullJob.data.dbJobId);
      const resolvedClient = await resolveJobEmbeddingClient(opts, job.credentialId);
      await drawerBackfillHandler({
        jobId: job.id,
        params: job.params,
        logger: opts.logger,
        pool: opts.pool,
        resolvedClient,
        priceUsdPerMtoken: job.priceUsdPerMtoken,
        jobsRepository: opts.jobsRepository,
        eventsRepository: opts.eventsRepository,
      });
    },
  };
}

async function loadJob(jobsRepository: JobsRepository, jobId: string) {
  const job = await jobsRepository.findById(jobId);
  if (!job) {
    throw new ControlPlaneError('JOB_NOT_FOUND', `Memory operation job '${jobId}' was not found`, {
      jobId,
    });
  }
  return job;
}

function resolveJobEmbeddingClient(
  opts: CreateMemoryOpsHandlersOptions,
  credentialId: string | null,
) {
  if (!opts.encryptionKey) {
    throw new ControlPlaneError(
      'CREDENTIAL_ENCRYPTION_KEY_MISSING',
      'CREDENTIAL_ENCRYPTION_KEY is required to run memory operation embedding jobs',
    );
  }
  return resolveEmbeddingClient({
    pool: opts.pool,
    db: opts.db,
    encryptionKey: opts.encryptionKey,
    logger: opts.logger,
    credentialId: credentialId ?? undefined,
  });
}
