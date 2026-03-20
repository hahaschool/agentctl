'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Filter, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ConfirmButton } from '../components/ConfirmButton';
import { CreateSessionForm } from '../components/CreateSessionForm';
import { ContextPickerDialog, type ForkSubmitConfig } from '../components/context-picker';
import { EmptyState } from '../components/EmptyState';
import { FetchingBar } from '../components/FetchingBar';
import { LastUpdated } from '../components/LastUpdated';
import { RefreshButton } from '../components/RefreshButton';
import { SessionDetailPanel } from '../components/SessionDetailPanel';
import { SessionListItem } from '../components/SessionListItem';
import { SimpleTooltip } from '../components/SimpleTooltip';
import { useToast } from '../components/Toast';
import { useHotkeys } from '../hooks/use-hotkeys';
import type { AgentConfig, ApiAccount, Session, SessionContentMessage } from '../lib/api';
import { api } from '../lib/api';
import {
  downloadCsv,
  formatCost,
  formatDurationMs,
  formatNumber,
  shortenPath,
} from '../lib/format-utils';
import type { AgentRuntime } from '../lib/model-options';
import {
  accountsQuery,
  queryKeys,
  runtimeSessionsQuery,
  sessionsQuery,
  useCreateAgent,
  useForkSession,
} from '../lib/queries';
import { RuntimeSessionPanel } from './RuntimeSessionPanel';
import {
  buildUnifiedSessionRows,
  matchesUnifiedSessionSearch,
  matchesUnifiedSessionType,
  type UnifiedRuntimeSessionRow,
  type UnifiedSessionRow,
  type UnifiedSessionTypeFilter,
} from './unified-session-model';

type StatusFilter = 'all' | 'starting' | 'active' | 'ended' | 'error';
type SortOrder = 'newest' | 'oldest' | 'status' | 'cost' | 'duration';
type GroupBy = 'none' | 'project' | 'machine' | 'agent';

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'starting', label: 'Starting' },
  { key: 'active', label: 'Active' },
  { key: 'ended', label: 'Ended' },
  { key: 'error', label: 'Error' },
];

const TYPE_OPTIONS: Array<{ key: UnifiedSessionTypeFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'agent', label: 'Agent' },
  { key: 'runtime', label: 'Runtime' },
];

function matchesStatusFilter(status: string, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'ended') return status === 'ended' || status === 'paused';
  return status === filter;
}

function exportSessionsCsv(rows: UnifiedSessionRow[]): void {
  downloadCsv(
    [
      'id',
      'type',
      'label',
      'machineId',
      'status',
      'model',
      'projectPath',
      'startedAt',
      'endedAt',
      'activityAt',
      'costUsd',
      'messageCount',
    ],
    rows.map((row) => {
      if (row.kind === 'agent') {
        const session = row.session;
        return [
          row.id,
          'agent',
          row.label,
          row.machineId,
          row.status,
          session.model,
          row.projectPath,
          session.startedAt,
          session.endedAt,
          row.activityAt,
          session.metadata?.costUsd,
          session.metadata?.messageCount,
        ];
      }

      const session = row.session;
      return [
        row.id,
        'runtime',
        row.label,
        row.machineId,
        row.status,
        typeof session.metadata?.model === 'string' ? session.metadata.model : null,
        row.projectPath,
        session.startedAt,
        session.endedAt,
        row.activityAt,
        null,
        null,
      ];
    }),
    `sessions-${new Date().toISOString().slice(0, 10)}.csv`,
  );
}

const PAGE_SIZE = 50;

type RuntimeSessionListItemProps = {
  row: UnifiedRuntimeSessionRow;
  isSelected: boolean;
  isFocused: boolean;
  onSelect: (id: string) => void;
};

const RuntimeSessionListItem = React.memo(function RuntimeSessionListItem({
  row,
  isSelected,
  isFocused,
  onSelect,
}: RuntimeSessionListItemProps): React.JSX.Element {
  const model =
    typeof row.session.metadata?.model === 'string' ? row.session.metadata.model : 'default';

  return (
    <div
      role="option"
      id={`session-${row.id}`}
      tabIndex={isFocused ? 0 : -1}
      aria-selected={isSelected}
      className={cn(
        'group flex w-full text-left border-b border-border transition-all duration-200 hover:border-border/80 border-l-[3px]',
        isSelected
          ? 'bg-accent/15 border-l-blue-500'
          : isFocused
            ? 'bg-accent/10 ring-1 ring-inset ring-primary/40 border-l-blue-500/70'
            : 'bg-transparent hover:bg-accent/8 border-l-blue-500/50',
      )}
    >
      <div className="flex items-start pt-4 pl-2.5 shrink-0">
        <div className="w-4 h-4 rounded border border-border/60 bg-muted/30" aria-hidden />
      </div>
      <button
        type="button"
        onClick={() => onSelect(row.id)}
        className="flex-1 text-left px-2.5 pr-4 py-3.5 bg-transparent border-0 cursor-pointer min-w-0"
      >
        <div className="flex justify-between items-center mb-1.5 gap-2">
          <span className="font-medium text-xs text-foreground/90 truncate">{row.label}</span>
          <span className="text-[11px] text-muted-foreground uppercase tracking-wide">
            {row.status}
          </span>
        </div>
        <div className="text-xs text-muted-foreground flex gap-2 items-center flex-wrap">
          <span className="font-medium text-foreground/70">{row.machineId}</span>
          <span className="text-muted-foreground/50">|</span>
          <span>{model}</span>
          {row.runtime && (
            <>
              <span className="text-muted-foreground/50">|</span>
              <span className="text-xs text-muted-foreground">
                {row.runtime === 'codex' ? 'Codex' : 'Claude'}
              </span>
            </>
          )}
          {row.secondaryLabel && (
            <>
              <span className="text-muted-foreground/50">|</span>
              <span className="font-mono">{row.secondaryLabel}</span>
            </>
          )}
        </div>
        {row.projectPath && (
          <div className="mt-1 text-[11px] text-muted-foreground/80 truncate">
            {row.projectPath}
          </div>
        )}
      </button>
    </div>
  );
});

