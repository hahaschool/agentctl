'use client';

import { useQuery } from '@tanstack/react-query';
import { FileClock } from 'lucide-react';
import type React from 'react';
import { useMemo, useState } from 'react';

import { ErrorBanner } from '@/components/ErrorBanner';
import { FetchingBar } from '@/components/FetchingBar';
import { LogsAuditActionRow } from '@/components/LogsAuditActionRow';
import { RefreshButton } from '@/components/RefreshButton';
import { auditQuery, auditSummaryQuery } from '@/lib/queries';

const AUDIT_LIMIT = 200;

function trimOrUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function AuditPage(): React.JSX.Element {
  const [agentFilter, setAgentFilter] = useState('');
  const [toolFilter, setToolFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  const actions = actionsQ.data?.actions ?? [];
  const total = actionsQ.data?.total ?? 0;
  const summary = summaryQ.data;

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
        </div>
        <RefreshButton
          onClick={() => {
            void actionsQ.refetch();
            void summaryQ.refetch();
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

      <p className="text-xs text-muted-foreground mb-4 max-w-[720px]">
        Audit actions captured from agent runs. Each entry records the action type, tool, duration
        and timestamp. Filter by agent or tool to narrow the view.
      </p>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
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
        <span className="text-[11px] text-muted-foreground ml-auto">
          Showing {actions.length} of {total}
        </span>
      </div>

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
            Actions are ingested via <span className="font-mono">POST /api/audit/actions</span> from
            agent workers.
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
    </div>
  );
}
