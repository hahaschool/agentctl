import type { WsServerMessage } from '@agentctl/shared';
import type { WebSocket } from 'ws';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WsConnection = {
  id: string;
  socket: WebSocket;
  subscribedAgents: Set<string>;
  lastPingAt: number;
  isAlive: boolean;
};

type WsConnectionManagerOptions = {
  /** How often (ms) the server pings every connection. Default: 30 000. */
  heartbeatIntervalMs?: number;
  /**
   * How long (ms) a connection may go without responding to a ping before it
   * is considered dead. Default: 10 000.
   */
  heartbeatTimeoutMs?: number;
};

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// WsConnectionManager
// ---------------------------------------------------------------------------

export class WsConnectionManager {
  private readonly connections = new Map<string, WsConnection>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;

  constructor(options?: WsConnectionManagerOptions) {
    this.heartbeatIntervalMs = options?.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.heartbeatTimeoutMs = options?.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
  }

  // -----------------------------------------------------------------------
  // Connection lifecycle
  // -----------------------------------------------------------------------

  /** Register a new WebSocket connection. */
  add(id: string, socket: WebSocket): void {
    const conn: WsConnection = {
      id,
      socket,
      subscribedAgents: new Set(),
      lastPingAt: Date.now(),
      isAlive: true,
    };

    this.connections.set(id, conn);
  }

  /** Remove a connection and clean up its subscriptions. */
  remove(id: string): void {
    this.connections.delete(id);
  }

  // -----------------------------------------------------------------------
  // Subscriptions
  // -----------------------------------------------------------------------

  /** Subscribe `connectionId` to events for `agentId`. */
  subscribe(connectionId: string, agentId: string): void {
    const conn = this.connections.get(connectionId);

    if (conn) {
      conn.subscribedAgents.add(agentId);
    }
  }

  /** Unsubscribe `connectionId` from events for `agentId`. */
  unsubscribe(connectionId: string, agentId: string): void {
    const conn = this.connections.get(connectionId);

    if (conn) {
      conn.subscribedAgents.delete(agentId);
    }
  }

  // -----------------------------------------------------------------------
  // Messaging
  // -----------------------------------------------------------------------

  /** Broadcast `message` to every connection subscribed to `agentId`. */
  broadcast(agentId: string, message: WsServerMessage): void {
    const payload = JSON.stringify(message);

    for (const conn of this.connections.values()) {
      if (conn.subscribedAgents.has(agentId) && conn.socket.readyState === conn.socket.OPEN) {
        conn.socket.send(payload);
      }
    }
  }

  /** Send a message to a single connection identified by `connectionId`. */
  send(connectionId: string, message: WsServerMessage): void {
    const conn = this.connections.get(connectionId);

    if (conn && conn.socket.readyState === conn.socket.OPEN) {
      conn.socket.send(JSON.stringify(message));
    }
  }

  // -----------------------------------------------------------------------
  // Heartbeat
  // -----------------------------------------------------------------------

  /** Start the periodic heartbeat check. */
  startHeartbeat(): void {
    if (this.heartbeatTimer) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();

      for (const [id, conn] of this.connections) {
        if (!conn.isAlive && now - conn.lastPingAt > this.heartbeatTimeoutMs) {
          // Connection did not respond in time — terminate.
          conn.socket.terminate();
          this.connections.delete(id);
          continue;
        }

        // Mark as not-alive and send a ping. If the client responds with a
        // pong (or the application-level "ping" message), `isAlive` is reset
        // to `true` by the caller or a pong handler.
        conn.isAlive = false;
        conn.lastPingAt = now;

        if (conn.socket.readyState === conn.socket.OPEN) {
          conn.socket.ping();
        }
      }
    }, this.heartbeatIntervalMs);
  }

  /** Stop the heartbeat timer and close every connection. */
  shutdown(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const conn of this.connections.values()) {
      conn.socket.close();
    }

    this.connections.clear();
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /** Return the IDs of all tracked connections. */
  getConnectionIds(): string[] {
    return [...this.connections.keys()];
  }

  /** Return the connection IDs subscribed to `agentId`. */
  getSubscribers(agentId: string): string[] {
    const result: string[] = [];

    for (const conn of this.connections.values()) {
      if (conn.subscribedAgents.has(agentId)) {
        result.push(conn.id);
      }
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // Internal helpers (exposed for testing)
  // -----------------------------------------------------------------------

  /** Mark a connection as alive (typically called on pong receipt). */
  markAlive(connectionId: string): void {
    const conn = this.connections.get(connectionId);

    if (conn) {
      conn.isAlive = true;
    }
  }

  /** Retrieve a connection by its ID (for test introspection). */
  getConnection(id: string): WsConnection | undefined {
    return this.connections.get(id);
  }
}
