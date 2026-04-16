'use client';

import { useQuery } from '@tanstack/react-query';
import { GitPullRequestClosed } from 'lucide-react';
import type React from 'react';
import { useCallback, useMemo, useState } from 'react';

import { ConflictDiffView } from '@/components/ConflictDiffView';
import { EmptyState } from '@/components/EmptyState';
import { ErrorBanner } from '@/components/ErrorBanner';
import { FetchingBar } from '@/components/FetchingBar';
import { RefreshButton } from '@/components/RefreshButton';
import { useToast } from '@/components/Toast';
import type { SyncConflictItem } from '@/lib/api';
import { syncConflictsQuery, useResolveSyncConflict } from '@/lib/queries';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

type FilterState = {
  status: string;
  table: string;
  remoteNodeId: string;
};

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'resolved', label: 'Resolved' },
];

function FilterBar({
  filters,
  onChange,
  tableOptions,
  peerOptions,
}: {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  tableOptions: string[];
  peerOptions: string[];
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-3 mb-4">
      <select
        value={filters.status}
        onChange={(e) => onChange({ ...filters, status: e.target.value })}
        className="px-2 py-1.5 bg-muted text-foreground border border-border rounded-md text-xs outline-none focus:ring-2 focus:ring-primary/20"
        aria-label="Filter by status"
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            Status: {opt.label}
          </option>
        ))}
      </select>

      <select
        value={filters.table}
        onChange={(e) => onChange({ ...filters, table: e.target.value })}
        className="px-2 py-1.5 bg-muted text-foreground border border-border rounded-md text-xs outline-none focus:ring-2 focus:ring-primary/20"
        aria-label="Filter by table"
      >
        <option value="">All tables</option>
        {tableOptions.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      <select
        value={filters.remoteNodeId}
        onChange={(e) => onChange({ ...filters, remoteNodeId: e.target.value })}
        className="px-2 py-1.5 bg-muted text-foreground border border-border rounded-md text-xs outline-none focus:ring-2 focus:ring-primary/20"
        aria-label="Filter by peer"
      >
        <option value="">All peers</option>
        {peerOptions.map((p) => (
          <option key={p} value={p}>
            {p.slice(0, 16)}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conflict list row
// ---------------------------------------------------------------------------

function ConflictRow({
  conflict,
  isSelected,
  onClick,
}: {
  conflict: SyncConflictItem;
  isSelected: boolean;
  onClick: () => void;
}): React.JSX.Element {
  const isDelete = conflict.localPayload === null || conflict.remotePayload === null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left px-4 py-3 border-b border-border transition-colors',
        'hover:bg-accent/5',
        isSelected && 'bg-accent/10 border-l-2 border-l-primary',
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-mono text-xs text-foreground">{conflict.tableName}</span>
            <span className="text-muted-foreground text-[10px]">/</span>
            <span className="font-mono text-xs text-muted-foreground truncate">
              {conflict.rowId.slice(0, 12)}
            </span>
            {isDelete && (
              <span className="px-1.5 py-px rounded-sm bg-red-500/15 text-red-400 text-[10px] font-semibold">
                DELETE
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span>Local &harr; {conflict.remoteNodeId.slice(0, 12)}</span>
            <span>{new Date(conflict.createdAt).toLocaleString()}</span>
          </div>
        </div>
        <span
          className={cn(
            'shrink-0 px-2 py-0.5 rounded-sm text-[10px] font-semibold tracking-wide',
            conflict.status === 'pending'
              ? 'bg-yellow-500/15 text-yellow-400'
              : 'bg-green-500/15 text-green-400',
          )}
        >
          {conflict.status.toUpperCase()}
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// ConflictsPage
// ---------------------------------------------------------------------------

export function ConflictsPage(): React.JSX.Element {
  const [filters, setFilters] = useState<FilterState>({
    status: 'pending',
    table: '',
    remoteNodeId: '',
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const toast = useToast();

  const queryParams = useMemo(() => {
    const params: { status?: string; table?: string; remoteNodeId?: string } = {};
    if (filters.status) params.status = filters.status;
    if (filters.table) params.table = filters.table;
    if (filters.remoteNodeId) params.remoteNodeId = filters.remoteNodeId;
    return Object.keys(params).length > 0 ? params : undefined;
  }, [filters]);

  const conflictsData = useQuery(syncConflictsQuery(queryParams));
  const resolveMutation = useResolveSyncConflict();

  const conflicts = conflictsData.data?.conflicts ?? [];
  const selectedConflict = conflicts.find((c) => c.id === selectedId) ?? null;

  // Extract unique tables and peers from current results for filter dropdowns
  const tableOptions = useMemo(() => {
    const tables = new Set(conflicts.map((c) => c.tableName));
    return Array.from(tables).sort();
  }, [conflicts]);

  const peerOptions = useMemo(() => {
    const peers = new Set(conflicts.map((c) => c.remoteNodeId));
    return Array.from(peers).sort();
  }, [conflicts]);

  const handleResolve = useCallback(
    (resolution: 'local' | 'remote' | 'merged', payload?: Record<string, unknown> | null) => {
      if (!selectedId) return;

      resolveMutation.mutate(
        { id: selectedId, resolution, payload },
        {
          onSuccess: () => {
            toast.success(`Conflict resolved: ${resolution}`);
            setSelectedId(null);
          },
          onError: (err) => {
            toast.error(err instanceof Error ? err.message : 'Failed to resolve conflict');
          },
        },
      );
    },
    [selectedId, resolveMutation, toast],
  );

  const pendingCount = conflicts.filter((c) => c.status === 'pending').length;

  return (
    <div className="relative p-4 md:p-6 max-w-[1200px] animate-page-enter">
      <FetchingBar isFetching={conflictsData.isFetching && !conflictsData.isLoading} />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-[22px] font-semibold tracking-tight">Sync Conflicts</h1>
          {pendingCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 text-xs font-semibold">
              {pendingCount} pending
            </span>
          )}
        </div>
        <RefreshButton
          onClick={() => void conflictsData.refetch()}
          isFetching={conflictsData.isFetching && !conflictsData.isLoading}
        />
      </div>

      {/* Filters */}
      <FilterBar
        filters={filters}
        onChange={setFilters}
        tableOptions={tableOptions}
        peerOptions={peerOptions}
      />

      {/* Error */}
      {conflictsData.error && (
        <ErrorBanner
          message={`Failed to load conflicts: ${conflictsData.error.message}`}
          onRetry={() => void conflictsData.refetch()}
          className="mb-4"
        />
      )}

      {/* Loading */}
      {conflictsData.isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((k) => (
            <div key={k} className="h-16 bg-muted/30 rounded-md animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!conflictsData.isLoading && !conflictsData.error && conflicts.length === 0 && (
        <EmptyState
          icon={GitPullRequestClosed}
          title="No sync conflicts found"
          description={
            filters.status === 'pending' ? 'All conflicts have been resolved.' : undefined
          }
        />
      )}

      {/* List + Detail */}
      {conflicts.length > 0 && (
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Conflict list */}
          <div className="lg:w-[380px] shrink-0 border border-border rounded-md overflow-hidden bg-card">
            <div className="max-h-[600px] overflow-y-auto">
              {conflicts.map((conflict) => (
                <ConflictRow
                  key={conflict.id}
                  conflict={conflict}
                  isSelected={conflict.id === selectedId}
                  onClick={() => setSelectedId(conflict.id === selectedId ? null : conflict.id)}
                />
              ))}
            </div>
          </div>

          {/* Detail view */}
          <div className="flex-1 min-w-0">
            {selectedConflict ? (
              <div className="border border-border rounded-md p-4 bg-card">
                <ConflictDiffView
                  conflict={selectedConflict}
                  onResolve={handleResolve}
                  isResolving={resolveMutation.isPending}
                />
              </div>
            ) : (
              <div className="border border-border rounded-md p-8 bg-card text-center text-muted-foreground text-sm">
                Select a conflict to view details
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
