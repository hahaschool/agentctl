// =============================================================================
// Hook: poll agent list from the control plane every 5 seconds
// =============================================================================

import { useEffect, useState } from 'react';

import type { AgentInfo, AgentStatus } from './types.js';

const POLL_INTERVAL_MS = 5_000;
const CONTROL_URL = (process.env.CONTROL_URL ?? 'http://localhost:8080').replace(/\/$/, '');

type AgentApiResponse = {
  readonly id?: string;
  readonly name?: string;
  readonly status?: string;
  readonly cost?: number;
  readonly totalCost?: number;
  readonly duration?: number;
  readonly runDuration?: number;
};

function normalizeStatus(raw: string | undefined): AgentStatus {
  if (!raw) return 'idle';
  const lower = raw.toLowerCase();
  if (lower === 'running' || lower === 'active') return 'running';
  if (lower === 'error' || lower === 'failed') return 'error';
  if (lower === 'stopped' || lower === 'terminated') return 'stopped';
  return 'idle';
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3_600)}h${Math.floor((seconds % 3_600) / 60)}m`;
}

function mapAgent(raw: AgentApiResponse): AgentInfo {
  const cost = raw.cost ?? raw.totalCost ?? null;
  const durationSec = raw.duration ?? raw.runDuration ?? null;

  return {
    id: raw.id ?? 'unknown',
    name: raw.name ?? raw.id ?? 'unnamed',
    status: normalizeStatus(raw.status),
    cost: typeof cost === 'number' ? cost : null,
    duration: typeof durationSec === 'number' ? formatDuration(durationSec) : null,
  };
}

export function useAgents(): {
  readonly agents: readonly AgentInfo[];
  readonly error: string | null;
} {
  const [agents, setAgents] = useState<readonly AgentInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const poll = async (): Promise<void> => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5_000);
        const response = await fetch(`${CONTROL_URL}/api/agents`, { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) {
          if (active) {
            setError(`HTTP ${response.status}`);
            setAgents([]);
          }
          return;
        }

        const data = (await response.json()) as readonly AgentApiResponse[];
        if (!active) return;

        if (Array.isArray(data)) {
          setAgents(data.map(mapAgent));
          setError(null);
        } else {
          setAgents([]);
          setError(null);
        }
      } catch {
        if (active) {
          setError('CP unreachable');
          setAgents([]);
        }
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return { agents, error };
}
