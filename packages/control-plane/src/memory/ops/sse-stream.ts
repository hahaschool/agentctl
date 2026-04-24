import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';

import { JobEventsRepository, type MemoryOpsJobEvent } from './job-events-repository.js';
import type { JobsRepository } from './jobs-repository.js';

const HEARTBEAT_MS = 15_000;

export type StreamJobEventsOptions = {
  pool: Pool;
  requestRaw?: NodeJS.EventEmitter;
  request?: FastifyRequest;
  reply: FastifyReply;
  jobId: string;
  lastEventId?: string | null;
  afterEventId?: string | null;
  jobsRepository?: JobsRepository;
  machineId?: string;
};

export async function streamJobEvents({
  pool,
  requestRaw,
  request,
  reply,
  jobId,
  lastEventId = null,
  afterEventId = null,
  jobsRepository,
  machineId,
}: StreamJobEventsOptions): Promise<void> {
  const streamSource = requestRaw ?? request?.raw;
  if (!streamSource) {
    throw new ControlPlaneError('VALIDATION_ERROR', 'SSE request stream is required');
  }

  if (jobsRepository) {
    const job = await jobsRepository.findById(jobId);
    if (!job) {
      throw new ControlPlaneError(
        'JOB_NOT_FOUND',
        `Memory operation job '${jobId}' was not found`,
        {
          id: jobId,
        },
      );
    }
    if (machineId && job.executorMachineId !== machineId) {
      throw new ControlPlaneError('REMOTE_PEER_JOB', 'Job events are local to the executor peer', {
        id: jobId,
        executorMachineId: job.executorMachineId,
        machineId,
      });
    }
  }

  const events = new JobEventsRepository(pool);
  const listenClient = await pool.connect();
  await listenClient.query('LISTEN memory_ops_events');

  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const headerLastEventId =
    typeof request?.headers['last-event-id'] === 'string' ? request.headers['last-event-id'] : null;
  let cursor = afterEventId ?? lastEventId ?? headerLastEventId ?? '0';
  let closed = false;
  let flushPromise: Promise<void> | null = null;
  let flushAgain = false;

  const flush = async (): Promise<void> => {
    if (closed) {
      return;
    }
    const backlog = await events.list(jobId, cursor);
    for (const event of backlog) {
      cursor = event.eventId;
      if (raw.destroyed) {
        return;
      }
      raw.write(renderEvent(event));
    }
  };

  const scheduleFlush = (): void => {
    if (closed) {
      return;
    }
    if (flushPromise) {
      flushAgain = true;
      return;
    }

    flushPromise = flush()
      .catch(() => {
        if (!raw.destroyed) {
          raw.write('event: error\ndata: {"error":"STREAM_FAILED"}\n\n');
        }
      })
      .finally(() => {
        flushPromise = null;
        if (flushAgain) {
          flushAgain = false;
          scheduleFlush();
        }
      });
  };

  const onNotification = (message: { channel?: string; payload?: string }): void => {
    if (closed || message.channel !== 'memory_ops_events') {
      return;
    }

    if (!message.payload) {
      scheduleFlush();
      return;
    }

    try {
      const parsed = JSON.parse(message.payload) as { jobId?: string } | null;
      if (!parsed?.jobId || parsed.jobId === jobId) {
        scheduleFlush();
      }
    } catch {
      if (message.payload === jobId) {
        scheduleFlush();
      }
    }
  };

  const heartbeat = setInterval(() => {
    if (!closed && !raw.destroyed) {
      raw.write(': heartbeat\n\n');
    }
  }, HEARTBEAT_MS);

  const cleanup = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    clearInterval(heartbeat);
    listenClient.off('notification', onNotification);
    void releaseListenClient(listenClient);
    if (!raw.destroyed) {
      raw.end();
    }
  };

  listenClient.on('notification', onNotification);
  streamSource.on('close', cleanup);
  raw.on?.('close', cleanup);
  raw.on?.('error', cleanup);

  try {
    await flush();
  } catch {
    if (!raw.destroyed) {
      raw.write('event: error\ndata: {"error":"STREAM_FAILED"}\n\n');
    }
    cleanup();
  }
}

function renderEvent(event: MemoryOpsJobEvent): string {
  return `id: ${event.eventId}\nevent: ${event.eventType}\ndata: ${JSON.stringify(event)}\n\n`;
}

async function releaseListenClient(client: PoolClient): Promise<void> {
  try {
    await client.query('UNLISTEN memory_ops_events');
  } finally {
    client.release();
  }
}
