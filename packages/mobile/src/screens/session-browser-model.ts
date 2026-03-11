import type { Machine, ManagedRuntime, ManagedSessionStatus } from '@agentctl/shared';
import type { RuntimeSessionInfo } from '../services/runtime-session-api.js';
import type { SessionInfo, SessionStatus } from '../services/session-api.js';

export type SessionBrowserItemKind = 'session' | 'runtime';

export type SessionBrowserStatus = SessionStatus | ManagedSessionStatus;

export type SessionBrowserItem = {
  key: string;
  id: string;
  kind: SessionBrowserItemKind;
  runtime: ManagedRuntime;
  status: SessionBrowserStatus;
  projectPath: string;
  machineId: string | null;
  machineLabel: string | null;
  model: string | null;
  costUsd: number | null;
  messageCount: number | null;
  nativeSessionId: string | null;
  lastActivityAt: string | null;
  startedAt: string | null;
  original: SessionInfo | RuntimeSessionInfo;
};

export type DateRange = {
  from: Date | null;
  to: Date | null;
};

export type SessionBrowserFilters = {
  type: 'all' | SessionBrowserItemKind;
  runtime: 'all' | ManagedRuntime;
  machineId: 'all' | string;
  status: 'all' | SessionBrowserStatus;
  dateRange: DateRange;
};

export function buildSessionBrowserItems(params: {
  classicSessions: SessionInfo[];
  runtimeSessions: RuntimeSessionInfo[];
  machines: Machine[];
}): SessionBrowserItem[] {
  const machineLookup = new Map(params.machines.map((machine) => [machine.id, machine] as const));

  const classicItems: SessionBrowserItem[] = params.classicSessions.map((session) => ({
    key: `session:${session.id}`,
    id: session.id,
    kind: 'session',
    runtime: 'claude-code',
    status: session.status,
    projectPath: session.projectPath,
    machineId: null,
    machineLabel: null,
    model: session.model ?? null,
    costUsd: session.costUsd ?? null,
    messageCount: session.messageCount,
    nativeSessionId: null,
    lastActivityAt: session.lastActivity,
    startedAt: null,
    original: session,
  }));

  const runtimeItems: SessionBrowserItem[] = params.runtimeSessions.map((session) => {
    const machine = machineLookup.get(session.machineId);
    const metadataModel =
      typeof session.metadata?.model === 'string'
        ? session.metadata.model
        : session.metadata?.model !== undefined && session.metadata?.model !== null
          ? String(session.metadata.model)
          : null;

    return {
      key: `runtime:${session.id}`,
      id: session.id,
      kind: 'runtime',
      runtime: session.runtime,
      status: session.status,
      projectPath: session.projectPath,
      machineId: session.machineId,
      machineLabel: machine?.hostname ?? session.machineId,
      model: metadataModel,
      costUsd: null,
      messageCount: null,
      nativeSessionId: session.nativeSessionId,
      lastActivityAt: session.lastHeartbeat ?? session.startedAt ?? session.endedAt,
      startedAt: session.startedAt,
      original: session,
    };
  });

  return [...classicItems, ...runtimeItems].sort((left, right) => {
    return timestampOrZero(right.lastActivityAt) - timestampOrZero(left.lastActivityAt);
  });
}

export function filterSessionBrowserItems(
  items: SessionBrowserItem[],
  filters: SessionBrowserFilters,
): SessionBrowserItem[] {
  return items.filter((item) => {
    if (filters.type !== 'all' && item.kind !== filters.type) return false;
    if (filters.runtime !== 'all' && item.runtime !== filters.runtime) return false;
    if (filters.machineId !== 'all' && item.machineId !== filters.machineId) return false;
    if (filters.status !== 'all' && item.status !== filters.status) return false;
    if (!matchesDateRange(item.lastActivityAt, filters.dateRange)) return false;
    return true;
  });
}

export function matchesDateRange(isoString: string | null, range: DateRange): boolean {
  if (!range.from && !range.to) return true;
  const ts = timestampOrZero(isoString);
  if (ts === 0) return false;
  if (range.from && ts < range.from.getTime()) return false;
  if (range.to && ts > range.to.getTime()) return false;
  return true;
}

export const DATE_RANGE_PRESETS = [
  { label: 'All time', key: 'all' },
  { label: 'Last hour', key: '1h' },
  { label: 'Last 24h', key: '24h' },
  { label: 'Last 7d', key: '7d' },
  { label: 'Last 30d', key: '30d' },
] as const;

export type DateRangePresetKey = (typeof DATE_RANGE_PRESETS)[number]['key'];

export function dateRangeFromPreset(key: DateRangePresetKey): DateRange {
  if (key === 'all') return { from: null, to: null };
  const now = new Date();
  const msLookup: Record<Exclude<DateRangePresetKey, 'all'>, number> = {
    '1h': 3_600_000,
    '24h': 86_400_000,
    '7d': 604_800_000,
    '30d': 2_592_000_000,
  };
  return { from: new Date(now.getTime() - msLookup[key]), to: null };
}

function timestampOrZero(value: string | null): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}
