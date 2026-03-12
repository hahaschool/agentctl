import type { SpaceEvent } from '@agentctl/shared';

import type { EventBus, EventHandler } from './event-bus.js';

/**
 * In-memory EventBus for tests and environments without NATS.
 *
 * Delivers events synchronously to all matching subscribers.
 */
export class MockEventBus implements EventBus {
  private readonly subscribers = new Map<string, Set<EventHandler>>();
  private readonly published: SpaceEvent[] = [];
  private closed = false;

  async publish(event: SpaceEvent): Promise<void> {
    if (this.closed) {
      return;
    }

    this.published.push(event);

    const handlers = this.subscribers.get(event.spaceId);
    if (!handlers) {
      return;
    }

    const promises: Promise<void>[] = [];
    for (const handler of handlers) {
      const result = handler(event);
      if (result instanceof Promise) {
        promises.push(result);
      }
    }

    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }

  subscribe(spaceId: string, handler: EventHandler): () => void {
    const handlers = this.subscribers.get(spaceId) ?? new Set();
    handlers.add(handler);
    this.subscribers.set(spaceId, handlers);

    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.subscribers.delete(spaceId);
      }
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.subscribers.clear();
  }

  /** Test helper: get all published events. */
  getPublished(): readonly SpaceEvent[] {
    return this.published;
  }

  /** Test helper: clear published events. */
  clearPublished(): void {
    this.published.length = 0;
  }
}
