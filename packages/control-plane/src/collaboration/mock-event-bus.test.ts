import type { SpaceEvent } from '@agentctl/shared';
import { describe, expect, it, vi } from 'vitest';

import { MockEventBus } from './mock-event-bus.js';

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

describe('MockEventBus', () => {
  it('publishes events and notifies subscribers', async () => {
    const bus = new MockEventBus();
    const handler = vi.fn();

    bus.subscribe('space-1', handler);
    await bus.publish(makeEvent());

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: 'evt-1' }));
    expect(bus.getPublished()).toHaveLength(1);
  });

  it('does not notify subscribers for other spaces', async () => {
    const bus = new MockEventBus();
    const handler = vi.fn();

    bus.subscribe('space-2', handler);
    await bus.publish(makeEvent({ spaceId: 'space-1' }));

    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribe stops notifications', async () => {
    const bus = new MockEventBus();
    const handler = vi.fn();

    const unsub = bus.subscribe('space-1', handler);
    unsub();
    await bus.publish(makeEvent());

    expect(handler).not.toHaveBeenCalled();
  });

  it('close prevents further publishes', async () => {
    const bus = new MockEventBus();
    const handler = vi.fn();

    bus.subscribe('space-1', handler);
    await bus.close();
    await bus.publish(makeEvent());

    expect(handler).not.toHaveBeenCalled();
    expect(bus.getPublished()).toHaveLength(0);
  });

  it('handles async handlers', async () => {
    const bus = new MockEventBus();
    const results: string[] = [];

    bus.subscribe('space-1', async (event) => {
      results.push(event.id);
    });

    await bus.publish(makeEvent({ id: 'async-1' }));
    expect(results).toEqual(['async-1']);
  });

  it('clearPublished resets the published list', async () => {
    const bus = new MockEventBus();
    await bus.publish(makeEvent());
    expect(bus.getPublished()).toHaveLength(1);

    bus.clearPublished();
    expect(bus.getPublished()).toHaveLength(0);
  });
});
