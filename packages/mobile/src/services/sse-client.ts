// ---------------------------------------------------------------------------
// SSE (Server-Sent Events) client for streaming agent output.
//
// Framework-agnostic — uses the global `fetch` API with a readable stream
// to parse SSE frames, since the standard EventSource API doesn't support
// custom headers (needed for auth tokens).
// ---------------------------------------------------------------------------

import type { AgentEvent } from '@agentctl/shared';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class SseClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SseClientError';
  }
}

// ---------------------------------------------------------------------------
// SSE event types emitted by the client
// ---------------------------------------------------------------------------

export type SseEventMap = {
  event: AgentEvent;
  open: undefined;
  error: SseClientError;
  close: undefined;
  reconnecting: { attempt: number; delayMs: number };
};

export type SseEventHandler<K extends keyof SseEventMap> = (data: SseEventMap[K]) => void;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type SseClientConfig = {
  /** Base URL of the control plane (e.g. "https://cp.example.com"). */
  baseUrl: string;

  /** Optional bearer token for authentication. */
  authToken?: string;

  /** Maximum reconnection attempts (default: 10). */
  maxReconnectAttempts?: number;

  /** Base delay in ms for exponential back-off (default: 1 000). */
  reconnectBaseDelayMs?: number;

  /** Maximum delay in ms for exponential back-off (default: 30 000). */
  reconnectMaxDelayMs?: number;

  /** Maximum buffer size in characters before flushing (default: 1 048 576 = 1 MB). */
  maxBufferSize?: number;
};

// ---------------------------------------------------------------------------
// SSE parser state
// ---------------------------------------------------------------------------

type SseFrame = {
  event: string;
  data: string;
  id: string;
  retry: number | null;
};

// ---------------------------------------------------------------------------
// SseClient
// ---------------------------------------------------------------------------

export class SseClient {
  private readonly baseUrl: string;
  private authToken: string | undefined;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly maxBufferSize: number;

  private abortController: AbortController | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private lastEventId = '';

  // Event listeners
  private listeners: {
    [K in keyof SseEventMap]?: Array<SseEventHandler<K>>;
  } = {};

