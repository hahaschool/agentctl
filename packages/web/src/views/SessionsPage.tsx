'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Filter, MessageSquare } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ConfirmButton } from '../components/ConfirmButton';
import { CreateSessionForm } from '../components/CreateSessionForm';
import { EmptyState } from '../components/EmptyState';
import { FetchingBar } from '../components/FetchingBar';
import { ForkContextPicker } from '../components/ForkContextPicker';
import { LastUpdated } from '../components/LastUpdated';
import { RefreshButton } from '../components/RefreshButton';
import { SessionDetailPanel } from '../components/SessionDetailPanel';
import { SessionListItem } from '../components/SessionListItem';
import { SimpleTooltip } from '../components/SimpleTooltip';
import { useToast } from '../components/Toast';
import { useHotkeys } from '../hooks/use-hotkeys';
import type { AgentConfig, ApiAccount, Session, SessionContentMessage } from '../lib/api';
import { api } from '../lib/api';
import { downloadCsv, shortenPath } from '../lib/format-utils';
import { accountsQuery, queryKeys, sessionsQuery, useCreateAgent } from '../lib/queries';

type StatusFilter = 'all' | 'starting' | 'active' | 'ended' | 'error';
type SortOrder = 'newest' | 'oldest' | 'status' | 'cost' | 'duration';
type GroupBy = 'none' | 'project' | 'machine';

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'starting', label: 'Starting' },
  { key: 'active', label: 'Active' },
  { key: 'ended', label: 'Ended' },
  { key: 'error', label: 'Error' },
];

function matchesStatusFilter(status: string, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'ended') return status === 'ended' || status === 'paused';
  return status === filter;
}

function matchesSearchQuery(session: Session, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (session.id.toLowerCase().includes(q)) return true;
  if (session.agentId.toLowerCase().includes(q)) return true;
  if (session.agentName?.toLowerCase().includes(q)) return true;
  if (session.projectPath?.toLowerCase().includes(q)) return true;
  if (session.machineId.toLowerCase().includes(q)) return true;
  if (session.model?.toLowerCase().includes(q)) return true;
  return false;
}

function exportSessionsCsv(sessions: Session[]): void {
  downloadCsv(
    [
      'id',
      'agentName',
      'machineId',
      'status',
      'model',
      'projectPath',
      'startedAt',
      'endedAt',
      'costUsd',
      'messageCount',
    ],
    sessions.map((s) => [
      s.id,
      s.agentName ?? s.agentId,
      s.machineId,
      s.status,
      s.model,
      s.projectPath,
      s.startedAt,
      s.endedAt,
      s.metadata?.costUsd,
      s.metadata?.messageCount,
    ]),
    `sessions-${new Date().toISOString().slice(0, 10)}.csv`,
  );
}

const PAGE_SIZE = 50;

