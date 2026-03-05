import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// WebSocket message types — mirrors the control plane wire protocol defined in
// packages/control-plane/src/api/routes/ws.ts.
// ---------------------------------------------------------------------------

// Incoming messages (client -> server)

type SubscribeAgentMessage = {
  type: 'subscribe_agent';
  agentId: string;
};

type UnsubscribeAgentMessage = {
  type: 'unsubscribe_agent';
  agentId: string;
};

type StartAgentMessage = {
  type: 'start_agent';
  agentId: string;
  prompt: string;
  machineId?: string;
  config?: Record<string, unknown>;
};

type StopAgentMessage = {
  type: 'stop_agent';
  agentId: string;
  graceful?: boolean;
};

type PingMessage = {
  type: 'ping';
};

export type WsOutgoingMessage =
  | SubscribeAgentMessage
  | UnsubscribeAgentMessage
  | StartAgentMessage
  | StopAgentMessage
  | PingMessage;

// Outgoing messages (server -> client)

type AgentEventMessage = {
  type: 'agent_event';
  agentId: string;
  event: { event: string; data: Record<string, unknown> };
};

type PongMessage = {
  type: 'pong';
  timestamp: string;
};

type ErrorMessage = {
  type: 'error';
  message: string;
  code: string;
};

export type WsIncomingMessage = AgentEventMessage | PongMessage | ErrorMessage;

// ---------------------------------------------------------------------------
// Connection status
// ---------------------------------------------------------------------------

export type WsConnectionStatus = 'connecting' | 'connected' | 'disconnected';

// ---------------------------------------------------------------------------
// Hook options & return value
// ---------------------------------------------------------------------------

type UseWebSocketOptions = {
  /** Override the WebSocket URL. Defaults to auto-detect (dev vs prod). */
  url?: string;
  /** Called for every message received from the server. */
  onMessage?: (message: WsIncomingMessage) => void;
  /** Called when the connection is established. */
  onOpen?: () => void;
  /** Called when the connection is lost (includes close and error). */
  onClose?: () => void;
  /** Whether the hook should connect. Defaults to `true`. */
  enabled?: boolean;
};

