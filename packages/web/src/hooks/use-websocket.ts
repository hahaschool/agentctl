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
  send: (message: WsOutgoingMessage) => void;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;
const RECONNECT_JITTER = 0.3;

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

  // Resolved URL (stable across renders unless `url` prop changes).
  const resolvedUrl = resolveWsUrl(url);

  // Use a ref for the connect function to break the circular dependency
  // between connect and scheduleReconnect.
  const connectRef = useRef<() => void>(() => {});

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

    ws.addEventListener('open', () => {
      setStatus('connected');
      reconnectAttemptRef.current = 0;
      onOpenRef.current?.();
    });

    ws.addEventListener('message', (event: MessageEvent) => {
      try {
        const data = JSON.parse(String(event.data)) as WsIncomingMessage;
        onMessageRef.current?.(data);
      } catch {
        // Silently ignore unparseable messages.
      }
    });

    ws.addEventListener('close', () => {
      setStatus('disconnected');
      socketRef.current = null;
      onCloseRef.current?.();
      scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      // The browser fires `error` before `close` — we rely on the `close`
      // handler to update status and trigger reconnection.
    });
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

      // Close the WebSocket without triggering a reconnect.
      const ws = socketRef.current;
      if (ws) {
        // Remove listeners before closing to prevent the close handler from
        // scheduling a reconnect.
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.onopen = null;
        ws.close();
        socketRef.current = null;
      }

      setStatus('disconnected');
    };
  }, [enabled, connect]);

  const send = useCallback((message: WsOutgoingMessage) => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }, []);

  return { status, send };
}
