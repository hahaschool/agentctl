import type { ImportJob, ImportJobSource } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

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
