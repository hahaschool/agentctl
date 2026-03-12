import type { SpaceEvent, SubscriptionFilter } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { WebSocket } from 'ws';

import type { EventBus } from './event-bus.js';

const VISIBILITY_LEVELS: Record<string, number> = {
  public: 0,
  internal: 1,
  silent: 2,
};

/**
 * Determines whether a given event passes the subscription filter.
 */
export function matchesFilter(event: SpaceEvent, filter?: SubscriptionFilter): boolean {
  if (!filter) {
    return true;
  }

  // Thread type filter — currently we don't have thread type on the event,
  // so this is a no-op until we enrich events. The filter structure is
  // already in place for when thread metadata is available.

  // Visibility filter: only show events at or above the minimum visibility
  if (filter.minVisibility) {
    const eventLevel = VISIBILITY_LEVELS[event.visibility] ?? 0;
    const minLevel = VISIBILITY_LEVELS[filter.minVisibility] ?? 0;
    if (eventLevel > minLevel) {
      return false;
    }
  }

  return true;
}

type ClientConnection = {
  readonly ws: WebSocket;
  readonly spaceId: string;
  readonly filter?: SubscriptionFilter;
};

/**
 * WebSocket event gateway that fans out space events to connected clients.
 *
 * Clients connect to `/ws/spaces/:spaceId/events` and receive a JSON stream
 * of SpaceEvents filtered by their subscription.
 *
 * Optional query parameter `?minVisibility=public|internal` controls
 * the minimum visibility level of events received.
 */
export class EventGateway {
  private readonly clients = new Set<ClientConnection>();
  private readonly unsubscribes = new Map<string, () => void>();

  constructor(
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
  ) {}

  /**
   * Register the WebSocket route on a Fastify instance.
   * Requires @fastify/websocket to be registered first.
   */
  register(app: FastifyInstance): void {
    app.get<{
      Params: { spaceId: string };
      Querystring: { minVisibility?: string };
    }>('/ws/spaces/:spaceId/events', { websocket: true }, (socket, request) => {
      const { spaceId } = request.params;
      const minVisibility = request.query.minVisibility as 'public' | 'internal' | undefined;

      const filter: SubscriptionFilter | undefined = minVisibility ? { minVisibility } : undefined;

      const client: ClientConnection = {
        ws: socket as unknown as WebSocket,
        spaceId,
        filter,
      };

      this.addClient(client);

      socket.on('close', () => {
        this.removeClient(client);
      });

      socket.on('error', (err: Error) => {
        this.logger.error({ err, spaceId }, 'WebSocket client error');
        this.removeClient(client);
      });
    });
  }

  private addClient(client: ClientConnection): void {
    this.clients.add(client);
    this.ensureSubscription(client.spaceId);

    this.logger.info(
      { spaceId: client.spaceId, totalClients: this.clients.size },
      'WebSocket client connected',
    );
  }

  private removeClient(client: ClientConnection): void {
    this.clients.delete(client);

    // Check if any clients still need this space subscription
    const hasClientsForSpace = [...this.clients].some((c) => c.spaceId === client.spaceId);
    if (!hasClientsForSpace) {
      const unsub = this.unsubscribes.get(client.spaceId);
      if (unsub) {
        unsub();
        this.unsubscribes.delete(client.spaceId);
      }
    }

    this.logger.debug(
      { spaceId: client.spaceId, totalClients: this.clients.size },
      'WebSocket client disconnected',
    );
  }

  private ensureSubscription(spaceId: string): void {
    if (this.unsubscribes.has(spaceId)) {
      return;
    }

    const unsub = this.eventBus.subscribe(spaceId, (event) => {
      this.fanout(event);
    });

    this.unsubscribes.set(spaceId, unsub);
  }

  private fanout(event: SpaceEvent): void {
    for (const client of this.clients) {
      if (client.spaceId !== event.spaceId) {
        continue;
      }

      if (!matchesFilter(event, client.filter)) {
        continue;
      }

      try {
        client.ws.send(JSON.stringify(event));
      } catch (err) {
        this.logger.error({ err, eventId: event.id }, 'Failed to send event to WebSocket client');
      }
    }
  }

  /**
   * Gracefully close all client connections and unsubscribe from the bus.
   */
  async close(): Promise<void> {
    for (const unsub of this.unsubscribes.values()) {
      unsub();
    }
    this.unsubscribes.clear();

    for (const client of this.clients) {
      try {
        client.ws.close();
      } catch {
        // Client already closed
      }
    }
    this.clients.clear();
  }

  /** Get count of connected clients (for monitoring). */
  getClientCount(): number {
    return this.clients.size;
  }
}
