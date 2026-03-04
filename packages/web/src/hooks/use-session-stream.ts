'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// SSE event types from the worker's session stream
// ---------------------------------------------------------------------------

export type SessionStreamEvent =
  | { event: 'output'; data: { text: string; stream?: string } }
  | { event: 'status'; data: { status: string; sessionId?: string } }
  | { event: 'cost'; data: { totalCostUsd: number; inputTokens: number; outputTokens: number } }
  | { event: 'approval_needed'; data: { toolName: string; args: Record<string, unknown> } }
  | { event: 'heartbeat'; data: Record<string, never> }
  | { event: 'loop_iteration'; data: { iteration: number } }
  | { event: 'loop_complete'; data: { reason: string } };

// ---------------------------------------------------------------------------
// Hook options & return
// ---------------------------------------------------------------------------

type UseSessionStreamOptions = {
  /** RC session UUID — the control-plane will resolve to claudeSessionId internally. */
  sessionId: string;
  /** Only connect when the session is active. */
  enabled?: boolean;
  /** Called for each parsed SSE event. */
  onEvent?: (event: SessionStreamEvent) => void;
};

type UseSessionStreamResult = {
  /** Whether the EventSource is currently connected. */
  connected: boolean;
  /** Accumulated output text from the stream. */
  streamOutput: string[];
  /** Latest status event, if any. */
  latestStatus: string | null;
  /** Latest cost data, if any. */
  latestCost: { totalCostUsd: number; inputTokens: number; outputTokens: number } | null;
};

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

const RECONNECT_DELAY_MS = 3_000;

export function useSessionStream(options: UseSessionStreamOptions): UseSessionStreamResult {
  const { sessionId, enabled = true, onEvent } = options;

  const [connected, setConnected] = useState(false);
  const [streamOutput, setStreamOutput] = useState<string[]>([]);
  const [latestStatus, setLatestStatus] = useState<string | null>(null);
  const [latestCost, setLatestCost] =
    useState<{ totalCostUsd: number; inputTokens: number; outputTokens: number } | null>(null);

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state when sessionId changes
  const resetState = useCallback(() => {
    setStreamOutput([]);
    setLatestStatus(null);
    setLatestCost(null);
  }, []);

  useEffect(() => {
    if (!enabled || !sessionId) {
      return;
    }

    resetState();

    let cancelled = false;

    const connect = (): void => {
      if (cancelled) return;

      // Resolve the SSE URL — in dev, connect directly to control-plane
      const baseUrl =
        process.env.NODE_ENV === 'development' ? 'http://localhost:8080' : '';
      const url = `${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/stream`;

      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        if (!cancelled) setConnected(true);
      };

      es.onerror = () => {
        if (cancelled) return;
        setConnected(false);
        es.close();
        eventSourceRef.current = null;

        // Reconnect after delay
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          connect();
        }, RECONNECT_DELAY_MS);
      };

      // Handle named events
      const handleEvent = (eventType: string) => (e: MessageEvent) => {
        if (cancelled) return;
        try {
          const data = JSON.parse(String(e.data)) as Record<string, unknown>;
          const event = { event: eventType, data } as SessionStreamEvent;

          onEventRef.current?.(event);

          if (eventType === 'output') {
            const text = (data as { text?: string }).text;
            if (text) {
              setStreamOutput((prev) => [...prev, text]);
            }
          } else if (eventType === 'status') {
            setLatestStatus((data as { status?: string }).status ?? null);
          } else if (eventType === 'cost') {
            setLatestCost(data as { totalCostUsd: number; inputTokens: number; outputTokens: number });
          }
        } catch {
          // Ignore unparseable events
        }
      };

      es.addEventListener('output', handleEvent('output'));
      es.addEventListener('status', handleEvent('status'));
      es.addEventListener('cost', handleEvent('cost'));
      es.addEventListener('approval_needed', handleEvent('approval_needed'));
      es.addEventListener('loop_iteration', handleEvent('loop_iteration'));
      es.addEventListener('loop_complete', handleEvent('loop_complete'));
    };

    connect();

    return () => {
      cancelled = true;
      setConnected(false);

      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [sessionId, enabled, resetState]);

  return { connected, streamOutput, latestStatus, latestCost };
}
