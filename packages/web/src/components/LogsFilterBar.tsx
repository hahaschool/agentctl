'use client';

import type React from 'react';
import { cn } from '@/lib/utils';
import type { AuditAction } from '../lib/api';
import { downloadCsv } from '../lib/format-utils';
import { SimpleTooltip } from './SimpleTooltip';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActionTypeFilter = 'all' | 'tool_use' | 'tool_result' | 'text' | 'error';
export type AuditSortBy = 'newest' | 'oldest' | 'agent' | 'tool';

type AgentOption = {
  id: string;
  name: string;
};

export type LogsFilterBarProps = {
  /** Current search query */
  search: string;
  /** Active action-type filter tab */
  actionTypeFilter: ActionTypeFilter;
  /** Selected agent ID for filtering (empty string = all) */
  agentFilter: string;
  /** Selected tool name for filtering (empty string = all) */
  toolFilter: string;
  /** Current sort mode */
  sortBy: AuditSortBy;
  /** Available agents for the dropdown */
  agents: AgentOption[];
  /** Available tool names for the dropdown */
  toolNames: string[];
  /** Current sorted/filtered actions — used for CSV export count & data */
  sortedActions: AuditAction[];

  /** Called when the search input changes */
  onSearchChange: (value: string) => void;
  /** Called when the action type tab changes */
  onActionTypeFilterChange: (value: ActionTypeFilter) => void;
  /** Called when the agent filter dropdown changes */
  onAgentFilterChange: (value: string) => void;
  /** Called when the tool filter dropdown changes */
  onToolFilterChange: (value: string) => void;
  /** Called when the sort dropdown changes */
  onSortByChange: (value: AuditSortBy) => void;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTION_TYPE_TABS: { key: ActionTypeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'tool_use', label: 'Tool Use' },
  { key: 'tool_result', label: 'Tool Result' },
  { key: 'text', label: 'Text' },
  { key: 'error', label: 'Error' },
];

const SELECT_CLASSES =
  'px-2.5 py-1.5 text-[13px] bg-card border border-border/50 rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LogsFilterBar({
  search,
  actionTypeFilter,
  agentFilter,
  toolFilter,
  sortBy,
  agents,
  toolNames,
  sortedActions,
  onSearchChange,
  onActionTypeFilterChange,
  onAgentFilterChange,
  onToolFilterChange,
  onSortByChange,
}: LogsFilterBarProps): React.JSX.Element {
  const handleExportCsv = (): void => {
    if (sortedActions.length === 0) return;
    downloadCsv(
      ['timestamp', 'actionType', 'toolName', 'agentId', 'runId', 'durationMs', 'approvedBy'],
      sortedActions.map((a) => [
        a.timestamp,
        a.actionType,
        a.toolName,
        a.agentId,
        a.runId,
        a.durationMs,
        a.approvedBy,
      ]),
      `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };

  return (
    <>
      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-[360px]">
          <input
            type="text"
            placeholder="Search actions, tools, agents..."
            aria-label="Search actions, tools, or agents"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full px-3 py-1.5 pl-8 pr-10 text-[13px] bg-card border border-border/50 rounded-md placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-[13px]">
            &#x2315;
          </span>
          {!search && (
            <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 px-1 py-px text-[9px] font-mono text-muted-foreground/40 bg-background border border-border/50 rounded pointer-events-none">
              /
            </kbd>
          )}
        </div>

        {/* Agent filter */}
        <select
          value={agentFilter}
          onChange={(e) => onAgentFilterChange(e.target.value)}
          aria-label="Filter by agent"
          className={SELECT_CLASSES}
        >
          <option value="">All Agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        {/* Tool filter */}
        <select
          value={toolFilter}
          onChange={(e) => onToolFilterChange(e.target.value)}
          aria-label="Filter by tool"
          className={SELECT_CLASSES}
        >
          <option value="">All Tools</option>
          {toolNames.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => onSortByChange(e.target.value as AuditSortBy)}
          aria-label="Sort by"
          className={SELECT_CLASSES}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="agent">Agent</option>
          <option value="tool">Tool name</option>
        </select>

        {/* Export CSV */}
        <SimpleTooltip
          content={
            sortedActions.length === 0 ? 'No actions to export' : 'Download filtered actions as CSV'
          }
        >
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={sortedActions.length === 0}
            className="px-2.5 py-1.5 text-[12px] font-medium bg-muted text-muted-foreground border border-border rounded-md hover:text-foreground hover:bg-accent disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            Export CSV
          </button>
        </SimpleTooltip>
      </div>

      {/* Action type filter tabs */}
      <div className="flex gap-1 mb-4 flex-wrap">
        {ACTION_TYPE_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onActionTypeFilterChange(tab.key)}
            className={cn(
              'px-3 py-1 rounded-md text-[12px] font-medium transition-colors border',
              actionTypeFilter === tab.key
                ? 'bg-foreground text-background border-foreground'
                : 'bg-card text-muted-foreground border-border hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </>
  );
}
