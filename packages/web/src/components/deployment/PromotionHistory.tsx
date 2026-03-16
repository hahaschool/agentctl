'use client';

import { CheckCircle, ChevronDown, ChevronRight, History, Minus, XCircle } from 'lucide-react';
import { useState } from 'react';

import type { DeploymentPromotionRecord } from '@/lib/api';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diffMs / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '--';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

const STATUS_BADGES: Record<string, { className: string; label: string }> = {
  success: { className: 'bg-green-500/15 text-green-400', label: 'success' },
  failed: { className: 'bg-red-500/15 text-red-400', label: 'failed' },
  running: { className: 'bg-blue-500/15 text-blue-400 animate-pulse', label: 'running' },
  pending: { className: 'bg-muted text-muted-foreground', label: 'pending' },
};

// ---------------------------------------------------------------------------
// Single record row
// ---------------------------------------------------------------------------

function RecordRow({ record }: { readonly record: DeploymentPromotionRecord }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const badge = STATUS_BADGES[record.status] ?? {
    className: 'bg-muted text-muted-foreground',
    label: record.status,
  };

  return (
    <div className="border-b border-border/20 last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full text-left py-2 px-1 hover:bg-muted/30 transition-colors rounded-sm"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown size={12} className="text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight size={12} className="text-muted-foreground shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-mono truncate">
                {record.sourceTier} → {record.targetTier}
              </span>
              <span
                className={cn('text-[9px] font-semibold px-1.5 py-px rounded-sm', badge.className)}
              >
                {badge.label}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-muted-foreground/60">
                {formatRelativeTime(record.startedAt)}
              </span>
              <span className="text-[10px] text-muted-foreground/60">
                {formatDuration(record.durationMs)}
              </span>
            </div>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="pl-6 pb-2 space-y-1.5">
          {record.checks.map((check) => (
            <div key={check.name} className="flex items-center gap-1.5 text-[11px]">
              {check.status === 'pass' && <CheckCircle size={11} className="text-green-400" />}
              {check.status === 'fail' && <XCircle size={11} className="text-red-400" />}
              {check.status === 'skipped' && (
                <Minus size={11} className="text-muted-foreground/50" />
              )}
              <span className="text-muted-foreground">{check.name}</span>
              {check.message && (
                <span className="text-muted-foreground/60 truncate">{check.message}</span>
              )}
            </div>
          ))}
          {record.error && (
            <div className="text-[11px] text-red-400 mt-1 break-words">{record.error}</div>
          )}
          {record.gitSha && (
            <div className="text-[10px] font-mono text-muted-foreground/50">
              sha: {record.gitSha.slice(0, 8)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PromotionHistory
// ---------------------------------------------------------------------------

type PromotionHistoryProps = {
  readonly records: DeploymentPromotionRecord[];
};

export function PromotionHistory({ records }: PromotionHistoryProps): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <h3 className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground/80 mb-2">
        Promotion History
      </h3>

      {records.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/70 bg-muted/20 px-3 py-5 text-center">
          <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-background/70">
            <History size={14} className="text-muted-foreground/60" aria-hidden="true" />
          </div>
          <p className="text-xs font-medium text-muted-foreground">No promotions yet</p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground/70">
            Run a beta promotion from a dev tier to see recent history here.
          </p>
        </div>
      ) : (
        <div className="max-h-[480px] overflow-y-auto">
          {records.map((record) => (
            <RecordRow key={record.id} record={record} />
          ))}
        </div>
      )}
    </div>
  );
}
