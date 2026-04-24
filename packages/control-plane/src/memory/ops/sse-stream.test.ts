import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { streamJobEvents } from './sse-stream.js';

function createEvent(eventId: bigint, eventType = 'progress') {
  return {
    eventId,
    jobId: 'job-1',
    eventType,
    level: 'info',
    message: `event-${eventId.toString()}`,
    progress: null,
    payload: null,
    createdAt: '2026-04-25T00:00:00.000Z',
  };
}

describe('streamJobEvents', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('replays from Last-Event-Id, emits heartbeats, and cleans up listeners', async () => {
    vi.useFakeTimers();
    const notificationClient = new EventEmitter() as EventEmitter & {
      query: ReturnType<typeof vi.fn>;
      release: ReturnType<typeof vi.fn>;
    };
    notificationClient.query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // LISTEN
      .mockResolvedValueOnce({ rows: [] }); // UNLISTEN
    notificationClient.release = vi.fn();

    const pool = {
      connect: vi.fn(async () => notificationClient),
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [createEvent(2n)] })
        .mockResolvedValueOnce({ rows: [createEvent(3n)] }),
    };

    const requestRaw = new EventEmitter();
    const raw = {
      destroyed: false,
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    };
    const reply = {
      hijack: vi.fn(),
      raw,
    };

    await streamJobEvents({
      pool: pool as never,
      requestRaw: requestRaw as never,
      reply: reply as never,
      jobId: 'job-1',
      lastEventId: '1',
    });

    expect(reply.hijack).toHaveBeenCalledTimes(1);
    expect(raw.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        'Content-Type': 'text/event-stream',
      }),
    );
    expect(raw.write).toHaveBeenCalledWith(expect.stringContaining('id: 2'));

    notificationClient.emit('notification', {
      channel: 'memory_ops_events',
      payload: JSON.stringify({ jobId: 'job-1', eventId: '3' }),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(raw.write).toHaveBeenCalledWith(expect.stringContaining('id: 3'));

    vi.advanceTimersByTime(15_000);
    expect(raw.write).toHaveBeenCalledWith(': heartbeat\n\n');

    requestRaw.emit('close');
    await vi.runAllTicks();

    expect(notificationClient.query).toHaveBeenCalledWith('UNLISTEN memory_ops_events');
    expect(notificationClient.release).toHaveBeenCalledTimes(1);

    const writesBefore = raw.write.mock.calls.length;
    vi.advanceTimersByTime(30_000);
    expect(raw.write.mock.calls.length).toBe(writesBefore);
  });
});
