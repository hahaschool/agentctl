import { ControlPlaneError } from '@agentctl/shared';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { Database } from '../../db/index.js';
import { resolveEmbeddingClient } from '../embedding-client-factory.js';
import { KnowledgeMaintenance } from '../knowledge-maintenance.js';
import { KnowledgeSynthesis } from '../knowledge-synthesis.js';
import { MemoryStore } from '../memory-store.js';
import { consolidationHandler } from './consolidation.js';
import { drawerBackfillHandler } from './drawer-backfill.js';
import { embeddingBackfillHandler } from './embedding-backfill.js';
import type { JobEventsRepository } from './job-events-repository.js';
import type { JobsRepository } from './jobs-repository.js';
import type { MemoryOpsQueueName } from './queue.js';
import { synthesisHandler } from './synthesis.js';
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
): Partial<Record<MemoryOpsQueueName, MemoryOpsJobHandler>> {
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
    consolidation: async (bullJob) => {
      const job = await loadJob(opts.jobsRepository, bullJob.data.dbJobId);
      const memoryStore = new MemoryStore({ pool: opts.pool, logger: opts.logger });
      await consolidationHandler({
        jobId: job.id,
        params: job.params,
        logger: opts.logger,
        maintenance: new KnowledgeMaintenance({
          pool: opts.pool,
          memoryStore,
          logger: opts.logger,
        }),
        jobsRepository: opts.jobsRepository,
        eventsRepository: opts.eventsRepository,
      });
    },
    synthesis: async (bullJob) => {
      const job = await loadJob(opts.jobsRepository, bullJob.data.dbJobId);
      await synthesisHandler({
        jobId: job.id,
        params: job.params,
        logger: opts.logger,
        synthesis: new KnowledgeSynthesis({ pool: opts.pool, logger: opts.logger }),
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
