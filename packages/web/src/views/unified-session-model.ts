import type { RuntimeSession, Session } from '@/lib/api';

export type UnifiedSessionKind = 'agent' | 'runtime';
export type UnifiedSessionTypeFilter = 'all' | UnifiedSessionKind;

type UnifiedSessionBase = {
  id: string;
  kind: UnifiedSessionKind;
  machineId: string;
  projectPath: string | null;
  status: string;
  activityAt: string | null;
  label: string;
  secondaryLabel: string | null;
  searchTerms: string[];
};

export type UnifiedAgentSessionRow = UnifiedSessionBase & {
  kind: 'agent';
  session: Session;
};

export type UnifiedRuntimeSessionRow = UnifiedSessionBase & {
  kind: 'runtime';
  runtime: RuntimeSession['runtime'];
  session: RuntimeSession;
};

export type UnifiedSessionRow = UnifiedAgentSessionRow | UnifiedRuntimeSessionRow;

function runtimeLabel(runtime: RuntimeSession['runtime']): string {
  return runtime === 'claude-code' ? 'Claude Code' : 'Codex';
}

function getAgentActivityAt(session: Session): string | null {
  return session.endedAt ?? session.lastHeartbeat ?? session.startedAt;
}

function getRuntimeActivityAt(session: RuntimeSession): string | null {
  return session.endedAt ?? session.lastHeartbeat ?? session.startedAt ?? null;
}

function appendSearchTerms(target: string[], value: unknown): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      target.push(trimmed);
    }
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    target.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      appendSearchTerms(target, item);
    }
    return;
  }
  if (typeof value === 'object') {
    for (const entry of Object.values(value)) {
      appendSearchTerms(target, entry);
    }
  }
}

function uniqueSearchTerms(values: unknown[]): string[] {
  const terms: string[] = [];
  for (const value of values) {
    appendSearchTerms(terms, value);
  }
  return [...new Set(terms)];
}

export function mapAgentSessionToUnifiedRow(session: Session): UnifiedAgentSessionRow {
  return {
    id: session.id,
    kind: 'agent',
    machineId: session.machineId,
    projectPath: session.projectPath,
    status: session.status,
    activityAt: getAgentActivityAt(session),
    label: session.agentName ?? session.agentId,
    secondaryLabel:
      session.model ?? (typeof session.metadata.model === 'string' ? session.metadata.model : null),
    searchTerms: uniqueSearchTerms([
      session.id,
      session.agentId,
      session.agentName,
      session.machineId,
      session.status,
      session.projectPath,
      session.sessionUrl,
      session.claudeSessionId,
      session.model,
      session.metadata,
    ]),
    session,
  };
}

export function mapRuntimeSessionToUnifiedRow(session: RuntimeSession): UnifiedRuntimeSessionRow {
  return {
    id: session.id,
    kind: 'runtime',
    runtime: session.runtime,
    machineId: session.machineId,
    projectPath: session.projectPath,
    status: session.status,
    activityAt: getRuntimeActivityAt(session),
    label: `Runtime · ${runtimeLabel(session.runtime)}`,
    secondaryLabel:
      session.nativeSessionId ??
      (typeof session.metadata.model === 'string' ? session.metadata.model : null),
    searchTerms: uniqueSearchTerms([
      session.id,
      session.runtime,
      session.nativeSessionId,
      session.machineId,
      session.agentId,
      session.status,
      session.projectPath,
      session.worktreePath,
      session.configRevision,
      session.handoffStrategy,
      session.handoffSourceSessionId,
      session.metadata,
    ]),
    session,
  };
}

export function buildUnifiedSessionRows(
  agentSessions: Session[],
  runtimeSessions: RuntimeSession[],
): UnifiedSessionRow[] {
  return [
    ...agentSessions.map(mapAgentSessionToUnifiedRow),
    ...runtimeSessions.map(mapRuntimeSessionToUnifiedRow),
  ].sort((a, b) => new Date(b.activityAt ?? 0).getTime() - new Date(a.activityAt ?? 0).getTime());
}

export function getUnifiedSessionSearchTerms(row: UnifiedSessionRow): string[] {
  return row.searchTerms;
}

export function matchesUnifiedSessionType(
  row: UnifiedSessionRow,
  typeFilter: UnifiedSessionTypeFilter,
): boolean {
  return typeFilter === 'all' ? true : row.kind === typeFilter;
}

export function matchesUnifiedSessionSearch(row: UnifiedSessionRow, query: string): boolean {
  if (!query) {
    return true;
  }
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  return row.searchTerms.some((term) => term.toLowerCase().includes(normalizedQuery));
}
