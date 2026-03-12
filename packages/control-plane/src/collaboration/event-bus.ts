import type { SpaceEvent } from '@agentctl/shared';

/**
 * Callback invoked when an event is received on the bus.
 */
export type EventHandler = (event: SpaceEvent) => void | Promise<void>;

/**
 * Transport-agnostic event bus interface.
 *
 * Implementations:
 *  - NatsEventBus: NATS JetStream for production
 *  - MockEventBus: in-memory for tests and CI
 */
export type EventBus = {
  /**
   * Publish a single event to the bus.
   * Subject pattern: `space.<spaceId>.thread.<threadId>`
   */
  readonly publish: (event: SpaceEvent) => Promise<void>;

  /**
   * Subscribe to events for a specific space.
   * Returns an unsubscribe function.
   */
  readonly subscribe: (spaceId: string, handler: EventHandler) => () => void;

  /**
   * Gracefully close all connections.
   */
  readonly close: () => Promise<void>;
};
