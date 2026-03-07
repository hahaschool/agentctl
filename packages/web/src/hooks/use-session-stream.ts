'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// SSE event types from the worker's session stream
// ---------------------------------------------------------------------------

export type SessionStreamEvent =
  | { event: 'output'; data: { text: string; stream?: string } }
  | { event: 'raw_output'; data: { text: string } }
  | { event: 'user_message'; data: { text: string } }
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
  /** Raw CLI output chunks for terminal view. */
  rawOutput: string[];
  /** User messages received via SSE (shown before JSONL poll catches up). */
  pendingUserMessages: string[];
  /** Latest status event, if any. */
  latestStatus: string | null;
  /** Latest cost data, if any. */
  latestCost: { totalCostUsd: number; inputTokens: number; outputTokens: number } | null;
  /** Clear accumulated stream output (e.g. after content refetch absorbs it). */
  clearStreamOutput: () => void;
  /** Clear pending user messages (e.g. after JSONL content includes them). */
  clearPendingMessages: () => void;
};

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

const BASE_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;
const RECONNECT_JITTER = 0.3;

export function useSessionStream(options: UseSessionStreamOptions): UseSessionStreamResult {
  const { sessionId, enabled = true, onEvent } = options;

  const [connected, setConnected] = useState(false);
  const [streamOutput, setStreamOutput] = useState<string[]>([]);
  const [rawOutput, setRawOutput] = useState<string[]>([]);
  const [pendingUserMessages, setPendingUserMessages] = useState<string[]>([]);
  const [latestStatus, setLatestStatus] = useState<string | null>(null);
  const [latestCost, setLatestCost] = useState<{
    totalCostUsd: number;
    inputTokens: number;
    outputTokens: number;
  } | null>(null);

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);

  // Reset state when sessionId changes
  const resetState = useCallback(() => {
    setStreamOutput([]);
    setRawOutput([]);
    setPendingUserMessages([]);
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

      // Use relative URL so SSE goes through the Next.js proxy (same-origin).
      // Direct cross-origin connections fail because reply.hijack() in the
      // control-plane bypasses Fastify's CORS middleware.
      const url = `/api/sessions/${encodeURIComponent(sessionId)}/stream`;

      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        if (!cancelled) {
          setConnected(true);
          reconnectAttemptRef.current = 0;
        }
      };

      es.onerror = () => {
        if (cancelled) return;
        setConnected(false);
        es.close();
        eventSourceRef.current = null;

        // Reconnect with exponential backoff + jitter
        const attempt = reconnectAttemptRef.current;
        const base = Math.min(BASE_RECONNECT_MS * 2 ** attempt, MAX_RECONNECT_MS);
        const jitter = base * RECONNECT_JITTER * (Math.random() * 2 - 1);
        const delay = Math.max(0, base + jitter);
        reconnectAttemptRef.current = attempt + 1;

        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          connect();
        }, delay);
      };

      // Handle named events
      const handleEvent = (eventType: string) => (e: MessageEvent) => {
        if (cancelled) return;
        try {
          const data = JSON.parse(String(e.data)) as Record<string, unknown>;
          const event = { event: eventType, data } as SessionStreamEvent;

          onEventRef.current?.(event);

          if (eventType === 'raw_output') {
            const text = (data as { text?: string }).text;
            if (text) {
              setRawOutput((prev) => [...prev, text]);
            }
          } else if (eventType === 'output') {
            const text = (data as { text?: string }).text;
            if (text) {
              setStreamOutput((prev) => [...prev, text]);
            }
          } else if (eventType === 'user_message') {
            const text = (data as { text?: string }).text;
            if (text) {
              setPendingUserMessages((prev) => [...prev, text]);
            }
          } else if (eventType === 'status') {
            setLatestStatus((data as { status?: string }).status ?? null);
          } else if (eventType === 'cost') {
            setLatestCost(
              data as { totalCostUsd: number; inputTokens: number; outputTokens: number },
            );
          }
        } catch {
          // Ignore unparseable events
        }
      };

      es.addEventListener('output', handleEvent('output'));
      es.addEventListener('raw_output', handleEvent('raw_output'));
      es.addEventListener('user_message', handleEvent('user_message'));
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

  const clearStreamOutput = useCallback(() => {
    setStreamOutput([]);
    // Don't clear pending user messages here — they need to persist
    // until JSONL content includes the user's message text
  }, []);

  const clearPendingMessages = useCallback(() => {
    setPendingUserMessages([]);
  }, []);

  return {
    connected,
    streamOutput,
    rawOutput,
    pendingUserMessages,
    latestStatus,
    latestCost,
    clearStreamOutput,
    clearPendingMessages,
  };
}
