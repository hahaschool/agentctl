import { afterEach, describe, expect, it, vi } from 'vitest';

import type { JobEvent } from './peer-update-jobs.js';
import { PeerUpdateJobStore } from './peer-update-jobs.js';

describe('PeerUpdateJobStore', () => {
  let store: PeerUpdateJobStore;

  afterEach(() => {
    store?.destroy();
  });

  it('creates a job with running status', () => {
    store = new PeerUpdateJobStore();
    const job = store.createJob('peer-1');
    expect(job.id).toBeDefined();
    expect(job.peerId).toBe('peer-1');
    expect(job.status).toBe('running');
    expect(job.logs).toEqual([]);
  });

  it('retrieves job by id', () => {
    store = new PeerUpdateJobStore();
    const job = store.createJob('peer-1');
    expect(store.getJob(job.id)).toBe(job);
    expect(store.getJob('nonexistent')).toBeNull();
  });

  it('finds active job for peer', () => {
    store = new PeerUpdateJobStore();
    const job = store.createJob('peer-1');
    expect(store.getActiveJobForPeer('peer-1')).toBe(job);
    expect(store.getActiveJobForPeer('peer-2')).toBeNull();
  });

  it('pushes log lines and notifies listeners', () => {
    store = new PeerUpdateJobStore();
    const job = store.createJob('peer-1');
    const events: JobEvent[] = [];
    store.subscribe(job.id, (e) => events.push(e));

    store.pushLog(job.id, 'stdout', 'hello');
    store.pushLog(job.id, 'stderr', 'warning');

    expect(job.logs).toHaveLength(2);
    expect(job.logs[0]).toMatchObject({ stream: 'stdout', text: 'hello' });
    expect(job.logs[1]).toMatchObject({ stream: 'stderr', text: 'warning' });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'log', line: { stream: 'stdout', text: 'hello' } });
  });

  it('completes a job and notifies listeners', () => {
    store = new PeerUpdateJobStore();
    const job = store.createJob('peer-1');
    const events: JobEvent[] = [];
    store.subscribe(job.id, (e) => events.push(e));

    const result = { exitCode: 0, durationMs: 5000, previousVersion: '0.4.0', newVersion: '0.5.0' };
    store.complete(job.id, result);

    expect(job.status).toBe('success');
    expect(job.result).toEqual(result);
    expect(job.completedAt).not.toBeNull();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'status', status: 'success', result });
  });

  it('fails a job and notifies listeners', () => {
    store = new PeerUpdateJobStore();
    const job = store.createJob('peer-1');
    const events: JobEvent[] = [];
    store.subscribe(job.id, (e) => events.push(e));

    store.fail(job.id, 'script crashed');

    expect(job.status).toBe('failed');
    expect(job.error).toBe('script crashed');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'status', status: 'failed', error: 'script crashed' });
  });

  it('unsubscribe stops notifications', () => {
    store = new PeerUpdateJobStore();
    const job = store.createJob('peer-1');
    const events: JobEvent[] = [];
    const unsub = store.subscribe(job.id, (e) => events.push(e));

    store.pushLog(job.id, 'stdout', 'before');
    unsub();
    store.pushLog(job.id, 'stdout', 'after');

    expect(events).toHaveLength(1);
  });

  it('getActiveJobForPeer returns null after completion', () => {
    store = new PeerUpdateJobStore();
    const job = store.createJob('peer-1');
    store.complete(job.id, { exitCode: 0, durationMs: 100, previousVersion: '1', newVersion: '2' });
    expect(store.getActiveJobForPeer('peer-1')).toBeNull();
  });

  it('destroy clears all jobs', () => {
    store = new PeerUpdateJobStore();
    const job = store.createJob('peer-1');
    store.destroy();
    expect(store.getJob(job.id)).toBeNull();
  });
});