  constructor(config: SseClientConfig) {
    this.baseUrl = config.baseUrl.endsWith('/') ? config.baseUrl.slice(0, -1) : config.baseUrl;
    this.authToken = config.authToken;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 10;
    this.reconnectBaseDelayMs = config.reconnectBaseDelayMs ?? 1_000;
    this.reconnectMaxDelayMs = config.reconnectMaxDelayMs ?? 30_000;
    this.maxBufferSize = config.maxBufferSize ?? 1_048_576;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Replace the current auth token. */
  setAuthToken(token: string | undefined): void {
    this.authToken = token;
  }

  /** Start streaming events for the given agent. */
  connect(agentId: string): void {
    if (this.running) {
      this.close();
    }

    this.running = true;
    this.reconnectAttempt = 0;
    this.startStream(agentId);
  }

  /** Stop the current stream. Prevents auto-reconnect. */
  close(): void {
    this.running = false;
    this.cancelReconnect();

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.emit('close', undefined as never);
  }

  /** Whether the client is actively streaming or attempting to reconnect. */
  get isStreaming(): boolean {
    return this.running;
  }

  /** Current reconnect attempt count. */
  get currentReconnectAttempt(): number {
    return this.reconnectAttempt;
  }

  // -----------------------------------------------------------------------
  // Event subscription
  // -----------------------------------------------------------------------

  on<K extends keyof SseEventMap>(event: K, handler: SseEventHandler<K>): void {
    const list = (this.listeners[event] ?? []) as Array<SseEventHandler<K>>;
    list.push(handler);
    this.listeners[event] = list as never;
  }

  off<K extends keyof SseEventMap>(event: K, handler: SseEventHandler<K>): void {
    const list = this.listeners[event] as Array<SseEventHandler<K>> | undefined;
    if (!list) return;
    this.listeners[event] = list.filter((h) => h !== handler) as never;
  }

  // -----------------------------------------------------------------------
  // Internal — stream management
  // -----------------------------------------------------------------------

  private async startStream(agentId: string): Promise<void> {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(agentId)}/stream`;

    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
    };

    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }

    if (this.lastEventId) {
      headers['Last-Event-ID'] = this.lastEventId;
    }

    this.abortController = new AbortController();

    let response: Response;

    try {
      response = await fetch(url, {
        method: 'GET',
        headers,
        signal: this.abortController.signal,
      });
    } catch (err: unknown) {
      if (!this.running) return; // Intentionally aborted

      if (err instanceof DOMException && err.name === 'AbortError') {
        return; // Intentionally aborted
      }

      const message = err instanceof Error ? err.message : String(err);
      this.emit(
        'error',
        new SseClientError('NETWORK_ERROR', `SSE connection failed: ${message}`, { agentId }),
      );
      this.scheduleReconnect(agentId);
      return;
    }

    if (!response.ok) {
      this.emit(
        'error',
        new SseClientError('HTTP_ERROR', `SSE stream returned HTTP ${response.status}`, {
          status: response.status,
          agentId,
        }),
      );
      this.scheduleReconnect(agentId);
      return;
    }

    // Successfully connected
    this.reconnectAttempt = 0;
    this.emit('open', undefined as never);

    // Read the stream
    if (!response.body) {
      this.emit('error', new SseClientError('NO_BODY', 'SSE response has no body', { agentId }));
      this.scheduleReconnect(agentId);
      return;
    }

    try {
      await this.readStream(response.body, agentId);
    } catch (err: unknown) {
      if (!this.running) return; // Intentionally aborted

      const message = err instanceof Error ? err.message : String(err);
      this.emit(
        'error',
        new SseClientError('STREAM_ERROR', `SSE stream error: ${message}`, { agentId }),
      );
    }

    // Stream ended (server closed or error) — reconnect if still running
    if (this.running) {
      this.scheduleReconnect(agentId);
    }
  }

  private async readStream(body: ReadableStream<Uint8Array>, agentId: string): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (this.running) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Guard against unbounded buffer growth
        if (buffer.length > this.maxBufferSize) {
          this.emit(
            'error',
            new SseClientError('BUFFER_OVERFLOW', 'SSE buffer exceeded maximum size', {
              maxBufferSize: this.maxBufferSize,
              agentId,
            }),
          );
          buffer = '';
          continue;
        }

        // SSE frames are separated by double newlines
        const frames = buffer.split('\n\n');

        // The last element is an incomplete frame (keep in buffer)
        buffer = frames.pop() ?? '';

        for (const frameText of frames) {
          if (frameText.trim() === '') continue;
          const frame = this.parseFrame(frameText);
          this.handleFrame(frame);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // -----------------------------------------------------------------------
  // Internal — SSE frame parsing
  // -----------------------------------------------------------------------

  /** Parse a raw SSE text block into a structured frame. */
  parseFrame(text: string): SseFrame {
    const frame: SseFrame = { event: '', data: '', id: '', retry: null };
    const lines = text.split('\n');
    const dataLines: string[] = [];

    for (const line of lines) {
      // Comment lines start with ':'
      if (line.startsWith(':')) continue;

      const colonIndex = line.indexOf(':');

      if (colonIndex === -1) {
        // Field with no value
        this.applyField(frame, line, '', dataLines);
      } else {
        const field = line.slice(0, colonIndex);
        // SSE spec: if the first character after the colon is a space, skip it
        const valueStart = line[colonIndex + 1] === ' ' ? colonIndex + 2 : colonIndex + 1;
        const value = line.slice(valueStart);
        this.applyField(frame, field, value, dataLines);
      }
    }

    frame.data = dataLines.join('\n');
    return frame;
  }

  private applyField(frame: SseFrame, field: string, value: string, dataLines: string[]): void {
    switch (field) {
      case 'event':
        frame.event = value;
        break;
      case 'data':
        dataLines.push(value);
        break;
      case 'id':
        frame.id = value;
        break;
      case 'retry': {
        const n = Number.parseInt(value, 10);
        if (!Number.isNaN(n)) {
          frame.retry = n;
        }
        break;
      }
      default:
        // Unknown fields are ignored per the SSE spec
        break;
    }
  }

  private handleFrame(frame: SseFrame): void {
    if (frame.id) {
      this.lastEventId = frame.id;
    }

    if (!frame.data) return; // No data → no event to dispatch

    let parsed: unknown;

    try {
      parsed = JSON.parse(frame.data);
    } catch {
      this.emit(
        'error',
        new SseClientError('PARSE_ERROR', 'Failed to parse SSE event data as JSON', {
          raw: frame.data.slice(0, 200),
          event: frame.event,
        }),
      );
      return;
    }

    // The event field from the SSE frame maps to the AgentEvent.event discriminant
    const agentEvent = parsed as AgentEvent;
    this.emit('event', agentEvent);
  }

  // -----------------------------------------------------------------------
  // Internal — reconnection
  // -----------------------------------------------------------------------

  private scheduleReconnect(agentId: string): void {
    if (!this.running) return;

    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      this.emit(
        'error',
        new SseClientError('MAX_RECONNECT_EXCEEDED', 'Maximum SSE reconnection attempts reached', {
          attempts: this.reconnectAttempt,
          agentId,
        }),
      );
      this.running = false;
      this.emit('close', undefined as never);
      return;
    }

    this.reconnectAttempt++;

    const exponential = this.reconnectBaseDelayMs * 2 ** (this.reconnectAttempt - 1);
    const jitter = Math.random() * this.reconnectBaseDelayMs;
    const delayMs = Math.min(exponential + jitter, this.reconnectMaxDelayMs);

    this.emit('reconnecting', { attempt: this.reconnectAttempt, delayMs });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.running) {
        this.startStream(agentId);
      }
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
  // Internal — event emitter
  // -----------------------------------------------------------------------

  private emit<K extends keyof SseEventMap>(event: K, data: SseEventMap[K]): void {
    const list = this.listeners[event] as Array<SseEventHandler<K>> | undefined;
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