export function SessionsPage(): React.JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [offset, setOffset] = useState(0);
  const [accumulatedSessions, setAccumulatedSessions] = useState<Session[]>([]);

  const sessions = useQuery(sessionsQuery({ offset, limit: PAGE_SIZE }));
  const runtimeSessions = useQuery(runtimeSessionsQuery({ limit: 100 }));

  // When fresh data arrives, append to (or replace) the accumulated list.
  // If offset is 0 it's a fresh load/reset, so we replace.
  useEffect(() => {
    if (!sessions.data) return;
    const newSessions = sessions.data.sessions;
    setAccumulatedSessions((prev) => {
      if (offset === 0) {
        return newSessions;
      }
      const existingIds = new Set(prev.map((s) => s.id));
      const dedupedSessions = newSessions.filter((s) => !existingIds.has(s.id));
      return [...prev, ...dedupedSessions];
    });
  }, [sessions.data, offset]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [prompt, setPrompt] = useState('');
  const [resumeModel, setResumeModel] = useState('');
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [lastSentMessage, setLastSentMessage] = useState<{ text: string; ts: number } | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<UnifiedSessionTypeFilter>(() => {
    if (typeof window === 'undefined') return 'all';
    const type = new URLSearchParams(window.location.search).get('type');
    return type === 'agent' || type === 'runtime' ? type : 'all';
  });
  const [searchQuery, setSearchQuery] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('agentId') ?? '';
  });
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [hideEmpty, setHideEmpty] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Convert session to agent
  const [showConvertDialog, setShowConvertDialog] = useState(false);
  const [convertName, setConvertName] = useState('');
  const [convertType, setConvertType] = useState('adhoc');
  const createAgent = useCreateAgent();
  const forkSession = useForkSession();

  // ContextPickerDialog modal state
  const [showForkPicker, setShowForkPicker] = useState(false);
  const [forkPickerDefaultTab, setForkPickerDefaultTab] = useState<'fork' | 'agent'>('agent');
  const [forkPickerMessages, setForkPickerMessages] = useState<SessionContentMessage[]>([]);
  const [forkPickerLoading, setForkPickerLoading] = useState(false);

  // Bulk selection state
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const lastClickedIndexRef = useRef<number>(-1);

  const toggleChecked = useCallback((id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Reset pagination when filter or search changes so we don't stay on a stale page.
  // Also clear bulk selection when filters change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are intentional trigger values
  useEffect(() => {
    setOffset(0);
    setCheckedIds(new Set());
  }, [statusFilter, searchQuery, typeFilter]);

  // --- New Session form state ---
  const [showCreateForm, setShowCreateForm] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('create') === 'true';
  });

  // Clean up ?create=true and ?agentId= from the URL after reading them
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    let changed = false;
    if (params.get('create') === 'true') {
      params.delete('create');
      changed = true;
    }
    if (params.has('agentId')) {
      params.delete('agentId');
      changed = true;
    }
    if (changed) {
      const newUrl = params.toString()
        ? `${window.location.pathname}?${params.toString()}`
        : window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
  }, []);
  const accounts = useQuery(accountsQuery());

  // Reset pagination and invalidate all session queries so the list starts fresh.
  // Used after destructive operations (delete, cleanup) where data actually changes.
  const resetAndInvalidateSessions = useCallback(() => {
    setOffset(0);
    setAccumulatedSessions([]);
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
    void queryClient.invalidateQueries({ queryKey: ['runtime-sessions'] });
  }, [queryClient]);

  // Refresh without clearing accumulated sessions — avoids empty flash.
  // React Query's structural sharing means if data is unchanged the useEffect
  // won't re-fire, so we must NOT eagerly clear accumulatedSessions here.
  const refreshSessions = useCallback(async () => {
    setOffset(0);
    await Promise.all([
      queryClient.refetchQueries({ queryKey: queryKeys.sessions() }),
      queryClient.refetchQueries({ queryKey: ['runtime-sessions'] }),
    ]);
  }, [queryClient]);

  useHotkeys(
    useMemo(
      () => ({
        r: () => void refreshSessions(),
        n: () => setShowCreateForm(true),
        Escape: () => {
          if (checkedIds.size > 0) setCheckedIds(new Set());
          else if (showCreateForm) setShowCreateForm(false);
          else setSelectedId(null);
        },
      }),
      [refreshSessions, showCreateForm, checkedIds.size],
    ),
  );

  const handleSessionCreated = useCallback(() => {
    setShowCreateForm(false);
    resetAndInvalidateSessions();
  }, [resetAndInvalidateSessions]);

  const sessionList = accumulatedSessions;
  const runtimeSessionList = runtimeSessions.data?.sessions ?? [];
  const unifiedSessionList = useMemo(
    () => buildUnifiedSessionRows(sessionList, runtimeSessionList),
    [runtimeSessionList, sessionList],
  );
  const hasMore = sessions.data?.hasMore ?? false;
  const totalCount =
    (sessions.data?.total ?? sessionList.length) +
    (runtimeSessions.data?.count ?? runtimeSessionList.length);
  const loadedCount = sessionList.length + runtimeSessionList.length;

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: unifiedSessionList.length,
      starting: 0,
      active: 0,
      ended: 0,
      error: 0,
    };
    for (const row of unifiedSessionList) {
      if (row.status === 'starting') counts.starting++;
      else if (row.status === 'active') counts.active++;
      else if (row.status === 'ended' || row.status === 'paused') counts.ended++;
      else if (row.status === 'error') counts.error++;
    }
    return counts;
  }, [unifiedSessionList]);

  const summaryStats = useMemo(() => {
    let activeCount = 0;
    let totalCostUsd = 0;
    let totalDurationMs = 0;
    let durationSamples = 0;
    const nowMs = Date.now();

    for (const row of unifiedSessionList) {
      if (row.status === 'active' || row.status === 'starting') {
        activeCount += 1;
      }

      if (row.kind === 'agent') {
        const cost = row.session.metadata?.costUsd;
        if (typeof cost === 'number' && Number.isFinite(cost)) {
          totalCostUsd += cost;
        }
      }

      const startTime =
        row.kind === 'agent'
          ? row.session.startedAt
          : (row.session.startedAt ?? row.activityAt ?? null);

      if (!startTime) continue;
      const startMs = new Date(startTime).getTime();
      if (!Number.isFinite(startMs)) continue;

      const endTime =
        row.kind === 'agent'
          ? (row.session.endedAt ?? row.session.lastHeartbeat ?? null)
          : (row.session.endedAt ?? row.session.lastHeartbeat ?? row.activityAt ?? null);
      const endMs = endTime ? new Date(endTime).getTime() : nowMs;
      if (!Number.isFinite(endMs)) continue;

      totalDurationMs += Math.max(0, endMs - startMs);
      durationSamples += 1;
    }

    const averageDurationMs = durationSamples > 0 ? totalDurationMs / durationSamples : null;

    return {
      activeCount,
      totalCostUsd,
      averageDurationMs,
    };
  }, [unifiedSessionList]);

  const filteredSessions = useMemo(() => {
    let result = unifiedSessionList.filter(
      (row) =>
        matchesUnifiedSessionType(row, typeFilter) &&
        matchesStatusFilter(row.status, statusFilter) &&
        matchesUnifiedSessionSearch(row, searchQuery),
    );

    if (hideEmpty) {
      result = result.filter((row) =>
        row.kind === 'agent'
          ? Boolean(row.session.claudeSessionId)
          : Boolean(row.session.nativeSessionId),
      );
    }

    // Sort
    if (sortOrder === 'newest') {
      result = [...result].sort((a, b) => {
        const newestA =
          a.kind === 'agent' ? a.session.startedAt : (a.activityAt ?? a.session.startedAt ?? 0);
        const newestB =
          b.kind === 'agent' ? b.session.startedAt : (b.activityAt ?? b.session.startedAt ?? 0);
        return new Date(newestB).getTime() - new Date(newestA).getTime();
      });
    } else if (sortOrder === 'oldest') {
      result = [...result].sort((a, b) => {
        const oldestA =
          a.kind === 'agent' ? a.session.startedAt : (a.session.startedAt ?? a.activityAt ?? 0);
        const oldestB =
          b.kind === 'agent' ? b.session.startedAt : (b.session.startedAt ?? b.activityAt ?? 0);
        return new Date(oldestA).getTime() - new Date(oldestB).getTime();
      });
    } else if (sortOrder === 'status') {
      const statusOrder: Record<string, number> = {
        active: 0,
        starting: 1,
        paused: 2,
        ended: 3,
        error: 4,
      };
      result = [...result].sort(
        (a, b) => (statusOrder[a.status] ?? 5) - (statusOrder[b.status] ?? 5),
      );
    } else if (sortOrder === 'cost') {
      result = [...result].sort((a, b) => {
        const costA = a.kind === 'agent' ? (a.session.metadata?.costUsd ?? 0) : 0;
        const costB = b.kind === 'agent' ? (b.session.metadata?.costUsd ?? 0) : 0;
        return costB - costA;
      });
    } else if (sortOrder === 'duration') {
      result = [...result].sort((a, b) => {
        const startA =
          a.kind === 'agent'
            ? a.session.startedAt
            : (a.session.startedAt ?? a.activityAt ?? new Date().toISOString());
        const startB =
          b.kind === 'agent'
            ? b.session.startedAt
            : (b.session.startedAt ?? b.activityAt ?? new Date().toISOString());
        const endA = a.activityAt ?? new Date().toISOString();
        const endB = b.activityAt ?? new Date().toISOString();
        const durA = new Date(endA).getTime() - new Date(startA).getTime();
        const durB = new Date(endB).getTime() - new Date(startB).getTime();
        return durB - durA;
      });
    }

    return result;
  }, [hideEmpty, searchQuery, sortOrder, statusFilter, typeFilter, unifiedSessionList]);

  const selectableRows = useMemo(
    () =>
      filteredSessions.filter(
        (row): row is Extract<UnifiedSessionRow, { kind: 'agent' }> => row.kind === 'agent',
      ),
    [filteredSessions],
  );

  const groupedSessions = useMemo(() => {
    if (groupBy === 'none') return null;

    const groups = new Map<string, UnifiedSessionRow[]>();
    for (const s of filteredSessions) {
      const key =
        groupBy === 'project'
          ? (shortenPath(s.projectPath) ?? '(no project)')
          : groupBy === 'agent'
            ? s.kind === 'agent'
              ? (s.session.agentName ?? s.session.agentId.slice(0, 12))
              : s.label
            : s.machineId;
      const existing = groups.get(key);
      if (existing) {
        existing.push(s);
      } else {
        groups.set(key, [s]);
      }
    }
    return groups;
  }, [filteredSessions, groupBy]);

  // Reset keyboard focus when the visible list changes (filter/search/sort)
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are intentional trigger values
  useEffect(() => {
    setFocusedIndex(-1);
  }, [statusFilter, searchQuery, sortOrder, hideEmpty, groupBy]);

  const toggleGroupCollapsed = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const cleanupSessions = useMemo(
    () =>
      filteredSessions
        .filter((row): row is Extract<UnifiedSessionRow, { kind: 'agent' }> => row.kind === 'agent')
        .map((row) => row.session)
        .filter((s) => s.status === 'ended' || s.status === 'paused' || s.status === 'error'),
    [filteredSessions],
  );

  const handleCleanup = useCallback(async () => {
    if (cleanupSessions.length === 0) return;
    try {
      const results = await Promise.allSettled(
        cleanupSessions.map((s) => api.deleteSession(s.id, { purge: true })),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        toast.error(`${failed} of ${cleanupSessions.length} cleanup(s) failed`);
      } else {
        toast.success(`Cleaned up ${cleanupSessions.length} session(s)`);
      }
      resetAndInvalidateSessions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [cleanupSessions, resetAndInvalidateSessions, toast]);

  const handleBulkDelete = useCallback(async () => {
    if (checkedIds.size === 0) return;
    setBulkDeleting(true);
    try {
      const ids = Array.from(checkedIds);
      const results = await Promise.allSettled(
        ids.map((id) => api.deleteSession(id, { purge: true })),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        toast.error(`${failed} of ${ids.length} deletions failed`);
      } else {
        toast.success(`Deleted ${ids.length} ${ids.length === 1 ? 'session' : 'sessions'}`);
      }
      setCheckedIds(new Set());
      resetAndInvalidateSessions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkDeleting(false);
    }
  }, [checkedIds, resetAndInvalidateSessions, toast]);

  // Shift+click range selection handler
  const handleItemClick = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (e.shiftKey && lastClickedIndexRef.current >= 0) {
        const currentIndex = filteredSessions.findIndex((s) => s.id === id);
        if (currentIndex < 0) return;
        const start = Math.min(lastClickedIndexRef.current, currentIndex);
        const end = Math.max(lastClickedIndexRef.current, currentIndex);
        setCheckedIds((prev) => {
          const next = new Set(prev);
          for (let i = start; i <= end; i++) {
            const sessionAtIndex = filteredSessions[i];
            if (sessionAtIndex?.kind === 'agent') next.add(sessionAtIndex.id);
          }
          return next;
        });
        lastClickedIndexRef.current = currentIndex;
        return;
      }
      // Cmd/Ctrl click is handled in SessionListItem directly
      const idx = filteredSessions.findIndex((s) => s.id === id);
      if (idx >= 0) lastClickedIndexRef.current = idx;
    },
    [filteredSessions],
  );

  // Group-level select/deselect all sessions in a group
  const toggleGroupChecked = useCallback((groupItems: UnifiedSessionRow[]) => {
    setCheckedIds((prev) => {
      const groupIds = groupItems.filter((row) => row.kind === 'agent').map((s) => s.id);
      const allChecked = groupIds.every((gid) => prev.has(gid));
      const next = new Set(prev);
      if (allChecked) {
        for (const gid of groupIds) next.delete(gid);
      } else {
        for (const gid of groupIds) next.add(gid);
      }
      return next;
    });
  }, []);

  const selectedRow = unifiedSessionList.find((row) => row.id === selectedId) ?? null;
  const selected = selectedRow?.kind === 'agent' ? selectedRow.session : null;

  const handleSend = useCallback(async () => {
    if (!selected || !prompt.trim()) return;
    const messageText = prompt.trim();
    // Clear prompt and show optimistic message immediately — don't wait for API
    setPrompt('');
    setSending(true);
    setLastSentMessage({ text: messageText, ts: Date.now() });
    try {
      if (selected.status === 'active') {
        await api.sendMessage(selected.id, messageText);
      } else {
        await api.resumeSession(selected.id, messageText, resumeModel || undefined);
      }
      // Only invalidate queries — don't clear the session list (causes "0 sessions" flash)
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }, [selected, prompt, resumeModel, queryClient, toast]);

  const handleStop = useCallback(async () => {
    if (!selected || stopping) return;
    setStopping(true);
    try {
      await api.deleteSession(selected.id);
      toast.success('Session ended');
      resetAndInvalidateSessions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setStopping(false);
    }
  }, [selected, stopping, resetAndInvalidateSessions, toast]);

  const handleForceKill = useCallback(async () => {
    if (!selected) return;
    if (!confirm('Force kill this session? The CLI process will be terminated.')) return;
    try {
      await api.killSession(selected.id);
      toast.success('Session force killed');
      resetAndInvalidateSessions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [selected, resetAndInvalidateSessions, toast]);

  const handleConvertToAgent = useCallback(() => {
    if (!selected) return;
    const agentName = convertName.trim() || `agent-from-${selected.id.slice(0, 8)}`;
    const config: AgentConfig = {};
    if (selected.model) config.model = selected.model;

    createAgent.mutate(
      {
        name: agentName,
        machineId: selected.machineId,
        type: convertType,
        ...(selected.projectPath ? { projectPath: selected.projectPath } : {}),
        ...(Object.keys(config).length > 0 ? { config } : {}),
      },
      {
        onSuccess: () => {
          toast.success(`Agent "${agentName}" created from session`);
          setShowConvertDialog(false);
          setConvertName('');
          setConvertType('adhoc');
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : String(err));
        },
      },
    );
  }, [selected, convertName, convertType, createAgent, toast]);

  const openForkPicker = useCallback(
    async (defaultTab: 'fork' | 'agent' = 'agent') => {
      if (!selected?.claudeSessionId || !selected.machineId) return;
      setForkPickerLoading(true);
      try {
        const result = await api.getSessionContent(selected.claudeSessionId, {
          machineId: selected.machineId,
          limit: 10000,
          projectPath: selected.projectPath ?? undefined,
        });
        setForkPickerDefaultTab(defaultTab);
        setForkPickerMessages(result.messages);
        setShowForkPicker(true);
      } catch (err) {
        toast.error(`Failed to load messages: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setForkPickerLoading(false);
      }
    },
    [selected, toast],
  );

  const handleForkSessionSubmit = useCallback(
    (config: ForkSubmitConfig) => {
      if (!selected) return;

      forkSession.mutate(
        {
          id: selected.id,
          prompt: config.prompt,
          model: config.model,
          strategy: config.strategy,
          forkAtIndex: config.forkAtIndex,
          selectedMessages: config.selectedMessages?.map((msg) => ({
            type: msg.type,
            content: msg.content,
            toolName: msg.toolName,
            timestamp: msg.timestamp,
          })),
        },
        {
          onSuccess: (data) => {
            toast.success(`Forked session ${data.sessionId.slice(0, 12)}...`);
            resetAndInvalidateSessions();
            setSelectedId(data.sessionId);
            setShowForkPicker(false);
            setForkPickerDefaultTab('agent');
            setForkPickerMessages([]);
          },
          onError: (err) => {
            toast.error(err instanceof Error ? err.message : String(err));
          },
        },
      );
    },
    [selected, forkSession, toast, resetAndInvalidateSessions],
  );

  const handleCreateAgentFromPicker = useCallback(
    (config: {
      name: string;
      type: string;
      runtime: AgentRuntime;
      model?: string;
      systemPrompt?: string;
      selectedMessageIds: number[];
    }) => {
      if (!selected) return;
      const agentConfig: AgentConfig = {};
      if (config.model) agentConfig.model = config.model;
      if (config.systemPrompt) agentConfig.systemPrompt = config.systemPrompt;

      // Build context from selected messages
      const contextMessages = config.selectedMessageIds
        .map((idx) => forkPickerMessages[idx])
        .filter((msg): msg is SessionContentMessage => msg != null)
        .map((msg) => `[${msg.type}] ${msg.content}`)
        .join('\n\n');
      if (contextMessages) agentConfig.initialPrompt = contextMessages;

      createAgent.mutate(
        {
          name: config.name,
          machineId: selected.machineId,
          type: config.type,
          runtime: config.runtime,
          ...(selected.projectPath ? { projectPath: selected.projectPath } : {}),
          ...(Object.keys(agentConfig).length > 0 ? { config: agentConfig } : {}),
        },
        {
          onSuccess: () => {
            toast.success(`Agent "${config.name}" created from session`);
            setShowForkPicker(false);
            setForkPickerDefaultTab('agent');
            setForkPickerMessages([]);
          },
          onError: (err) => {
            toast.error(err instanceof Error ? err.message : String(err));
          },
        },
      );
    },
    [selected, forkPickerMessages, createAgent, toast],
  );

  // Keyboard navigation: arrow up/down to move focus, Enter to open, Escape to deselect
  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFocusedIndex(-1);
        setSelectedId(null);
        return;
      }
      const list = filteredSessions;
      if (list.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, list.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const focused = list[focusedIndex];
        if (focused) {
          setSelectedId(focused.id);
        }
      }
    },
    [filteredSessions, focusedIndex],
  );

  // Scroll the focused session item into view
  useEffect(() => {
    if (focusedIndex < 0) return;
    const focused = filteredSessions[focusedIndex];
    if (!focused) return;
    const el = document.getElementById(`session-${focused.id}`);
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex, filteredSessions]);

  return (
    <div className="relative flex h-full animate-page-enter">
      <FetchingBar isFetching={sessions.isFetching && !sessions.isLoading} />
      {/* Session list panel */}
      <div
        className={cn(
          'border-r border-border flex flex-col',
          // Mobile: full width, hidden when a session is selected
          selectedRow ? 'hidden md:flex' : 'flex w-full',
          // Desktop: fixed sidebar width
          'md:w-[340px] md:min-w-[340px] md:max-w-[340px] overflow-hidden',
        )}
      >
        <div className="px-3 pt-3 pb-2 border-b border-border">
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-sm font-semibold tracking-tight flex-1 min-w-0">
              Sessions
              <span className="ml-1.5 text-[11px] font-normal text-muted-foreground tabular-nums">
                {hasMore ? `${loadedCount}/${totalCount}` : String(filteredSessions.length)}
              </span>
            </h2>
            <button
              type="button"
              onClick={() => setShowCreateForm((prev) => !prev)}
              aria-label={showCreateForm ? 'Cancel new session form' : 'Create new session'}
              aria-expanded={showCreateForm}
              className={cn(
                'h-7 px-2.5 rounded-md text-[11px] font-medium whitespace-nowrap transition-all duration-200 shrink-0',
                showCreateForm
                  ? 'bg-primary text-white hover:bg-primary/90'
                  : 'bg-primary/10 text-primary hover:bg-primary/20',
              )}
            >
              {showCreateForm ? 'Cancel' : '+ New'}
            </button>
            <RefreshButton
              onClick={() => void refreshSessions()}
              isFetching={sessions.isFetching && !sessions.isLoading}
              label=""
              className="h-7 w-7 p-0 text-[11px] justify-center"
            />
          </div>
          <div className="flex items-center gap-1.5 text-[10px]">
            <span className="truncate min-w-0">
              <LastUpdated dataUpdatedAt={sessions.dataUpdatedAt} />
            </span>
            <span className="flex-1" />
            {cleanupSessions.length > 0 && (
              <ConfirmButton
                label={`Clean ${cleanupSessions.length}`}
                confirmLabel={`Delete ${cleanupSessions.length}?`}
                onConfirm={() => void handleCleanup()}
                className="h-6 px-2 rounded text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer shrink-0 whitespace-nowrap"
                confirmClassName="h-6 px-2 rounded text-[10px] font-medium bg-destructive text-destructive-foreground cursor-pointer shrink-0 whitespace-nowrap"
              />
            )}
            <SimpleTooltip
              content={
                filteredSessions.length === 0 ? 'No sessions to export' : 'Download sessions as CSV'
              }
            >
              <button
                type="button"
                onClick={() => exportSessionsCsv(filteredSessions)}
                disabled={filteredSessions.length === 0}
                className="h-6 px-2 rounded text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors shrink-0 whitespace-nowrap"
              >
                CSV
              </button>
            </SimpleTooltip>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 py-1.5 border-b border-border">
          <div className="relative">
            <input
              id="session-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sessions..."
              aria-label="Search sessions"
              className="w-full h-7 px-2.5 pr-12 bg-muted text-foreground border border-border rounded-md text-[11px] outline-none box-border transition-all duration-200 focus:ring-2 focus:ring-primary/20 focus:border-primary/40 placeholder:text-muted-foreground/50"
            />
            {!searchQuery && (
              <kbd className="absolute right-2 top-1/2 -translate-y-1/2 px-1 py-px text-[9px] font-mono text-muted-foreground/40 bg-background border border-border/50 rounded pointer-events-none">
                /
              </kbd>
            )}
          </div>
        </div>

        {/* Status tabs */}
        <div className="flex items-center border-b border-border overflow-x-auto">
          {STATUS_TABS.map((tab) => {
            const isActive = statusFilter === tab.key;
            const count = statusCounts[tab.key];
            return (
              <button
                type="button"
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={cn(
                  'shrink-0 px-2 py-1.5 text-[11px] cursor-pointer transition-colors border-b-2 text-center whitespace-nowrap',
                  isActive
                    ? 'font-medium text-foreground border-primary'
                    : 'font-normal text-muted-foreground border-transparent hover:text-foreground/70',
                )}
              >
                {tab.label}
                {count > 0 && (
                  <span className="ml-1 text-[10px] tabular-nums opacity-60">{count}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Status distribution bar */}
        {sessionList.length > 0 && (
          <div className="flex h-1 mx-3 mt-1 mb-0 rounded-full overflow-hidden bg-muted">
            {statusCounts.active > 0 && (
              <div
                className="bg-green-500 transition-all duration-500"
                style={{ width: `${(statusCounts.active / sessionList.length) * 100}%` }}
                title={`${statusCounts.active} active`}
              />
            )}
            {statusCounts.starting > 0 && (
              <div
                className="bg-yellow-500 transition-all duration-500"
                style={{ width: `${(statusCounts.starting / sessionList.length) * 100}%` }}
                title={`${statusCounts.starting} starting`}
              />
            )}
            {statusCounts.error > 0 && (
              <div
                className="bg-red-500 transition-all duration-500"
                style={{ width: `${(statusCounts.error / sessionList.length) * 100}%` }}
                title={`${statusCounts.error} error`}
              />
            )}
            {statusCounts.ended > 0 && (
              <div
                className="bg-muted-foreground/30 transition-all duration-500"
                style={{ width: `${(statusCounts.ended / sessionList.length) * 100}%` }}
                title={`${statusCounts.ended} ended`}
              />
            )}
          </div>
        )}

        {/* Sort / Bulk / Group controls */}
        <div className="px-2 py-1 border-b border-border flex items-center gap-1">
          <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer py-1">
            <span>Type</span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as UnifiedSessionTypeFilter)}
              aria-label="Type"
              className="h-6 px-1.5 bg-transparent text-muted-foreground text-[10px] border-0 outline-none cursor-pointer focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
            >
              {TYPE_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label
            htmlFor="sessions-select-all"
            className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer py-1"
          >
            <input
              id="sessions-select-all"
              type="checkbox"
              checked={checkedIds.size > 0 && checkedIds.size === selectableRows.length}
              ref={(el) => {
                if (el) {
                  el.indeterminate = checkedIds.size > 0 && checkedIds.size < selectableRows.length;
                }
              }}
              onChange={() => {
                if (checkedIds.size === selectableRows.length && selectableRows.length > 0) {
                  setCheckedIds(new Set());
                } else {
                  setCheckedIds(new Set(selectableRows.map((s) => s.id)));
                }
              }}
              className="w-3 h-3 cursor-pointer"
            />
          </label>
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as SortOrder)}
            aria-label="Sort by"
            className="h-5 px-1 bg-transparent text-muted-foreground text-[10px] border-0 outline-none cursor-pointer focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
          >
            <option value="newest">New</option>
            <option value="oldest">Old</option>
            <option value="status">Status</option>
            <option value="cost">Cost</option>
            <option value="duration">Duration</option>
          </select>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            aria-label="Group by"
            className="h-6 px-1.5 bg-transparent text-muted-foreground text-[10px] border-0 outline-none cursor-pointer focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
          >
            <option value="none">Flat</option>
            <option value="project">By Project</option>
            <option value="machine">By Machine</option>
            <option value="agent">By Agent</option>
          </select>
          <span className="flex-1" />
          <label
            htmlFor="sessions-hide-empty"
            className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer"
          >
            <input
              id="sessions-hide-empty"
              type="checkbox"
              checked={hideEmpty}
              onChange={(e) => setHideEmpty(e.target.checked)}
              className="w-3 h-3 cursor-pointer"
            />
            Hide empty
          </label>
        </div>

        {showCreateForm && (
          <CreateSessionForm
            accounts={(accounts.data ?? []) as ApiAccount[]}
            onCreated={handleSessionCreated}
          />
        )}

        <div
          className={cn(
            'flex-1 overflow-auto transition-opacity duration-200',
            sessions.isFetching && !sessions.isLoading && 'opacity-60',
          )}
          role="listbox"
          tabIndex={0}
          onKeyDown={handleListKeyDown}
          aria-label="Session list"
          aria-activedescendant={
            focusedIndex >= 0 && filteredSessions[focusedIndex]
              ? `session-${filteredSessions[focusedIndex].id}`
              : selectedId
                ? `session-${selectedId}`
                : undefined
          }
        >
          {sessions.isLoading ? (
            <div className="p-3 space-y-1">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={`sk-${String(i)}`} className="flex items-center gap-3 px-3 py-2.5">
                  <Skeleton className="w-[7px] h-[7px] rounded-full shrink-0" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-3 w-12 shrink-0" />
                </div>
              ))}
            </div>
          ) : filteredSessions.length === 0 ? (
            unifiedSessionList.length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title="No sessions yet. Start an agent or discover existing Claude Code sessions."
                action={
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <Button asChild size="sm">
                      <Link href="/agents">View Agents</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/discover">Discover Sessions</Link>
                    </Button>
                  </div>
                }
              />
            ) : statusFilter !== 'all' && !searchQuery ? (
              <EmptyState
                icon={Filter}
                title={`No ${statusFilter} sessions`}
                description={`There are currently no sessions with "${statusFilter}" status.`}
                action={
                  <button
                    type="button"
                    onClick={() => setStatusFilter('all')}
                    className="text-primary bg-transparent border-none p-0 cursor-pointer underline underline-offset-2 text-[13px]"
                  >
                    Show all sessions
                  </button>
                }
              />
            ) : (
              <EmptyState
                icon={Filter}
                title="No sessions match the filters"
                action={
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setStatusFilter('all');
                    }}
                    className="text-primary bg-transparent border-none p-0 cursor-pointer underline underline-offset-2 text-[13px]"
                  >
                    Clear filters
                  </button>
                }
              />
            )
          ) : groupedSessions ? (
            Array.from(groupedSessions.entries()).map(([groupKey, groupItems]) => {
              const groupAllChecked =
                groupItems.length > 0 && groupItems.every((s) => checkedIds.has(s.id));
              const groupSomeChecked =
                !groupAllChecked && groupItems.some((s) => checkedIds.has(s.id));
              return (
                <div key={groupKey}>
                  <div className="flex items-center gap-1.5 w-full px-3 py-2 bg-card border-b border-border text-[11px] font-semibold text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={groupAllChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = groupSomeChecked;
                      }}
                      onChange={() => toggleGroupChecked(groupItems)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select all sessions in ${groupKey}`}
                      className="w-4 h-4 cursor-pointer shrink-0"
                    />
                    <button
                      type="button"
                      onClick={() => toggleGroupCollapsed(groupKey)}
                      aria-expanded={!collapsedGroups.has(groupKey)}
                      className="flex items-center gap-1.5 flex-1 min-w-0 cursor-pointer bg-transparent border-0 text-left text-[11px] font-semibold text-muted-foreground"
                    >
                      <span
                        className={cn(
                          'inline-block text-[10px] transition-transform duration-150',
                          collapsedGroups.has(groupKey) ? '-rotate-90' : 'rotate-0',
                        )}
                      >
                        &#x25BC;
                      </span>
                      <span className="font-mono flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                        {groupKey}
                      </span>
                      <span className="text-muted-foreground font-normal">{groupItems.length}</span>
                    </button>
                  </div>
                  {!collapsedGroups.has(groupKey) &&
                    groupItems.map((s) =>
                      s.kind === 'agent' ? (
                        <SessionListItem
                          key={s.id}
                          session={s.session}
                          isSelected={selectedId === s.id}
                          isFocused={
                            focusedIndex >= 0 && filteredSessions[focusedIndex]?.id === s.id
                          }
                          onSelect={setSelectedId}
                          isChecked={checkedIds.has(s.id)}
                          onToggleCheck={toggleChecked}
                          onItemClick={handleItemClick}
                        />
                      ) : (
                        <RuntimeSessionListItem
                          key={s.id}
                          row={s}
                          isSelected={selectedId === s.id}
                          isFocused={
                            focusedIndex >= 0 && filteredSessions[focusedIndex]?.id === s.id
                          }
                          onSelect={setSelectedId}
                        />
                      ),
                    )}
                </div>
              );
            })
          ) : (
            filteredSessions.map((s, i) =>
              s.kind === 'agent' ? (
                <SessionListItem
                  key={s.id}
                  session={s.session}
                  isSelected={selectedId === s.id}
                  isFocused={focusedIndex === i}
                  onSelect={setSelectedId}
                  isChecked={checkedIds.has(s.id)}
                  onToggleCheck={toggleChecked}
                  onItemClick={handleItemClick}
                />
              ) : (
                <RuntimeSessionListItem
                  key={s.id}
                  row={s}
                  isSelected={selectedId === s.id}
                  isFocused={focusedIndex === i}
                  onSelect={setSelectedId}
                />
              ),
            )
          )}
          {!sessions.isLoading && (
            <div className="px-4 py-3 border-t border-border">
              {hasMore ? (
                <button
                  type="button"
                  onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
                  disabled={sessions.isFetching}
                  className="w-full h-9 px-3 bg-muted text-muted-foreground border border-border rounded-md text-xs font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:bg-accent hover:text-foreground"
                >
                  {sessions.isFetching ? (
                    <>
                      <Skeleton className="mx-auto h-3 w-16" />
                      <span className="sr-only">Fetching more sessions</span>
                    </>
                  ) : (
                    `Load more (${totalCount - loadedCount} remaining)`
                  )}
                </button>
              ) : unifiedSessionList.length > 0 ? (
                <p className="text-[11px] text-muted-foreground text-center">
                  All {unifiedSessionList.length} sessions loaded
                </p>
              ) : null}
            </div>
          )}
        </div>

        {/* Floating bulk action bar — sticky so always visible when scrolled */}
        {checkedIds.size > 0 && (
          <div className="sticky bottom-0 z-10 border-t border-border bg-card px-3 py-2.5 flex items-center gap-2 shrink-0 shadow-lg flex-wrap">
            <span className="text-xs font-medium tabular-nums text-foreground">
              {checkedIds.size} selected
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => {
                // Invert selection
                setCheckedIds((prev) => {
                  const next = new Set<string>();
                  for (const s of filteredSessions) {
                    if (s.kind === 'agent' && !prev.has(s.id)) next.add(s.id);
                  }
                  return next;
                });
              }}
              className="h-7 px-3 bg-muted text-muted-foreground border border-border rounded-md text-[11px] font-medium cursor-pointer transition-all duration-200 hover:bg-accent hover:text-foreground"
            >
              Invert
            </button>
            <button
              type="button"
              onClick={() => setCheckedIds(new Set())}
              className="h-7 px-3 bg-muted text-muted-foreground border border-border rounded-md text-[11px] font-medium cursor-pointer transition-all duration-200 hover:bg-accent hover:text-foreground"
            >
              Clear
            </button>
            <ConfirmButton
              label={`Delete (${checkedIds.size})`}
              confirmLabel={`Delete ${checkedIds.size} ${checkedIds.size === 1 ? 'session' : 'sessions'}?`}
              onConfirm={() => void handleBulkDelete()}
              disabled={bulkDeleting || checkedIds.size === 0}
              className="h-7 px-3 border border-destructive/50 rounded-md text-[11px] font-medium bg-destructive/10 text-destructive-foreground cursor-pointer transition-all duration-200 hover:bg-destructive/20"
              confirmClassName="h-7 px-3 border border-destructive rounded-md text-[11px] font-medium bg-destructive text-destructive-foreground cursor-pointer animate-pulse"
            />
          </div>
        )}
      </div>

      {/* Session detail panel */}
      <div
        className={cn(
          'flex-1 flex flex-col min-w-0 overflow-hidden',
          // Mobile: hidden when no session selected, full width when selected
          selectedRow ? 'flex' : 'hidden md:flex',
        )}
      >
        {selectedRow?.kind === 'agent' ? (
          <SessionDetailPanel
            session={selectedRow.session}
            accounts={(accounts.data ?? []) as ApiAccount[]}
            prompt={prompt}
            onPromptChange={setPrompt}
            resumeModel={resumeModel}
            onResumeModelChange={setResumeModel}
            sending={sending}
            lastSentMessage={lastSentMessage}
            showConvertDialog={showConvertDialog}
            convertName={convertName}
            onConvertNameChange={setConvertName}
            convertType={convertType}
            onConvertTypeChange={setConvertType}
            createAgentPending={createAgent.isPending}
            forkPickerLoading={forkPickerLoading}
            stopping={stopping}
            onBack={() => setSelectedId(null)}
            onSend={() => void handleSend()}
            onStop={() => void handleStop()}
            onForceKill={() => void handleForceKill()}
            onConvertToAgent={handleConvertToAgent}
            onOpenConvertDialog={() => {
              const agentSession = selectedRow.session;
              setConvertName(agentSession.agentName ?? `agent-from-${agentSession.id.slice(0, 8)}`);
              setShowConvertDialog(true);
            }}
            onCloseConvertDialog={() => setShowConvertDialog(false)}
            onOpenForkPicker={(defaultTab) => void openForkPicker(defaultTab ?? 'agent')}
          />
        ) : selectedRow?.kind === 'runtime' ? (
          <RuntimeSessionPanel
            selectedSession={selectedRow.session}
            onBack={() => setSelectedId(null)}
            onSelectedSessionChange={setSelectedId}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="w-full max-w-md rounded-lg border border-border bg-card/40 p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-foreground">Session Overview</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Select a session from the list to inspect its message stream.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-md border border-border bg-background/60 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Total Sessions
                  </div>
                  <div className="mt-1 text-lg font-semibold text-foreground">
                    {formatNumber(totalCount)}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-background/60 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Active Sessions
                  </div>
                  <div className="mt-1 text-lg font-semibold text-foreground">
                    {formatNumber(summaryStats.activeCount)}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-background/60 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Total Cost
                  </div>
                  <div className="mt-1 text-lg font-semibold text-foreground">
                    {formatCost(summaryStats.totalCostUsd)}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-background/60 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Avg Duration
                  </div>
                  <div className="mt-1 text-lg font-semibold text-foreground">
                    {formatDurationMs(summaryStats.averageDurationMs)}
                  </div>
                </div>
              </div>
              <p className="mt-4 text-[11px] text-muted-foreground/70">
                Tip: use arrow keys to navigate sessions quickly.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ContextPickerDialog for forking sessions or creating agents from session context. */}
      {selected && (
        <ContextPickerDialog
          defaultTab={forkPickerDefaultTab}
          session={selected}
          messages={forkPickerMessages}
          open={showForkPicker}
          onClose={() => {
            setShowForkPicker(false);
            setForkPickerDefaultTab('agent');
            setForkPickerMessages([]);
          }}
          onForkSubmit={handleForkSessionSubmit}
          onCreateAgentSubmit={handleCreateAgentFromPicker}
          isSubmitting={createAgent.isPending || forkSession.isPending}
        />
      )}
    </div>
  );
}
