import type { ImportJob, ImportJobSource } from '@agentctl/shared';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';

import { readRateLimitEnv } from '../rate-limit.js';

// ---------------------------------------------------------------------------
// Rate limit constants — the import start/cancel paths mutate a singleton job
// state and spawn a long-running progress interval. Cancel reuses the same
// limiter so a flood can't rapidly toggle the interval. Status is rate-limited
// as well because polling hot-loops against an in-memory job would still exert
// pressure on the control-plane event loop.
// ---------------------------------------------------------------------------

const MEMORY_IMPORT_RATE_LIMIT = {
  max: 20,
  timeWindow: 60_000,
} as const;

// ---------------------------------------------------------------------------
// In-memory singleton job state (one active job at a time)
// ---------------------------------------------------------------------------

let activeJob: ImportJob | null = null;

function createJob(source: ImportJobSource, _dbPath: string): ImportJob {
  return {
    id: `import-${Date.now()}`,
    source,
    status: 'running',
    progress: { current: 0, total: 100 },
    imported: 0,
    skipped: 0,
    errors: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
  };
}

function updateJobStatus(job: ImportJob, updates: Partial<ImportJob>): ImportJob {
  return { ...job, ...updates };
}

function simulateImportProgress(jobId: string): void {
  const tick = setInterval(() => {
    if (!activeJob || activeJob.id !== jobId) {
      clearInterval(tick);
      return;
    }
    const current = activeJob.progress.current + 10;
    if (current >= 100) {
      activeJob = updateJobStatus(activeJob, {
        status: 'completed',
        progress: { current: 100, total: 100 },
        imported: Math.floor(Math.random() * 80) + 20,
        skipped: Math.floor(Math.random() * 5),
        errors: 0,
        completedAt: new Date().toISOString(),
      });
      clearInterval(tick);
    } else {
      activeJob = updateJobStatus(activeJob, {
        progress: { current, total: 100 },
        imported: Math.floor(current * 0.8),
      });
    }
  }, 1000);
}

/** Reset active job — exported for test isolation only. */
export function resetActiveJobForTest(): void {
  activeJob = null;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

type StartImportBody = {
  source: ImportJobSource;
  dbPath: string;
};

export const memoryImportRoutes: FastifyPluginAsync = async (app) => {
  const memoryImportRateLimitMax = readRateLimitEnv(
    'MEMORY_IMPORT_RATE_LIMIT_MAX',
    MEMORY_IMPORT_RATE_LIMIT.max,
  );
  const memoryImportRateLimitWindowMs = readRateLimitEnv(
    'MEMORY_IMPORT_RATE_LIMIT_WINDOW_MS',
    MEMORY_IMPORT_RATE_LIMIT.timeWindow,
  );
  const memoryImportRateLimitError = () => ({
    statusCode: 429,
    error: 'RATE_LIMITED',
    message: 'Too many memory import requests',
  });
  const memoryImportFastifyRateLimit = {
    max: memoryImportRateLimitMax,
    timeWindow: memoryImportRateLimitWindowMs,
    errorResponseBuilder: memoryImportRateLimitError,
  } as const;

  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) =>
      request.ip ??
      (typeof request.headers['x-forwarded-for'] === 'string'
        ? request.headers['x-forwarded-for']
        : 'unknown'),
    errorResponseBuilder: memoryImportRateLimitError,
  });

  /** POST /api/memory/import — start a new import job */
  app.post<{ Body: StartImportBody }>('/import', {
    schema: {
      body: {
        type: 'object',
        required: ['source', 'dbPath'],
        properties: {
          source: { type: 'string', enum: ['claude-mem', 'jsonl-history'] },
          dbPath: { type: 'string' },
        },
      },
    },
    config: { rateLimit: memoryImportFastifyRateLimit },
    preHandler: [app.rateLimit(memoryImportFastifyRateLimit)],
    handler: async (request, reply) => {
      if (activeJob && activeJob.status === 'running') {
        return reply.status(409).send({ ok: false, error: 'An import job is already running' });
      }
      const { source, dbPath } = request.body;
      activeJob = createJob(source, dbPath);
      simulateImportProgress(activeJob.id);
      return reply.status(202).send({ ok: true, job: activeJob });
    },
  });

  /** GET /api/memory/import/status — poll the active job */
  app.get('/import/status', {
    handler: async (_request, reply) => {
      if (!activeJob) {
        return reply.status(404).send({ ok: false, error: 'No active import job' });
      }
      return reply.send({ ok: true, job: activeJob });
    },
  });

  /** DELETE /api/memory/import/:id — cancel a running import */
  app.delete<{ Params: { id: string } }>('/import/:id', {
    config: { rateLimit: memoryImportFastifyRateLimit },
    preHandler: [app.rateLimit(memoryImportFastifyRateLimit)],
    handler: async (request, reply) => {
      const { id } = request.params;
      if (!activeJob || activeJob.id !== id) {
        return reply.status(404).send({ ok: false, error: 'Import job not found' });
      }
      activeJob = updateJobStatus(activeJob, {
        status: 'cancelled',
        completedAt: new Date().toISOString(),
      });
      return reply.send({ ok: true, job: activeJob });
    },
  });
};
