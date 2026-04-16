// ---------------------------------------------------------------------------
// In-memory store for async peer-update jobs. Each job tracks a running
// `peer-update.sh` process, buffers log lines, and notifies SSE listeners
// as output arrives. Jobs auto-expire after JOB_TTL_MS so memory doesn't
// grow unbounded.
//
// §33.11 — async update execution with log streaming.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';

/** How long a completed/failed job is kept before cleanup. */
const JOB_TTL_MS = 10 * 60 * 1000; // 10 minutes

export type LogLine = {
  stream: 'stdout' | 'stderr';
  text: string;
  ts: number;
};

export type JobStatus = 'running' | 'success' | 'failed';

export type JobResult = {
  exitCode: number;
  durationMs: number;
  previousVersion: string;
  newVersion: string;
};

export type JobEvent =
  | { type: 'log'; line: LogLine }
  | { type: 'status'; status: JobStatus; result?: JobResult; error?: string };

export type JobListener = (event: JobEvent) => void;

export type PeerUpdateJob = {
  id: string;
  peerId: string;
  status: JobStatus;
  logs: LogLine[];
  result: JobResult | null;
  error: string | null;
  startedAt: number;
  completedAt: number | null;
  listeners: Set<JobListener>;
};

export class PeerUpdateJobStore {
  private readonly jobs = new Map<string, PeerUpdateJob>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    this.cleanupTimer.unref();
  }

  createJob(peerId: string): PeerUpdateJob {
    const job: PeerUpdateJob = {
      id: randomUUID(),
      peerId,
      status: 'running',
      logs: [],
      result: null,
      error: null,
      startedAt: Date.now(),
      completedAt: null,
      listeners: new Set(),
    };
    this.jobs.set(job.id, job);
    return job;
  }

  getJob(jobId: string): PeerUpdateJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  /** Get the currently-running job for a peer, if any. */
  getActiveJobForPeer(peerId: string): PeerUpdateJob | null {
    for (const job of this.jobs.values()) {
      if (job.peerId === peerId && job.status === 'running') return job;
    }
    return null;
  }

  pushLog(jobId: string, stream: 'stdout' | 'stderr', text: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    const line: LogLine = { stream, text, ts: Date.now() };
    job.logs.push(line);
    const event: JobEvent = { type: 'log', line };
    for (const listener of job.listeners) {
      listener(event);
    }
  }

  complete(jobId: string, result: JobResult): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = 'success';
    job.result = result;
    job.completedAt = Date.now();
    const event: JobEvent = { type: 'status', status: 'success', result };
    for (const listener of job.listeners) {
      listener(event);
    }
  }

  fail(jobId: string, error: string, result?: JobResult): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = 'failed';
    job.error = error;
    job.result = result ?? null;
    job.completedAt = Date.now();
    const event: JobEvent = { type: 'status', status: 'failed', result, error };
    for (const listener of job.listeners) {
      listener(event);
    }
  }

  subscribe(jobId: string, listener: JobListener): () => void {
    const job = this.jobs.get(jobId);
    if (!job) return () => {};
    job.listeners.add(listener);
    return () => {
      job.listeners.delete(listener);
    };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (job.completedAt && now - job.completedAt > JOB_TTL_MS) {
        this.jobs.delete(id);
      }
      // Also clean up stale running jobs (shouldn't happen, but safety net)
      if (job.status === 'running' && now - job.startedAt > JOB_TTL_MS) {
        this.jobs.delete(id);
      }
    }
  }

  /** Tear down the cleanup timer (for tests). */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.jobs.clear();
  }
}
