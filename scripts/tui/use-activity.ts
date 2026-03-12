// =============================================================================
// Hook: poll recent activity events from the control plane
// =============================================================================

import { useEffect, useState } from 'react';

import type { ActivityEvent, ActivityEventType } from './types.js';

const POLL_INTERVAL_MS = 5_000;
const MAX_EVENTS = 20;
const CONTROL_URL = (process.env.CONTROL_URL ?? 'http://localhost:8080').replace(/\/$/, '');

type EventApiResponse = {
  readonly timestamp?: string;
  readonly createdAt?: string;
  readonly source?: string;
  readonly agentId?: string;
  readonly message?: string;
  readonly event?: string;
  readonly type?: string;
  readonly level?: string;
  readonly status?: string;
};

function normalizeEventType(raw: EventApiResponse): ActivityEventType {
  const level = raw.level ?? raw.type ?? raw.status ?? '';
  const lower = level.toLowerCase();
  if (lower === 'error' || lower === 'failed' || lower === 'critical') return 'error';
  if (lower === 'warning' || lower === 'warn') return 'warning';
  if (lower === 'success' || lower === 'completed' || lower === 'ok') return 'success';
  return 'info';
}

function formatTimestamp(raw: string | undefined): string {
  if (!raw) return '--:--:--';
  try {
    const date = new Date(raw);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '--:--:--';
  }
}

function mapEvent(raw: EventApiResponse): ActivityEvent {
  return {
    timestamp: formatTimestamp(raw.timestamp ?? raw.createdAt),
    source: raw.source ?? raw.agentId ?? 'system',
    message: raw.message ?? raw.event ?? 'unknown event',
    type: normalizeEventType(raw),
  };
}

export function useActivity(): readonly ActivityEvent[] {
  const [events, setEvents] = useState<readonly ActivityEvent[]>([]);

  useEffect(() => {
    let active = true;

    const poll = async (): Promise<void> => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5_000);

        // Try the events endpoint; fall back to dashboard for activity
        const response = await fetch(`${CONTROL_URL}/api/events?limit=${MAX_EVENTS}`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          // If events endpoint doesn't exist, try dashboard
          if (response.status === 404) {
            const dashResponse = await fetch(`${CONTROL_URL}/api/dashboard`, {
              signal: controller.signal,
            });
            if (dashResponse.ok) {
              const dash = (await dashResponse.json()) as {
                recentActivity?: readonly EventApiResponse[];
              };
              if (active && Array.isArray(dash.recentActivity)) {
                setEvents(dash.recentActivity.slice(0, MAX_EVENTS).map(mapEvent));
              }
            }
          }
          return;
        }

        const data = (await response.json()) as readonly EventApiResponse[];
        if (!active) return;

        if (Array.isArray(data)) {
          setEvents(data.slice(0, MAX_EVENTS).map(mapEvent));
        }
      } catch {
        // Silently continue — events are best-effort
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return events;
}
