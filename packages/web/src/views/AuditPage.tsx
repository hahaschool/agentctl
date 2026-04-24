'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, FileClock, Shield } from 'lucide-react';
import type React from 'react';
import { useMemo, useState } from 'react';

import { ErrorBanner } from '@/components/ErrorBanner';
import { FetchingBar } from '@/components/FetchingBar';
import { LogsAuditActionRow } from '@/components/LogsAuditActionRow';
import { RefreshButton } from '@/components/RefreshButton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { AuditAction, SessionTimeline, SuspiciousSession } from '@/lib/api';
import { formatDateTime, formatDurationMs, formatTime } from '@/lib/format-utils';
import {
  auditQuery,
  auditSessionReplayQuery,
  auditSummaryQuery,
  auditSuspiciousQuery,
} from '@/lib/queries';
import { cn } from '@/lib/utils';

const AUDIT_LIMIT = 200;

function trimOrUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// ---------------------------------------------------------------------------
// Session replay panel
// ---------------------------------------------------------------------------

type SessionReplayPanelProps = {
  sessionId: string;
  onClose: () => void;
};

function sessionTimelineToReplayDisplay(replay: SessionTimeline): {
  meta: { startedAt: string; endedAt?: string; toolsUsed: string[]; deniedCalls: number };
} {
  return {
    meta: {
      startedAt: replay.startedAt,
      endedAt: replay.endedAt,
      toolsUsed: replay.toolsUsed,
      deniedCalls: replay.deniedCalls,
    },
  };
}

