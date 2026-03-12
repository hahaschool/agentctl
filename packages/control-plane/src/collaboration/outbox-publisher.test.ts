import type { SpaceEvent } from '@agentctl/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockEventBus } from './mock-event-bus.js';
import { OutboxPublisher } from './outbox-publisher.js';

// ── Mock helpers ────────────────────────────────────────────

function createMockLogger() {
  const logger = {
    child: () => logger,
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    level: 'silent',
  };
  return logger as unknown as import('pino').Logger;
}

function makeEvent(overrides: Partial<SpaceEvent> = {}): SpaceEvent {
  return {
    id: 'evt-1',
    spaceId: 'space-1',
    threadId: 'thread-1',
    sequenceNum: 1,
    type: 'message',
    senderType: 'agent',
    senderId: 'agent-1',
    payload: {},
    visibility: 'public',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeDbRow(event: SpaceEvent, published = false) {
  return {
    id: event.id,
    spaceId: event.spaceId,
    threadId: event.threadId,
    sequenceNum: event.sequenceNum,
    idempotencyKey: `key-${event.id}`,
    correlationId: 'corr-1',
    type: event.type,
    senderType: event.senderType,
    senderId: event.senderId,
    payload: event.payload,
    visibility: event.visibility,
    published,
    createdAt: new Date(),
  };
}

// ── Tests ───────────────────────────────────────────────────

describe('OutboxPublisher', () => {
  let mockBus: MockEventBus;
  let logger: import('pino').Logger;
  let mockDb: Record<string, unknown>;
  let selectMock: ReturnType<typeof vi.fn>;
  let updateMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockBus = new MockEventBus();
    logger = createMockLogger();

    // Build a chainable mock for db.select().from().where().orderBy().limit()
    const limitFn = vi.fn().mockResolvedValue([]);
    const orderByFn = vi.fn().mockReturnValue({ limit: limitFn });
    const whereFn = vi.fn().mockReturnValue({ orderBy: orderByFn });
    const fromFn = vi.fn().mockReturnValue({ where: whereFn });
    selectMock = vi.fn().mockReturnValue({ from: fromFn });

    // Build chainable mock for db.update().set().where()
    const updateWhereFn = vi.fn().mockResolvedValue([]);
    const setFn = vi.fn().mockReturnValue({ where: updateWhereFn });
    updateMock = vi.fn().mockReturnValue({ set: setFn });

    mockDb = {
      select: selectMock,
      update: updateMock,
      execute: vi.fn().mockResolvedValue({ rows: [{ count: '0' }] }),
    };

    // Make the limit mock accessible for setting return values
    (mockDb as Record<string, unknown>)._limitFn = limitFn;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publishes unpublished events and marks them published', async () => {
    const event = makeEvent();
    const row = makeDbRow(event, false);

    const limitFn = (mockDb as Record<string, unknown>)._limitFn as ReturnType<typeof vi.fn>;
    // First call from start()'s auto-poll: return empty
    limitFn.mockResolvedValueOnce([]);
    // Second call from our manual pollOnce: return the event row
    limitFn.mockResolvedValueOnce([row]);

    const publisher = new OutboxPublisher(mockDb as never, mockBus, logger, {
      pollIntervalMs: 600_000,
    });

    publisher.start();
    // Wait for start's auto-poll to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    const count = await publisher.pollOnce();

    expect(count).toBe(1);
    expect(mockBus.getPublished()).toHaveLength(1);
    expect(mockBus.getPublished()[0].id).toBe('evt-1');
    expect(updateMock).toHaveBeenCalled();

    await publisher.stop();
  });

  it('returns 0 when no unpublished events exist', async () => {
    const publisher = new OutboxPublisher(mockDb as never, mockBus, logger, {
      pollIntervalMs: 60_000,
    });

    const count = await publisher.pollOnce();

    expect(count).toBe(0);
    expect(mockBus.getPublished()).toHaveLength(0);
  });

  it('stops processing batch on publish error', async () => {
    const event1 = makeEvent({ id: 'evt-1' });
    const event2 = makeEvent({ id: 'evt-2' });
    const rows = [makeDbRow(event1), makeDbRow(event2)];

    const limitFn = (mockDb as Record<string, unknown>)._limitFn as ReturnType<typeof vi.fn>;
    // First call from start()'s auto-poll: return empty
    limitFn.mockResolvedValueOnce([]);
    // Second call from our manual pollOnce: return the failing rows
    limitFn.mockResolvedValueOnce(rows);

    // Make the bus fail on publish
    const failBus = {
      publish: vi.fn().mockRejectedValue(new Error('NATS down')),
      subscribe: vi.fn().mockReturnValue(() => {}),
      close: vi.fn(),
    };

    const publisher = new OutboxPublisher(mockDb as never, failBus as never, logger, {
      pollIntervalMs: 600_000,
    });

    publisher.start();

    // Wait for start's auto-poll to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    const count = await publisher.pollOnce();

    expect(count).toBe(0);
    expect(failBus.publish).toHaveBeenCalledTimes(1);

    await publisher.stop();
  });

  it('start and stop lifecycle works', async () => {
    const publisher = new OutboxPublisher(mockDb as never, mockBus, logger, {
      pollIntervalMs: 60_000,
    });

    publisher.start();
    await publisher.stop();

    // Should not throw
    expect(true).toBe(true);
  });

  it('does not poll when stopped', async () => {
    const publisher = new OutboxPublisher(mockDb as never, mockBus, logger, {
      pollIntervalMs: 60_000,
    });

    // Never started, running=false
    const count = await publisher.pollOnce();
    expect(count).toBe(0);
  });
});
