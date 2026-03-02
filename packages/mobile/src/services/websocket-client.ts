// ---------------------------------------------------------------------------
// WebSocket client for real-time bidirectional agent control.
//
// Framework-agnostic — uses the standard WebSocket API. Provides:
//  - TweetNaCl E2E encryption via @agentctl/shared
//  - Auto-reconnect with exponential back-off
//  - Message queuing while disconnected
//  - Typed event emitter for incoming messages
// ---------------------------------------------------------------------------

import type { WsClientMessage, WsServerMessage } from '@agentctl/shared';
import { decryptSecretBox, encryptSecretBox } from '@agentctl/shared';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class WebSocketClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'WebSocketClientError';
  }
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type WsEventMap = {
  message: WsServerMessage;
  open: undefined;
  close: { code: number; reason: string };
  error: Error;
  reconnecting: { attempt: number; delayMs: number };
};

export type WsEventHandler<K extends keyof WsEventMap> = (data: WsEventMap[K]) => void;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type WebSocketClientConfig = {
  /** WebSocket URL (e.g. "wss://cp.example.com/api/ws"). */
  url: string;

  /**
   * Base64-encoded 32-byte shared secret for TweetNaCl secretbox encryption.
   * When set, all outgoing messages are encrypted and incoming messages are
   * decrypted. When `undefined`, messages are sent/received as plain JSON.
   */
  sharedSecret?: string;

  /** Maximum number of reconnect attempts (default: Infinity). */
  maxReconnectAttempts?: number;

  /** Base delay in ms for exponential back-off (default: 1 000). */
  reconnectBaseDelayMs?: number;

  /** Maximum delay in ms for exponential back-off (default: 30 000). */
  reconnectMaxDelayMs?: number;

  /** Maximum number of messages to queue while disconnected (default: 200). */
  maxQueueSize?: number;

  /** Whether to automatically reconnect on close (default: true). */
  autoReconnect?: boolean;
};