export function SessionsPage(): React.JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [offset, setOffset] = useState(0);
  const [accumulatedSessions, setAccumulatedSessions] = useState<Session[]>([]);

  const sessions = useQuery(sessionsQuery({ offset, limit: PAGE_SIZE }));

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
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [hideEmpty, setHideEmpty] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Convert session to agent
  const [showConvertDialog, setShowConvertDialog] = useState(false);
  const [convertName, setConvertName] = useState('');
  const [convertType, setConvertType] = useState('autonomous');
  const createAgent = useCreateAgent();

  // ForkContextPicker modal state
  const [showForkPicker, setShowForkPicker] = useState(false);
  const [forkPickerMessages, setForkPickerMessages] = useState<SessionContentMessage[]>([]);
  const [forkPickerLoading, setForkPickerLoading] = useState(false);

  // Bulk selection state
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

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
  }, [statusFilter, searchQuery]);

  // --- New Session form state ---
  const [showCreateForm, setShowCreateForm] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('create') === 'true';
  });

  // Clean up ?create=true from the URL after reading it
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('create') === 'true') {
      params.delete('create');
      const newUrl = params.toString()
        ? `${window.location.pathname}?${params.toString()}`
        : window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
  }, []);
  const accounts = useQuery(accountsQuery());

  // Reset pagination and invalidate all session queries so the list starts fresh.
  const resetAndInvalidateSessions = useCallback(() => {
    setOffset(0);
    setAccumulatedSessions([]);
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
  }, [queryClient]);

  useHotkeys(
    useMemo(
      () => ({
        r: () => resetAndInvalidateSessions(),
        n: () => setShowCreateForm(true),
        Escape: () => {
          if (checkedIds.size > 0) setCheckedIds(new Set());
          else if (showCreateForm) setShowCreateForm(false);
          else setSelectedId(null);
        },
      }),
      [resetAndInvalidateSessions, showCreateForm, checkedIds.size],
    ),
  );

  const handleSessionCreated = useCallback(() => {
    setShowCreateForm(false);
    resetAndInvalidateSessions();
  }, [resetAndInvalidateSessions]);

  const sessionList = accumulatedSessions;
  const hasMore = sessions.data?.hasMore ?? false;
  const totalCount = sessions.data?.total ?? accumulatedSessions.length;

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: sessionList.length,
      starting: 0,
      active: 0,
      ended: 0,
      error: 0,
    };
    for (const s of sessionList) {
      if (s.status === 'starting') counts.starting++;
      else if (s.status === 'active') counts.active++;
      else if (s.status === 'ended' || s.status === 'paused') counts.ended++;
      else if (s.status === 'error') counts.error++;
    }
    return counts;
  }, [sessionList]);

  const filteredSessions = useMemo(() => {
    let result = sessionList.filter(
      (s) => matchesStatusFilter(s.status, statusFilter) && matchesSearchQuery(s, searchQuery),
    );

    if (hideEmpty) {
      result = result.filter((s) => s.claudeSessionId);
    }

    // Sort
    if (sortOrder === 'newest') {
      result = [...result].sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      );
    } else if (sortOrder === 'oldest') {
      result = [...result].sort(
        (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
      );
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
      result = [...result].sort((a, b) => (b.metadata?.costUsd ?? 0) - (a.metadata?.costUsd ?? 0));
    } else if (sortOrder === 'duration') {
      result = [...result].sort((a, b) => {
        const endA = a.endedAt ?? a.lastHeartbeat ?? new Date().toISOString();
        const endB = b.endedAt ?? b.lastHeartbeat ?? new Date().toISOString();
        const durA = new Date(endA).getTime() - new Date(a.startedAt).getTime();
        const durB = new Date(endB).getTime() - new Date(b.startedAt).getTime();
        return durB - durA;
      });
    }

    return result;
  }, [sessionList, statusFilter, searchQuery, hideEmpty, sortOrder]);

  const groupedSessions = useMemo(() => {
    if (groupBy === 'none') return null;

    const groups = new Map<string, Session[]>();
    for (const s of filteredSessions) {
      const key =
        groupBy === 'project' ? (shortenPath(s.projectPath) ?? '(no project)') : s.machineId;
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
      sessionList.filter(
        (s) => s.status === 'ended' || s.status === 'paused' || s.status === 'error',
      ),
    [sessionList],
  );

  const handleCleanup = useCallback(async () => {
    if (cleanupSessions.length === 0) return;
    try {
      const results = await Promise.allSettled(cleanupSessions.map((s) => api.deleteSession(s.id)));
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
      const results = await Promise.allSettled(ids.map((id) => api.deleteSession(id)));
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

  const selected = sessionList.find((s) => s.id === selectedId) ?? null;

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
          setConvertType('autonomous');
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : String(err));
        },
      },
    );
  }, [selected, convertName, convertType, createAgent, toast]);

  const openForkPicker = useCallback(async () => {
    if (!selected?.claudeSessionId || !selected.machineId) return;
    setForkPickerLoading(true);
    try {
      const result = await api.getSessionContent(selected.claudeSessionId, {
        machineId: selected.machineId,
        limit: 200,
        projectPath: selected.projectPath ?? undefined,
      });
      setForkPickerMessages(result.messages);
      setShowForkPicker(true);
    } catch (err) {
      toast.error(`Failed to load messages: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setForkPickerLoading(false);
    }
  }, [selected, toast]);

  const handleForkSubmit = useCallback(
    (config: {
      name: string;
      type: string;
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
          ...(selected.projectPath ? { projectPath: selected.projectPath } : {}),
          ...(Object.keys(agentConfig).length > 0 ? { config: agentConfig } : {}),
        },
        {
          onSuccess: () => {
            toast.success(`Agent "${config.name}" created from session`);
            setShowForkPicker(false);
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
          selected ? 'hidden md:flex' : 'flex w-full',
          // Desktop: fixed sidebar width
          'md:w-[340px] md:min-w-[340px] md:max-w-[340px] overflow-hidden',
        )}
      >
        <div className="px-3 pt-3 pb-2 border-b border-border">
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-sm font-semibold tracking-tight flex-1 min-w-0">
              Sessions
              <span className="ml-1.5 text-[11px] font-normal text-muted-foreground tabular-nums">
                {hasMore ? `${sessionList.length}/${totalCount}` : String(filteredSessions.length)}
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
              onClick={() => resetAndInvalidateSessions()}
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
          <label
            htmlFor="sessions-select-all"
            className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer py-1"
          >
            <input
              id="sessions-select-all"
              type="checkbox"
              checked={checkedIds.size > 0 && checkedIds.size === filteredSessions.length}
              ref={(el) => {
                if (el) {
                  el.indeterminate =
                    checkedIds.size > 0 && checkedIds.size < filteredSessions.length;
                }
              }}
              onChange={() => {
                if (checkedIds.size === filteredSessions.length && filteredSessions.length > 0) {
                  setCheckedIds(new Set());
                } else {
                  setCheckedIds(new Set(filteredSessions.map((s) => s.id)));
                }
              }}
              className="w-3 h-3 cursor-pointer"
            />
          </label>
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as SortOrder)}
            aria-label="Sort order"
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
            sessionList.length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title="No sessions yet"
                description="Create a new session using the form above to get started."
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
            Array.from(groupedSessions.entries()).map(([groupKey, groupItems]) => (
              <div key={groupKey}>
                <button
                  type="button"
                  onClick={() => toggleGroupCollapsed(groupKey)}
                  aria-expanded={!collapsedGroups.has(groupKey)}
                  className="flex items-center gap-1.5 w-full px-3 py-2 bg-card border-b border-border text-[11px] font-semibold text-muted-foreground cursor-pointer text-left"
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
                {!collapsedGroups.has(groupKey) &&
                  groupItems.map((s) => (
                    <SessionListItem
                      key={s.id}
                      session={s}
                      isSelected={selectedId === s.id}
                      isFocused={focusedIndex >= 0 && filteredSessions[focusedIndex]?.id === s.id}
                      onSelect={setSelectedId}
                      isChecked={checkedIds.has(s.id)}
                      onToggleCheck={toggleChecked}
                    />
                  ))}
              </div>
            ))
          ) : (
            filteredSessions.map((s, i) => (
              <SessionListItem
                key={s.id}
                session={s}
                isSelected={selectedId === s.id}
                isFocused={focusedIndex === i}
                onSelect={setSelectedId}
                isChecked={checkedIds.has(s.id)}
                onToggleCheck={toggleChecked}
              />
            ))
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
                  {sessions.isFetching
                    ? 'Loading...'
                    : `Load more (${totalCount - sessionList.length} remaining)`}
                </button>
              ) : sessionList.length > 0 ? (
                <p className="text-[11px] text-muted-foreground text-center">
                  All {sessionList.length} sessions loaded
                </p>
              ) : null}
            </div>
          )}
        </div>

        {/* Floating bulk action bar */}
        {checkedIds.size > 0 && (
          <div className="border-t border-border bg-card px-3 py-2.5 flex items-center gap-2 shrink-0 shadow-sm">
            <span className="text-xs font-medium tabular-nums text-foreground">
              {checkedIds.size} selected
            </span>
            <div className="flex-1" />
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
          selected ? 'flex' : 'hidden md:flex',
        )}
      >
        {selected ? (
          <SessionDetailPanel
            session={selected}
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
            onConvertToAgent={handleConvertToAgent}
            onOpenConvertDialog={() => {
              setConvertName(selected.agentName ?? `agent-from-${selected.id.slice(0, 8)}`);
              setShowConvertDialog(true);
            }}
            onCloseConvertDialog={() => setShowConvertDialog(false)}
            onOpenForkPicker={() => void openForkPicker()}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <span className="text-sm">Select a session to view details</span>
            <span className="text-xs text-muted-foreground/50">
              Use arrow keys to navigate the list
            </span>
          </div>
        )}
      </div>

      {/* ForkContextPicker modal */}
      {selected && (
        <ForkContextPicker
          session={selected}
          messages={forkPickerMessages}
          open={showForkPicker}
          onClose={() => {
            setShowForkPicker(false);
            setForkPickerMessages([]);
          }}
          onSubmit={handleForkSubmit}
          isSubmitting={createAgent.isPending}
        />
      )}
    </div>
  );
}