type UseWebSocketResult = {
  status: WsConnectionStatus;
  /** Send a message. Returns `true` if sent immediately, `false` if queued. */
  send: (message: WsOutgoingMessage) => boolean;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;
const RECONNECT_JITTER = 0.3;
const MAX_QUEUED_MESSAGES = 50;

// ---------------------------------------------------------------------------
// URL resolver
// ---------------------------------------------------------------------------

function resolveWsUrl(override?: string): string {
  if (override) return override;

  // In development, Next.js rewrites HTTP but not WebSocket, so connect
  // directly to the control plane backend.
  if (process.env.NODE_ENV === 'development') {
    return 'ws://localhost:8080/api/ws';
  }

  // In production, derive the WebSocket URL from the current page origin so
  // that it works behind any reverse proxy / domain.
  if (typeof window === 'undefined') return 'ws://localhost:8080/api/ws';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/api/ws`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketResult {
  const { url, onMessage, onOpen, onClose, enabled = true } = options;

  const [status, setStatus] = useState<WsConnectionStatus>('disconnected');

  // Store callbacks in refs so reconnect logic always uses the latest version
  // without re-triggering the effect.
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Mutable ref to the current WebSocket instance so `send` always targets
  // the live connection.
  const socketRef = useRef<WebSocket | null>(null);

  // Track reconnect state across renders without triggering re-renders.
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Queue for messages sent while the WebSocket is not connected.
  const messageQueueRef = useRef<WsOutgoingMessage[]>([]);

  // Resolved URL (stable across renders unless `url` prop changes).
  const resolvedUrl = resolveWsUrl(url);

  // Use a ref for the connect function to break the circular dependency
  // between connect and scheduleReconnect.
  const connectRef = useRef<() => void>(() => {});

  // Holds a function that removes event listeners for the current WebSocket
  // instance. Replaced each time connect() creates a new socket.
  const cleanupListenersRef = useRef<(() => void) | null>(null);

  const scheduleReconnect = useCallback(() => {
    const attempt = reconnectAttemptRef.current;
    const base = Math.min(BASE_RECONNECT_MS * 2 ** attempt, MAX_RECONNECT_MS);
    const jitter = base * RECONNECT_JITTER * (Math.random() * 2 - 1);
    const delay = Math.max(0, base + jitter);

    reconnectAttemptRef.current = attempt + 1;

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      connectRef.current();
    }, delay);
  }, []);

  const connect = useCallback(() => {
    // Avoid duplicate connections.
    if (
      socketRef.current &&
      (socketRef.current.readyState === WebSocket.CONNECTING ||
        socketRef.current.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    setStatus('connecting');

    const ws = new WebSocket(resolvedUrl);
    socketRef.current = ws;

    // cleanedUp is set to true by the effect cleanup so that listeners
    // registered on this WebSocket instance do not trigger reconnects or
    // state updates after the component has unmounted.
    let cleanedUp = false;

    const handleOpen = (): void => {
      if (cleanedUp) return;
      setStatus('connected');
      reconnectAttemptRef.current = 0;

      // Flush any messages that were queued while disconnected.
      const queued = messageQueueRef.current;
      if (queued.length > 0) {
        for (const msg of queued) {
          ws.send(JSON.stringify(msg));
        }
        messageQueueRef.current = [];
      }

      onOpenRef.current?.();
    };

    const handleMessage = (event: MessageEvent): void => {
      if (cleanedUp) return;
      try {
        const data = JSON.parse(String(event.data)) as WsIncomingMessage;
        onMessageRef.current?.(data);
      } catch {
        // Silently ignore unparseable messages.
      }
    };

    const handleClose = (): void => {
      if (cleanedUp) return;
      setStatus('disconnected');
      socketRef.current = null;
      onCloseRef.current?.();
      scheduleReconnect();
    };

    const handleError = (): void => {
      // The browser fires `error` before `close` — we rely on the `close`
      // handler to update status and trigger reconnection.
    };

    ws.addEventListener('open', handleOpen);
    ws.addEventListener('message', handleMessage);
    ws.addEventListener('close', handleClose);
    ws.addEventListener('error', handleError);

    // Expose a cleanup function via a ref so the effect can tear down this
    // specific WebSocket instance's listeners.
    cleanupListenersRef.current = (): void => {
      cleanedUp = true;
      ws.removeEventListener('open', handleOpen);
      ws.removeEventListener('message', handleMessage);
      ws.removeEventListener('close', handleClose);
      ws.removeEventListener('error', handleError);
    };
  }, [resolvedUrl, scheduleReconnect]);

  connectRef.current = connect;

  // Main lifecycle effect — connect when enabled, clean up on unmount or
  // when disabled.
  useEffect(() => {
    if (!enabled) {
      return;
    }

    connect();

    return () => {
      // Clear any pending reconnect timer.
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      // Discard queued messages on intentional disconnect.
      messageQueueRef.current = [];

      // Close the WebSocket without triggering a reconnect.
      const ws = socketRef.current;
      if (ws) {
        // Remove named listeners and set cleanedUp=true before closing so
        // that the close handler does not schedule another reconnect.
        cleanupListenersRef.current?.();
        cleanupListenersRef.current = null;
        ws.close();
        socketRef.current = null;
      }

      setStatus('disconnected');
    };
  }, [enabled, connect]);

  const send = useCallback((message: WsOutgoingMessage): boolean => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      return true;
    }

    // Queue the message for delivery when the connection is (re-)established.
    const queue = messageQueueRef.current;
    if (queue.length >= MAX_QUEUED_MESSAGES) {
      // Drop the oldest message to make room.
      queue.shift();
    }
    queue.push(message);

    console.warn(
      `[useWebSocket] Message queued (type=${message.type}, queue size=${queue.length}). ` +
        'WebSocket is not connected — will flush on reconnect.',
    );

    return false;
  }, []);

  return { status, send };
}
