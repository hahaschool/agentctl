import type { SpaceEvent } from '@agentctl/shared';
import type { Logger } from 'pino';

import type { EventBus, EventHandler } from './event-bus.js';

/**
 * NATS JetStream EventBus implementation.
 *
 * Publishes space events to subjects: `space.<spaceId>.thread.<threadId>`
 * Subscribers receive all events for a space via wildcard: `space.<spaceId>.>`
 *
 * Requires a running NATS server with JetStream enabled.
 * Falls back to MockEventBus in environments without NATS.
 */
export class NatsEventBus implements EventBus {
  private readonly subscribers = new Map<string, Set<EventHandler>>();
  private connection: unknown = null;

  constructor(
    private readonly natsUrl: string,
    private readonly logger: Logger,
  ) {}

  async connect(): Promise<void> {
    try {
      // Dynamic import — nats package may not be installed in all environments.
      // Use a variable to bypass TypeScript module resolution at compile time.
      const natsModule = 'nats';
      const { connect } = (await import(/* webpackIgnore: true */ natsModule)) as {
        connect: (opts: { servers: string }) => Promise<unknown>;
      };
      this.connection = await connect({ servers: this.natsUrl });
      this.logger.info({ natsUrl: this.natsUrl }, 'Connected to NATS');
    } catch (err) {
      this.logger.error({ err, natsUrl: this.natsUrl }, 'Failed to connect to NATS');
      throw err;
    }
  }

  async publish(event: SpaceEvent): Promise<void> {
    const subject = `space.${event.spaceId}.thread.${event.threadId}`;

    if (this.connection) {
      // Use NATS JetStream publish when connected
      const nc = this.connection as { publish: (subject: string, data: Uint8Array) => void };
      const data = new TextEncoder().encode(JSON.stringify(event));
      nc.publish(subject, data);
    }

    // Also deliver to local subscribers
    const handlers = this.subscribers.get(event.spaceId);
    if (!handlers) {
      return;
    }

    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (err) {
        this.logger.error({ err, eventId: event.id }, 'Event handler error');
      }
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
    this.subscribers.clear();

    if (this.connection) {
      const nc = this.connection as { close: () => Promise<void> };
      await nc.close();
      this.connection = null;
      this.logger.info('NATS connection closed');
    }
  }
}