// ---------------------------------------------------------------------------
// WebSocketClient
// ---------------------------------------------------------------------------

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly sharedSecret: string | undefined;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly maxQueueSize: number;
  private readonly autoReconnect: boolean;

  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private messageQueue: string[] = [];

  // Event listeners keyed by event name
  private listeners: {
    [K in keyof WsEventMap]?: Array<WsEventHandler<K>>;
  } = {};

  constructor(config: WebSocketClientConfig) {
    this.url = config.url;
    this.sharedSecret = config.sharedSecret;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? Number.POSITIVE_INFINITY;
    this.reconnectBaseDelayMs = config.reconnectBaseDelayMs ?? 1_000;
    this.reconnectMaxDelayMs = config.reconnectMaxDelayMs ?? 30_000;
    this.maxQueueSize = config.maxQueueSize ?? 200;
    this.autoReconnect = config.autoReconnect ?? true;
  }

  // -----------------------------------------------------------------------
  // Public API — connection lifecycle
  // -----------------------------------------------------------------------

  /** Open the WebSocket connection. Safe to call multiple times. */
  connect(): void {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return; // Already connected / connecting
    }

    this.intentionalClose = false;
    this.createSocket();
  }

  /** Gracefully close the connection. Prevents auto-reconnect. */
  disconnect(): void {
    this.intentionalClose = true;
    this.cancelReconnect();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
  }

  /** Returns true when the socket is in the OPEN state. */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Returns the current reconnect attempt counter. */
  get currentReconnectAttempt(): number {
    return this.reconnectAttempt;
  }

  /** Returns the number of queued messages waiting to be sent. */
  get queuedMessageCount(): number {
    return this.messageQueue.length;
  }

  // -----------------------------------------------------------------------
  // Public API — sending messages
  // -----------------------------------------------------------------------

  /**
   * Send a typed client message. If the socket is not open the message is
   * queued and will be flushed once the connection is re-established.
   */
  send(message: WsClientMessage): void {
    const raw = JSON.stringify(message);
    const payload = this.sharedSecret ? encryptSecretBox(raw, this.sharedSecret) : raw;

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
    } else {
      this.enqueue(payload);
    }
  }

  // -----------------------------------------------------------------------
  // Public API — event subscription
  // -----------------------------------------------------------------------

  on<K extends keyof WsEventMap>(event: K, handler: WsEventHandler<K>): void {
    const list = (this.listeners[event] ?? []) as Array<WsEventHandler<K>>;
    list.push(handler);
    this.listeners[event] = list as never;
  }

  off<K extends keyof WsEventMap>(event: K, handler: WsEventHandler<K>): void {
    const list = this.listeners[event] as Array<WsEventHandler<K>> | undefined;
    if (!list) return;
    this.listeners[event] = list.filter((h) => h !== handler) as never;
  }

  // -----------------------------------------------------------------------
  // Internal — socket management
  // -----------------------------------------------------------------------

  private createSocket(): void {
    const ws = new WebSocket(this.url);

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.flushQueue();
      this.emit('open', undefined as never);
    };

    ws.onmessage = (event: MessageEvent) => {
      const rawData = typeof event.data === 'string' ? event.data : String(event.data);

      let json: string;

      if (this.sharedSecret) {
        try {
          json = decryptSecretBox(rawData, this.sharedSecret);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.emit('error', new WebSocketClientError('DECRYPT_FAILED', message));
          return;
        }
      } else {
        json = rawData;
      }

      let parsed: WsServerMessage;

      try {
        parsed = JSON.parse(json) as WsServerMessage;
      } catch {
        this.emit(
          'error',
          new WebSocketClientError('PARSE_ERROR', 'Failed to parse server message', {
            raw: json.slice(0, 200),
          }),
        );
        return;
      }

      this.emit('message', parsed);
    };

    ws.onclose = (event: { code: number; reason: string }) => {
      this.emit('close', { code: event.code, reason: event.reason });

      if (!this.intentionalClose && this.autoReconnect) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      this.emit('error', new WebSocketClientError('WS_ERROR', 'WebSocket error'));
    };

    this.ws = ws;
  }

  // -----------------------------------------------------------------------
  // Internal — reconnection
  // -----------------------------------------------------------------------

  private scheduleReconnect(): void {
    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      this.emit(
        'error',
        new WebSocketClientError(
          'MAX_RECONNECT_EXCEEDED',
          'Maximum reconnection attempts reached',
          {
            attempts: this.reconnectAttempt,
          },
        ),
      );
      return;
    }

    this.reconnectAttempt++;

    // Exponential back-off with jitter: base * 2^(attempt-1) + random(0..base)
    const exponential = this.reconnectBaseDelayMs * 2 ** (this.reconnectAttempt - 1);
    const jitter = Math.random() * this.reconnectBaseDelayMs;
    const delayMs = Math.min(exponential + jitter, this.reconnectMaxDelayMs);

    this.emit('reconnecting', { attempt: this.reconnectAttempt, delayMs });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.createSocket();
    }, delayMs);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
  }

  // -----------------------------------------------------------------------
  // Internal — message queue
  // -----------------------------------------------------------------------

  private enqueue(payload: string): void {
    if (this.messageQueue.length >= this.maxQueueSize) {
      // Drop oldest message to make room
      this.messageQueue.shift();
    }
    this.messageQueue.push(payload);
  }

  private flushQueue(): void {
    while (this.messageQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      const payload = this.messageQueue.shift();
      if (payload !== undefined) {
        this.ws.send(payload);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal — event emitter
  // -----------------------------------------------------------------------

  private emit<K extends keyof WsEventMap>(event: K, data: WsEventMap[K]): void {
    const list = this.listeners[event] as Array<WsEventHandler<K>> | undefined;
    if (!list) return;

    for (const handler of list) {
      try {
        handler(data);
      } catch {
        // Swallow handler errors to protect the client loop.
      }
    }
  }
}