function SessionReplayPanel({ sessionId, onClose }: SessionReplayPanelProps): React.JSX.Element {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const replayQ = useQuery(auditSessionReplayQuery(sessionId));
  const replay = replayQ.data;
  const meta = replay ? sessionTimelineToReplayDisplay(replay).meta : null;

  return (
    <div
      className="border border-border rounded-md bg-card overflow-hidden"
      data-testid="session-replay-panel"
    >
      {/* Panel header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
            Session Replay
          </span>
          <span className="font-mono text-[12px] text-foreground truncate max-w-[260px]">
            {sessionId}
          </span>
          {replay && (
            <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-semibold">
              {replay.totalEvents} events
            </span>
          )}
          {meta && meta.deniedCalls > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 text-[10px] font-medium">
              {meta.deniedCalls} denied
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
          aria-label="Close replay panel"
        >
          Close
        </button>
      </div>

      {/* Session metadata row */}
      {meta && (
        <div className="px-3.5 py-2 bg-muted/10 border-b border-border flex items-center gap-4 flex-wrap text-[11px] text-muted-foreground">
          <span>
            Started: <span className="text-foreground">{formatDateTime(meta.startedAt)}</span>
          </span>
          {meta.endedAt && (
            <span>
              Ended: <span className="text-foreground">{formatDateTime(meta.endedAt)}</span>
            </span>
          )}
          {meta.toolsUsed.length > 0 && (
            <span>
              Tools: <span className="font-mono text-foreground">{meta.toolsUsed.join(', ')}</span>
            </span>
          )}
        </div>
      )}

      {replayQ.isLoading && (
        <div className="space-y-2 p-3" data-testid="replay-loading">
          {[1, 2, 3].map((k) => (
            <div key={k} className="h-10 bg-muted/30 rounded animate-pulse" />
          ))}
        </div>
      )}

      {replayQ.error && (
        <div className="p-3">
          <ErrorBanner
            message={`Failed to load replay: ${replayQ.error.message}`}
            onRetry={() => void replayQ.refetch()}
          />
        </div>
      )}

      {replay && replay.events.length === 0 && (
        <div className="py-10 text-center text-muted-foreground text-sm">
          No events recorded for this session.
        </div>
      )}

      {replay && replay.events.length > 0 && (
        <div className="divide-y divide-border">
          {replay.events.map((event, index) => {
            const isExpanded = expandedIndex === index;
            const hasInput = event.input != null && Object.keys(event.input).length > 0;
            const hasOutput = Boolean(event.output);
            const isDenied = event.decision === 'deny';

            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: replay events have no stable id
              <div key={index}>
                <button
                  type="button"
                  onClick={() => setExpandedIndex(isExpanded ? null : index)}
                  aria-expanded={isExpanded}
                  className="w-full px-3.5 py-2 flex items-center gap-3 text-left bg-transparent hover:bg-muted/40 transition-colors cursor-pointer border-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-inset"
                >
                  {/* Sequence number */}
                  <span className="text-[10px] text-muted-foreground font-mono w-[28px] shrink-0 text-right">
                    {index + 1}
                  </span>

                  {/* Event type badge */}
                  <span
                    className={cn(
                      'inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border shrink-0',
                      event.eventType === 'tool_call'
                        ? 'bg-blue-500/15 text-blue-500 border-blue-500/30'
                        : event.eventType === 'tool_result'
                          ? 'bg-green-500/15 text-green-500 border-green-500/30'
                          : event.eventType === 'error'
                            ? 'bg-red-500/15 text-red-500 border-red-500/30'
                            : 'bg-muted text-muted-foreground border-border',
                    )}
                  >
                    {event.eventType}
                  </span>

                  {/* Tool name */}
                  {event.tool && (
                    <span className="text-[12px] font-mono text-foreground truncate max-w-[180px]">
                      {event.tool}
                    </span>
                  )}

                  {/* Denied badge */}
                  {isDenied && (
                    <span className="px-1 py-0.5 rounded text-[10px] font-medium bg-red-500/10 text-red-500 shrink-0">
                      denied
                    </span>
                  )}

                  {/* Duration */}
                  {event.durationMs != null && event.durationMs > 0 && (
                    <span
                      className={cn(
                        'text-[11px] font-mono hidden sm:inline',
                        event.durationMs > 30000 ? 'text-amber-500' : 'text-muted-foreground',
                      )}
                    >
                      {formatDurationMs(event.durationMs)}
                    </span>
                  )}

                  {/* Timestamp */}
                  <span className="text-[11px] text-muted-foreground ml-auto shrink-0">
                    {formatTime(event.timestamp)}
                  </span>

                  {/* Expand indicator */}
                  {(hasInput || hasOutput || event.denyReason) && (
                    <span className="text-muted-foreground shrink-0">
                      {isExpanded ? (
                        <ChevronDown size={12} aria-hidden="true" />
                      ) : (
                        <ChevronRight size={12} aria-hidden="true" />
                      )}
                    </span>
                  )}
                </button>

                {/* Expanded event details */}
                {isExpanded && (
                  <div className="px-3.5 pb-3 pt-0 bg-muted/10">
                    <div className="ml-[40px] space-y-2 text-[12px]">
                      <ReplayDetailRow label="Timestamp" value={formatDateTime(event.timestamp)} />
                      {event.decision && (
                        <ReplayDetailRow label="Decision" value={event.decision} />
                      )}
                      {event.denyReason && (
                        <ReplayDetailRow label="Deny Reason" value={event.denyReason} />
                      )}
                      {event.status && <ReplayDetailRow label="Status" value={event.status} />}
                      {event.costUsd != null && (
                        <ReplayDetailRow label="Cost" value={`$${event.costUsd.toFixed(4)}`} />
                      )}
                      {hasOutput && event.output && (
                        <div>
                          <span className="text-[11px] text-muted-foreground font-medium">
                            Output:
                          </span>
                          <pre className="mt-1 p-2 bg-card border border-border/50 rounded font-mono text-[11px] text-muted-foreground whitespace-pre-wrap break-all max-h-[120px] overflow-auto">
                            {event.output}
                          </pre>
                        </div>
                      )}
                      {hasInput && (
                        <div>
                          <span className="text-[11px] text-muted-foreground font-medium">
                            Tool Input:
                          </span>
                          <pre className="mt-1 p-2 bg-card border border-border/50 rounded font-mono text-[11px] text-muted-foreground whitespace-pre-wrap break-all max-h-[180px] overflow-auto">
                            {JSON.stringify(event.input, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ReplayDetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex gap-3">
      <span className="text-[11px] text-muted-foreground font-medium w-[90px] shrink-0">
        {label}:
      </span>
      <span className={cn('text-[12px] text-foreground break-all', mono && 'font-mono')}>
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Suspicious sessions banner
// ---------------------------------------------------------------------------

type SuspiciousBannerProps = {
  sessions: SuspiciousSession[];
  onSelectSession: (sessionId: string) => void;
};

function SuspiciousBanner({ sessions, onSelectSession }: SuspiciousBannerProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      className="border border-amber-500/30 rounded-md bg-amber-500/5 mb-4"
      data-testid="suspicious-banner"
    >
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        className="w-full px-3.5 py-2.5 flex items-center gap-2.5 text-left bg-transparent hover:bg-amber-500/5 transition-colors cursor-pointer border-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/20 focus-visible:ring-inset rounded-md"
      >
        <AlertTriangle size={14} className="text-amber-500 shrink-0" aria-hidden="true" />
        <span className="text-[12px] font-medium text-amber-500">Suspicious Activity Detected</span>
        <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-500 text-[10px] font-semibold ml-1">
          {sessions.length}
        </span>
        <span className="text-[11px] text-muted-foreground ml-1">
          {sessions.length === 1 ? 'session' : 'sessions'} with unusual patterns
        </span>
        <span className="ml-auto text-muted-foreground">
          {isExpanded ? (
            <ChevronDown size={12} aria-hidden="true" />
          ) : (
            <ChevronRight size={12} aria-hidden="true" />
          )}
        </span>
      </button>

      {isExpanded && (
        <div className="px-3.5 pb-3 divide-y divide-amber-500/10">
          {sessions.map((session) => (
            <div key={session.sessionId} className="py-2.5 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[12px] text-foreground truncate max-w-[220px]">
                    {session.sessionId}
                  </span>
                  {session.agentId && (
                    <span className="text-[11px] text-muted-foreground font-mono">
                      agent: {session.agentId.slice(0, 8)}
                    </span>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    {session.actionCount} actions
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {session.suspiciousReasons.map((reason) => (
                    <span
                      key={reason}
                      className="px-1.5 py-0.5 rounded border border-amber-500/30 text-[10px] text-amber-500 bg-amber-500/10"
                    >
                      {reason}
                    </span>
                  ))}
                </div>
                {(session.firstEventAt ?? session.lastEventAt) && (
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {session.firstEventAt && `From ${formatDateTime(session.firstEventAt)}`}
                    {session.firstEventAt && session.lastEventAt && ' — '}
                    {session.lastEventAt && `To ${formatDateTime(session.lastEventAt)}`}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => onSelectSession(session.sessionId)}
                className="shrink-0 px-2 py-1 text-[11px] rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
              >
                View Replay
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sessions tab content
// ---------------------------------------------------------------------------

type SessionsTabProps = {
  actions: AuditAction[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string | null) => void;
};

function SessionsTab({
  actions,
  selectedSessionId,
  onSelectSession,
}: SessionsTabProps): React.JSX.Element {
  // Derive unique sessions from audit actions
  const sessions = useMemo(() => {
    const seen = new Map<
      string,
      { sessionId: string; agentId: string | null; actionCount: number; latestTs: string }
    >();

    for (const action of actions) {
      // Session grouping: use runId as a proxy for session grouping when sessionId is absent.
      // The replay endpoint uses sessionId so we key by runId but label it.
      const key = action.runId;
      if (!key) {
        continue;
      }

      const existing = seen.get(key);
      if (existing) {
        const updatedCount = existing.actionCount + 1;
        const updatedTs =
          action.timestamp > existing.latestTs ? action.timestamp : existing.latestTs;
        seen.set(key, { ...existing, actionCount: updatedCount, latestTs: updatedTs });
      } else {
        seen.set(key, {
          sessionId: key,
          agentId: action.agentId,
          actionCount: 1,
          latestTs: action.timestamp,
        });
      }
    }

    return Array.from(seen.values()).sort((a, b) => b.latestTs.localeCompare(a.latestTs));
  }, [actions]);

  if (sessions.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground text-sm">
        <p>No sessions found.</p>
        <p className="mt-1 text-xs">Sessions appear once audit actions are ingested.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Sessions list */}
      <div className="border border-border rounded-md overflow-hidden bg-card">
        {sessions.map((session, index) => {
          const isSelected = selectedSessionId === session.sessionId;
          return (
            <div key={session.sessionId} className={cn(index > 0 && 'border-t border-border')}>
              <div
                className={cn(
                  'px-3.5 py-2.5 flex items-center gap-3',
                  isSelected && 'bg-primary/5',
                )}
              >
                <span className="font-mono text-[12px] text-foreground truncate max-w-[260px]">
                  {session.sessionId}
                </span>
                {session.agentId && (
                  <span className="text-[11px] text-muted-foreground font-mono hidden sm:inline">
                    {session.agentId.slice(0, 8)}
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground">
                  {session.actionCount} action{session.actionCount === 1 ? '' : 's'}
                </span>
                <span className="text-[11px] text-muted-foreground ml-auto shrink-0">
                  {formatTime(session.latestTs)}
                </span>
                <button
                  type="button"
                  onClick={() => onSelectSession(isSelected ? null : session.sessionId)}
                  className={cn(
                    'shrink-0 px-2.5 py-1 text-[11px] rounded border transition-colors',
                    isSelected
                      ? 'border-primary/50 text-primary bg-primary/10 hover:bg-primary/20'
                      : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/50',
                  )}
                >
                  {isSelected ? 'Hide' : 'View Replay'}
                </button>
              </div>

              {/* Inline replay panel */}
              {isSelected && (
                <div className="border-t border-border">
                  <SessionReplayPanel
                    sessionId={session.sessionId}
                    onClose={() => onSelectSession(null)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main AuditPage component
// ---------------------------------------------------------------------------

export function AuditPage(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState('actions');
  const [agentFilter, setAgentFilter] = useState('');
  const [toolFilter, setToolFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const listParams = useMemo(
    () => ({
      limit: AUDIT_LIMIT,
      agentId: trimOrUndefined(agentFilter),
      tool: trimOrUndefined(toolFilter),
    }),
    [agentFilter, toolFilter],
  );

  const summaryParams = useMemo(() => ({ agentId: trimOrUndefined(agentFilter) }), [agentFilter]);

  const actionsQ = useQuery(auditQuery(listParams));
  const summaryQ = useQuery(auditSummaryQuery(summaryParams));
  const suspiciousQ = useQuery(auditSuspiciousQuery());

  const actions = actionsQ.data?.actions ?? [];
  const total = actionsQ.data?.total ?? 0;
  const summary = summaryQ.data;
  const suspiciousSessions = suspiciousQ.data ?? [];

  const topActionTypes = useMemo(() => {
    if (!summary) return [] as Array<[string, number]>;
    return Object.entries(summary.actionTypeBreakdown)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6);
  }, [summary]);

  const topTools = useMemo(() => {
    if (!summary) return [] as Array<[string, number]>;
    return Object.entries(summary.toolBreakdown)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6);
  }, [summary]);

  const handleSelectSession = (sessionId: string | null): void => {
    setSelectedSessionId(sessionId);
    if (sessionId !== null) {
      setActiveTab('sessions');
    }
  };

  return (
    <div className="relative p-4 md:p-6 max-w-[1400px] animate-page-enter">
      <FetchingBar isFetching={actionsQ.isFetching && !actionsQ.isLoading} />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <FileClock size={22} className="text-primary" aria-hidden="true" />
          <h1 className="text-[22px] font-semibold tracking-tight">Audit Trail</h1>
          {summary !== undefined && (
            <span
              className="px-2 py-0.5 rounded-sm bg-muted text-muted-foreground text-[10px] font-semibold uppercase tracking-wide"
              data-testid="audit-total-badge"
            >
              {summary.totalActions} actions
            </span>
          )}
          {suspiciousSessions.length > 0 && (
            <span
              className="flex items-center gap-1 px-2 py-0.5 rounded-sm bg-amber-500/10 text-amber-500 text-[10px] font-semibold uppercase tracking-wide border border-amber-500/20"
              data-testid="suspicious-count-badge"
            >
              <Shield size={10} aria-hidden="true" />
              {suspiciousSessions.length} suspicious
            </span>
          )}
        </div>
        <RefreshButton
          onClick={() => {
            void actionsQ.refetch();
            void summaryQ.refetch();
            void suspiciousQ.refetch();
          }}
          isFetching={actionsQ.isFetching && !actionsQ.isLoading}
        />
      </div>

      {summary !== undefined && (
        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4"
          data-testid="audit-summary-card"
        >
          <div className="border border-border rounded-md bg-card p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              Total actions
            </div>
            <div className="text-[20px] font-semibold font-mono">{summary.totalActions}</div>
            {summary.avgDurationMs != null && (
              <div className="text-[11px] text-muted-foreground mt-1">
                avg {Math.round(summary.avgDurationMs)}ms
              </div>
            )}
          </div>
          <div className="border border-border rounded-md bg-card p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
              Top action types
            </div>
            {topActionTypes.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">—</div>
            ) : (
              <ul className="space-y-1">
                {topActionTypes.map(([type, count]) => (
                  <li
                    key={type}
                    className="flex items-center justify-between text-[12px] font-mono"
                  >
                    <span className="truncate text-foreground" title={type}>
                      {type}
                    </span>
                    <span className="text-muted-foreground">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border border-border rounded-md bg-card p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
              Top tools
            </div>
            {topTools.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">—</div>
            ) : (
              <ul className="space-y-1">
                {topTools.map(([tool, count]) => (
                  <li
                    key={tool}
                    className="flex items-center justify-between text-[12px] font-mono"
                  >
                    <span className="truncate text-foreground" title={tool}>
                      {tool}
                    </span>
                    <span className="text-muted-foreground">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Suspicious sessions banner */}
      {suspiciousSessions.length > 0 && (
        <SuspiciousBanner sessions={suspiciousSessions} onSelectSession={handleSelectSession} />
      )}

      <p className="text-xs text-muted-foreground mb-4 max-w-[720px]">
        Audit actions captured from agent runs. Each entry records the action type, tool, duration
        and timestamp. Filter by agent or tool to narrow the view.
      </p>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-2">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <TabsList>
            <TabsTrigger value="actions">Actions</TabsTrigger>
            <TabsTrigger value="sessions" data-testid="sessions-tab-trigger">
              Sessions
            </TabsTrigger>
          </TabsList>

          {/* Filters — only relevant in actions tab */}
          {activeTab === 'actions' && (
            <div className="flex items-center gap-3 flex-wrap">
              <label
                htmlFor="audit-agent-filter"
                className="text-[11px] uppercase tracking-wide text-muted-foreground"
              >
                Agent
              </label>
              <input
                id="audit-agent-filter"
                data-testid="audit-agent-filter"
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                placeholder="agent id"
                className="bg-muted border border-border rounded-md text-xs px-2 py-1 text-foreground w-[200px] font-mono"
              />
              <label
                htmlFor="audit-tool-filter"
                className="text-[11px] uppercase tracking-wide text-muted-foreground"
              >
                Tool
              </label>
              <input
                id="audit-tool-filter"
                data-testid="audit-tool-filter"
                value={toolFilter}
                onChange={(e) => setToolFilter(e.target.value)}
                placeholder="tool name"
                className="bg-muted border border-border rounded-md text-xs px-2 py-1 text-foreground w-[200px] font-mono"
              />
              <span className="text-[11px] text-muted-foreground">
                Showing {actions.length} of {total}
              </span>
            </div>
          )}
        </div>

        {/* Actions tab */}
        <TabsContent value="actions">
          {actionsQ.error && (
            <ErrorBanner
              message={`Failed to load audit actions: ${actionsQ.error.message}`}
              onRetry={() => void actionsQ.refetch()}
              className="mb-4"
            />
          )}

          {actionsQ.isLoading && (
            <div className="space-y-2" data-testid="audit-loading-skeletons">
              {[1, 2, 3, 4].map((k) => (
                <div key={k} className="h-12 bg-muted/30 rounded-md animate-pulse" />
              ))}
            </div>
          )}

          {!actionsQ.isLoading && !actionsQ.error && actions.length === 0 && (
            <div className="text-center py-16 text-muted-foreground text-sm">
              <p>No audit actions.</p>
              <p className="mt-1 text-xs">
                Actions are ingested via <span className="font-mono">POST /api/audit/actions</span>{' '}
                from agent workers.
              </p>
            </div>
          )}

          {actions.length > 0 && (
            <div className="border border-border rounded-md overflow-hidden bg-card">
              {actions.map((action, index) => (
                <LogsAuditActionRow
                  key={action.id}
                  action={action}
                  isFirst={index === 0}
                  isExpanded={expandedId === action.id}
                  onToggle={() => setExpandedId(expandedId === action.id ? null : action.id)}
                  searchQuery={toolFilter}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Sessions tab */}
        <TabsContent value="sessions" data-testid="sessions-tab-content">
          <SessionsTab
            actions={actions}
            selectedSessionId={selectedSessionId}
            onSelectSession={setSelectedSessionId}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
