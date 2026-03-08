import type React from 'react';

import { cn } from '@/lib/utils';
import type { AuditAction } from '../lib/api';
import { formatDateTime, formatDurationMs, formatTime } from '../lib/format-utils';
import { CopyableText } from './CopyableText';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTION_TYPE_COLORS: Record<string, string> = {
  tool_use: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
  tool_result: 'bg-green-500/15 text-green-500 border-green-500/30',
  text: 'bg-muted text-muted-foreground border-border',
  error: 'bg-red-500/15 text-red-500 border-red-500/30',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type LogsAuditActionRowProps = {
  action: AuditAction;
  isFirst: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  searchQuery: string;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LogsAuditActionRow({
  action,
  isFirst,
  isExpanded,
  onToggle,
  searchQuery,
}: LogsAuditActionRowProps): React.JSX.Element {
  const colorClass =
    ACTION_TYPE_COLORS[action.actionType] ?? 'bg-muted text-muted-foreground border-border';

  return (
    <div className={cn(!isFirst && 'border-t border-border')}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="w-full px-3.5 py-2.5 flex items-center gap-3 text-left bg-transparent hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-inset transition-colors cursor-pointer border-none"
      >
        {/* Action type badge */}
        <span
          className={cn(
            'inline-flex px-2 py-0.5 rounded text-[11px] font-medium border shrink-0',
            colorClass,
          )}
        >
          {action.actionType}
        </span>

        {/* Tool name */}
        {action.toolName && (
          <span className="text-[12px] font-mono font-medium text-foreground truncate max-w-[160px]">
            {highlightMatch(action.toolName, searchQuery)}
          </span>
        )}

        {/* Agent ID (short) */}
        {action.agentId && (
          <CopyableText
            value={action.agentId}
            maxDisplay={8}
            className="text-[11px] text-muted-foreground font-mono hidden sm:inline"
          />
        )}

        {/* Duration */}
        {action.durationMs != null && action.durationMs > 0 && (
          <span
            className={cn(
              'text-[11px] font-mono hidden md:inline',
              action.durationMs > 5000 ? 'text-yellow-500' : 'text-muted-foreground',
            )}
          >
            {formatDurationMs(action.durationMs)}
          </span>
        )}

        {/* Timestamp */}
        <span className="text-[11px] text-muted-foreground ml-auto shrink-0">
          {formatTime(action.timestamp)}
        </span>

        {/* Expand indicator */}
        <span
          className={cn(
            'text-[10px] text-muted-foreground transition-transform duration-150 shrink-0',
            isExpanded ? 'rotate-0' : '-rotate-90',
          )}
        >
          &#x25BC;
        </span>
      </button>

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-3.5 pb-3 pt-0">
          <div className="bg-muted/30 rounded p-3 space-y-2 text-[12px]">
            <AuditDetailRow label="ID" value={action.id} mono />
            <AuditDetailRow label="Run ID" value={action.runId} mono />
            <AuditDetailRow label="Timestamp" value={formatDateTime(action.timestamp)} />
            <AuditDetailRow label="Action Type" value={action.actionType} />
            {action.toolName && <AuditDetailRow label="Tool" value={action.toolName} mono />}
            {action.durationMs != null && (
              <AuditDetailRow label="Duration" value={`${action.durationMs}ms`} />
            )}
            {action.approvedBy && <AuditDetailRow label="Approved By" value={action.approvedBy} />}
            {action.toolOutputHash && (
              <AuditDetailRow label="Output Hash" value={action.toolOutputHash} mono />
            )}
            {action.toolInput && Object.keys(action.toolInput).length > 0 && (
              <div>
                <span className="text-[11px] text-muted-foreground font-medium">Tool Input:</span>
                <pre className="mt-1 p-2 bg-card border border-border/50 rounded font-mono text-[11px] text-muted-foreground whitespace-pre-wrap break-all max-h-[200px] overflow-auto">
                  {JSON.stringify(action.toolInput, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AuditDetailRow — simple label/value pair for expanded audit details
// ---------------------------------------------------------------------------

function AuditDetailRow({
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
// Highlight search matches
// ---------------------------------------------------------------------------

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-500/30 text-inherit rounded-sm px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}
