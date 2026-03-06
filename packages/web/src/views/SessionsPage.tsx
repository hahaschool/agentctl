'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Filter, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { AnsiSpan, AnsiText } from '../components/AnsiText';
import { ConfirmButton } from '../components/ConfirmButton';
import { CopyableText } from '../components/CopyableText';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { FetchingBar } from '../components/FetchingBar';
import { ForkContextPicker } from '../components/ForkContextPicker';
import { GitStatusBadge } from '../components/GitStatusBadge';
import { LastUpdated } from '../components/LastUpdated';
import { LiveTimeAgo } from '../components/LiveTimeAgo';
import { MarkdownContent } from '../components/MarkdownContent';
import { PathBadge } from '../components/PathBadge';
import { ProgressIndicator } from '../components/ProgressIndicator';
import { RefreshButton } from '../components/RefreshButton';
import { SimpleTooltip } from '../components/SimpleTooltip';
import { StatusBadge } from '../components/StatusBadge';
import { SubagentBlock } from '../components/SubagentBlock';
import { TerminalView } from '../components/TerminalView';
import { ThinkingBlock } from '../components/ThinkingBlock';
import { useToast } from '../components/Toast';
import { TodoBlock } from '../components/TodoBlock';
import { useNotificationContext } from '../contexts/notification-context';
import { useHotkeys } from '../hooks/use-hotkeys';
import type { SessionStreamEvent } from '../hooks/use-session-stream';
import { useSessionStream } from '../hooks/use-session-stream';
import type { ApiAccount, Machine, Session, SessionContentMessage } from '../lib/api';
import { api } from '../lib/api';
import { formatDateTime, formatDuration, formatTime, shortenPath } from '../lib/format-utils';
import { getMessageStyle } from '../lib/message-styles';
import { accountsQuery, queryKeys, sessionsQuery, useCreateAgent } from '../lib/queries';

const MODEL_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
];

type StatusFilter = 'all' | 'starting' | 'active' | 'ended' | 'error';
type SortOrder = 'newest' | 'oldest' | 'status';
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

function escapeCsvValue(value: string | number | null | undefined): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function exportSessionsCsv(sessions: Session[]): void {
  const headers = [
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
  ];
  const rows = sessions.map((s) =>
    [
      s.id,
      s.agentName ?? s.agentId,
      s.machineId,
      s.status,
      s.model ?? '',
      s.projectPath ?? '',
      s.startedAt,
      s.endedAt ?? '',
      s.metadata?.costUsd ?? '',
      s.metadata?.messageCount ?? '',
    ]
      .map(escapeCsvValue)
      .join(','),
  );

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sessions-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.data]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [prompt, setPrompt] = useState('');
  const [resumeModel, setResumeModel] = useState('');
  const [sending, setSending] = useState(false);
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
  useEffect(() => {
    setOffset(0);
    setCheckedIds(new Set());
  }, [statusFilter, searchQuery]);

  // --- New Session form state ---
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [machinesLoading, setMachinesLoading] = useState(false);
  const [formMachineId, setFormMachineId] = useState('');
  const [formProjectPath, setFormProjectPath] = useState('');
  const [formPrompt, setFormPrompt] = useState('');
  const [formModel, setFormModel] = useState(
    () =>
      (typeof window !== 'undefined' ? localStorage.getItem('agentctl:defaultModel') : null) ?? '',
  );
  const [formAccountId, setFormAccountId] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!showCreateForm) return;
    setMachinesLoading(true);
    api
      .listMachines()
      .then((list) => {
        setMachines(list);
        if (list.length > 0) {
          // Prefer the first online machine as the default selection
          const firstOnline = list.find((m) => m.status === 'online');
          const fallback = firstOnline ?? list[0];
          if (fallback) setFormMachineId((prev) => prev || fallback.id);
        }
      })
      .catch((err: unknown) => {
        console.warn('Failed to load machines:', err);
        setMachines([]);
      })
      .finally(() => {
        setMachinesLoading(false);
      });
  }, [showCreateForm]);

  const resetForm = useCallback(() => {
    setFormMachineId('');
    setFormProjectPath('');
    setFormPrompt('');
    setFormModel(
      (typeof window !== 'undefined' ? localStorage.getItem('agentctl:defaultModel') : null) ?? '',
    );
    setFormAccountId('');
    setFormError(null);
  }, []);

  const handleCreateSession = useCallback(async () => {
    setFormError(null);

    if (!formMachineId) {
      setFormError('Please select a machine.');
      return;
    }
    const selectedMachine = machines.find((m) => m.id === formMachineId);
    if (selectedMachine?.status === 'offline') {
      setFormError('Selected machine is offline. Please choose an online machine.');
      return;
    }
    if (!formProjectPath.trim()) {
      setFormError('Project path is required.');
      return;
    }
    if (!formProjectPath.trim().startsWith('/')) {
      setFormError('Project path must be an absolute path (start with /)');
      return;
    }
    if (!formPrompt.trim()) {
      setFormError('Prompt is required.');
      return;
    }

    setFormSubmitting(true);
    try {
      const result = await api.createSession({
        agentId: 'adhoc',
        machineId: formMachineId,
        projectPath: formProjectPath.trim(),
        prompt: formPrompt.trim(),
        model: formModel || undefined,
        accountId: formAccountId || undefined,
      });
      toast.success(`Session created: ${result.sessionId.slice(0, 16)}...`);
      resetForm();
      setShowCreateForm(false);
      resetAndInvalidateSessions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setFormSubmitting(false);
    }
  }, [
    formMachineId,
    formProjectPath,
    formPrompt,
    formModel,
    formAccountId,
    machines,
    resetForm,
    resetAndInvalidateSessions,
    toast,
  ]);

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
    if (!window.confirm(`Delete ${checkedIds.size} session(s)? This cannot be undone.`)) return;
    setBulkDeleting(true);
    try {
      const ids = Array.from(checkedIds);
      const results = await Promise.allSettled(ids.map((id) => api.deleteSession(id)));
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        toast.error(`${failed} of ${ids.length} deletion(s) failed`);
      } else {
        toast.success(`Deleted ${ids.length} session(s)`);
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
  }, [selected, prompt, queryClient, toast]);

  const handleStop = useCallback(async () => {
    if (!selected) return;
    try {
      await api.deleteSession(selected.id);
      toast.success('Session ended');
      resetAndInvalidateSessions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [selected, resetAndInvalidateSessions, toast]);

  const handleConvertToAgent = useCallback(() => {
    if (!selected) return;
    const agentName = convertName.trim() || `agent-from-${selected.id.slice(0, 8)}`;
    const config: Record<string, unknown> = {};
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
      const agentConfig: Record<string, unknown> = {};
      if (config.model) agentConfig.model = config.model;
      if (config.systemPrompt) agentConfig.systemPrompt = config.systemPrompt;

      // Build context from selected messages
      const contextMessages = config.selectedMessageIds
        .map((idx) => forkPickerMessages[idx])
        .filter((msg): msg is SessionContentMessage => msg != null)
        .map((msg) => `[${msg.type}] ${msg.content}`)
        .join('\n\n');
      if (contextMessages) agentConfig.context = contextMessages;

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

  const isFormDisabled =
    formSubmitting || !formMachineId || !formProjectPath.trim() || !formPrompt.trim();

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
              onClick={() => {
                setShowCreateForm((prev) => !prev);
                setFormError(null);
              }}
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
                filteredSessions.length === 0
                  ? 'No sessions to export'
                  : 'Download sessions as CSV'
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

        {/* Inline "New Session" creation form */}
        {showCreateForm && (
          <div className="px-4 py-4 border-b border-border bg-card/50">
            <div className="text-[13px] font-semibold mb-3 tracking-tight">Create New Session</div>

            {/* Machine selector */}
            <label
              htmlFor="create-session-machine"
              className="block text-[11px] text-muted-foreground mb-1"
            >
              Machine
            </label>
            <select
              id="create-session-machine"
              value={formMachineId}
              onChange={(e) => setFormMachineId(e.target.value)}
              disabled={machinesLoading}
              className="w-full px-2.5 py-2 bg-muted text-foreground border border-border rounded-md text-xs mb-2.5 outline-none transition-all duration-200 focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
            >
              {machinesLoading && <option value="">Loading machines...</option>}
              {!machinesLoading && machines.length === 0 && (
                <option value="">No machines available</option>
              )}
              {machines.map((m) => {
                const isOffline = m.status === 'offline';
                return (
                  <option key={m.id} value={m.id} disabled={isOffline}>
                    {m.hostname}
                    {isOffline ? ' (offline)' : m.status === 'degraded' ? ' (degraded)' : ''}
                  </option>
                );
              })}
            </select>

            {/* Project path */}
            <label
              htmlFor="create-session-project"
              className="block text-[11px] text-muted-foreground mb-1"
            >
              Project Path
            </label>
            <input
              id="create-session-project"
              type="text"
              value={formProjectPath}
              onChange={(e) => setFormProjectPath(e.target.value)}
              placeholder="/home/user/project"
              className="w-full px-2.5 py-2 bg-muted text-foreground border border-border rounded-md font-mono text-xs mb-2.5 outline-none box-border transition-all duration-200 focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
            />

            {/* Prompt */}
            <label
              htmlFor="create-session-prompt"
              className="block text-[11px] text-muted-foreground mb-1"
            >
              Prompt
            </label>
            <textarea
              id="create-session-prompt"
              value={formPrompt}
              onChange={(e) => setFormPrompt(e.target.value)}
              placeholder="What should Claude work on?"
              rows={3}
              className="w-full px-2.5 py-2 bg-muted text-foreground border border-border rounded-md text-xs mb-2.5 outline-none resize-y font-[inherit] box-border transition-all duration-200 focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
            />

            {/* Model selector */}
            <label
              htmlFor="create-session-model"
              className="block text-[11px] text-muted-foreground mb-1"
            >
              Model (optional)
            </label>
            <select
              id="create-session-model"
              value={formModel}
              onChange={(e) => setFormModel(e.target.value)}
              className="w-full px-2.5 py-2 bg-muted text-foreground border border-border rounded-md text-xs mb-2.5 outline-none transition-all duration-200 focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            {/* Account override selector */}
            <label
              htmlFor="create-session-account"
              className="block text-[11px] text-muted-foreground mb-1"
            >
              Account (optional)
            </label>
            <select
              id="create-session-account"
              value={formAccountId}
              onChange={(e) => setFormAccountId(e.target.value)}
              className="w-full px-2.5 py-2 bg-muted text-foreground border border-border rounded-md text-xs mb-3 outline-none transition-all duration-200 focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
            >
              <option value="">Default (auto)</option>
              {(accounts.data ?? [])
                .filter((a: ApiAccount) => a.isActive)
                .map((a: ApiAccount) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.provider})
                  </option>
                ))}
            </select>

            {/* Error / Success feedback */}
            {formError && <ErrorBanner message={formError} className="mb-2.5" />}
            {/* Submit button */}
            <button
              type="button"
              onClick={() => void handleCreateSession()}
              disabled={isFormDisabled}
              className={cn(
                'w-full h-9 px-3.5 bg-primary text-white rounded-md text-xs font-medium transition-all duration-200',
                isFormDisabled
                  ? 'opacity-50 cursor-not-allowed'
                  : 'opacity-100 cursor-pointer hover:bg-primary/90',
              )}
            >
              {formSubmitting ? 'Creating...' : 'Create Session'}
            </button>
          </div>
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
              confirmLabel={`Delete ${checkedIds.size} sessions?`}
              onConfirm={() => void handleBulkDelete()}
              disabled={bulkDeleting}
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
          <>
            {/* Header */}
            <div className="px-5 py-4 border-b border-border flex justify-between items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {/* Mobile back button */}
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="md:hidden text-muted-foreground text-sm shrink-0 hover:text-foreground transition-colors duration-200"
                    aria-label="Back to session list"
                  >
                    {'\u2190'}
                  </button>
                  <div className="flex items-center gap-2.5">
                    <CopyableText
                      value={selected.id}
                      maxDisplay={16}
                      className="font-mono text-[13px] font-semibold text-foreground/90"
                    />
                    <StatusBadge status={selected.status} />
                  </div>
                </div>
                <div className="text-xs text-muted-foreground flex gap-3 flex-wrap mt-1.5 items-center">
                  <span className="font-medium text-foreground/70">
                    {selected.agentName ? selected.agentName : selected.agentId.slice(0, 8)}
                  </span>
                  <span className="text-muted-foreground/40">|</span>
                  <span>{selected.machineId}</span>
                  <span className="text-muted-foreground/40">|</span>
                  <span className="text-purple-600/80 dark:text-purple-400/80">
                    {selected.model ?? 'default'}
                  </span>
                </div>
              </div>
              <div className="flex gap-2 items-center shrink-0 flex-wrap">
                <Link
                  href={`/sessions/${selected.id}`}
                  className="h-8 px-3.5 bg-muted text-foreground border border-border rounded-md text-xs font-medium no-underline transition-all duration-200 hover:bg-accent hover:text-foreground inline-flex items-center"
                >
                  Open Full View
                </Link>
                {selected.claudeSessionId && (
                  <Link
                    href={`/sessions/${selected.id}`}
                    className="h-8 px-3.5 bg-blue-100/50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-300/40 dark:border-blue-800/40 rounded-md text-xs font-medium no-underline transition-all duration-200 hover:bg-blue-200/70 dark:hover:bg-blue-900/70 inline-flex items-center"
                    title="Fork this session in Full View"
                  >
                    Fork
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (selected.claudeSessionId && selected.machineId) {
                      void openForkPicker();
                    } else {
                      setConvertName(selected.agentName ?? `agent-from-${selected.id.slice(0, 8)}`);
                      setShowConvertDialog(true);
                    }
                  }}
                  disabled={forkPickerLoading}
                  className="h-8 px-3.5 bg-emerald-900/40 text-emerald-300 border border-emerald-800/40 rounded-md text-xs font-medium cursor-pointer transition-all duration-200 hover:bg-emerald-900/70 disabled:opacity-50"
                >
                  {forkPickerLoading ? 'Loading...' : 'Create Agent'}
                </button>
                {(selected.status === 'active' || selected.status === 'starting') && (
                  <ConfirmButton
                    label="End Session"
                    confirmLabel="End Session?"
                    onConfirm={() => void handleStop()}
                    className="h-8 px-3.5 bg-red-100/60 dark:bg-red-900/60 text-red-700 dark:text-red-300 border border-red-300/40 dark:border-red-800/40 rounded-md text-xs font-medium cursor-pointer transition-all duration-200 hover:bg-red-200 dark:hover:bg-red-900"
                    confirmClassName="h-8 px-3.5 bg-red-700 text-white rounded-md text-xs font-medium cursor-pointer animate-pulse"
                  />
                )}
              </div>
            </div>

            {/* Session metadata */}
            <div className="px-5 py-4 border-b border-border text-[13px]">
              <div className="bg-card rounded-lg p-4 shadow-sm grid grid-cols-1 sm:grid-cols-2 gap-3">
                <DetailRow label="ID" value={selected.id} mono />
                <DetailRow label="Status" value={selected.status} />
                <DetailRow
                  label="Agent"
                  value={selected.agentName ? selected.agentName : selected.agentId.slice(0, 8)}
                  mono
                />
                <DetailRow label="Machine" value={selected.machineId} mono />
                <DetailRow label="Project" value={selected.projectPath ?? '-'} mono />
                <DetailRow label="Claude Session" value={selected.claudeSessionId ?? '-'} mono />
                <DetailRow label="PID" value={selected.pid ? String(selected.pid) : '-'} mono />
                {selected.accountId && (
                  <DetailRow
                    label="Account"
                    value={
                      accounts.data?.find((a) => a.id === selected.accountId)?.name ??
                      selected.accountId
                    }
                    mono
                  />
                )}
                <DetailRow label="Model" value={selected.model ?? '(default)'} />
                {selected.metadata?.forkedFrom && (
                  <DetailRow label="Forked From" value={selected.metadata.forkedFrom} mono />
                )}
                <DetailRow label="Started" value={formatDateTime(selected.startedAt)} />
                {selected.endedAt && (
                  <DetailRow label="Ended" value={formatDateTime(selected.endedAt)} />
                )}
                <DetailRow
                  label="Duration"
                  value={formatDuration(selected.startedAt, selected.endedAt)}
                />
              </div>

              {/* Git status */}
              {selected.projectPath && selected.machineId && (
                <div className="mt-2.5 col-span-full">
                  <GitStatusBadge
                    machineId={selected.machineId}
                    projectPath={selected.projectPath}
                  />
                </div>
              )}

              {/* Error message display */}
              {selected.status === 'error' && selected.metadata && (
                <div className="mt-3 px-3 py-2.5 bg-red-100/20 dark:bg-red-900/20 border border-red-500/20 rounded-md text-red-700 dark:text-red-300 text-xs">
                  <span className="font-semibold">Error: </span>
                  {selected.metadata.errorMessage ?? 'Unknown error'}
                </div>
              )}

              {/* Starting state indicator */}
              {selected.status === 'starting' && (
                <div className="mt-3 px-3 py-2.5 bg-yellow-500/10 border border-yellow-500/15 rounded-md text-yellow-600 dark:text-yellow-400 text-xs flex items-center gap-2">
                  <span className="animate-pulse">&#x25CF;</span>
                  Session is starting... Waiting for worker to respond.
                </div>
              )}
            </div>

            {/* Convert to Agent dialog */}
            {showConvertDialog && (
              <div className="px-5 py-4 border-b border-border bg-emerald-950/15">
                <div className="text-xs font-semibold text-emerald-400 mb-3 tracking-tight">
                  Create Agent from Session
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-3">
                  <div>
                    <label className="text-[11px] text-muted-foreground block mb-1">
                      Agent Name
                    </label>
                    <input
                      type="text"
                      value={convertName}
                      onChange={(e) => setConvertName(e.target.value)}
                      className="w-full px-2.5 py-2 bg-muted text-foreground border border-border rounded-md text-xs outline-none transition-all duration-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/40"
                      placeholder="my-agent"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground block mb-1">
                      Agent Type
                    </label>
                    <select
                      value={convertType}
                      onChange={(e) => setConvertType(e.target.value)}
                      className="w-full px-2.5 py-2 bg-muted text-foreground border border-border rounded-md text-xs outline-none transition-all duration-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/40"
                    >
                      <option value="autonomous">Autonomous (long-running)</option>
                      <option value="ad-hoc">Ad-hoc (one-shot)</option>
                    </select>
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground mb-3 space-y-0.5">
                  <div>
                    Machine: <span className="text-foreground font-mono">{selected.machineId}</span>
                  </div>
                  {selected.projectPath && (
                    <div>
                      Project:{' '}
                      <span className="text-foreground font-mono">{selected.projectPath}</span>
                    </div>
                  )}
                  {selected.model && (
                    <div>
                      Model: <span className="text-foreground">{selected.model}</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleConvertToAgent}
                    disabled={createAgent.isPending}
                    className="h-8 px-3.5 bg-emerald-700 text-white rounded-md text-xs font-medium cursor-pointer transition-all duration-200 hover:bg-emerald-600 disabled:opacity-50"
                  >
                    {createAgent.isPending ? 'Creating...' : 'Create Agent'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowConvertDialog(false)}
                    className="h-8 px-3.5 bg-muted text-muted-foreground border border-border rounded-md text-xs cursor-pointer transition-all duration-200 hover:bg-accent hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Session content viewer */}
            {selected.claudeSessionId && selected.machineId && (
              <SessionContent
                sessionId={selected.claudeSessionId}
                rcSessionId={selected.id}
                machineId={selected.machineId}
                projectPath={selected.projectPath ?? undefined}
                isActive={selected.status === 'active' || selected.status === 'starting'}
                lastSentMessage={lastSentMessage}
              />
            )}

            {!selected.claudeSessionId && (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground text-[13px]">
                <span>
                  {selected.status === 'error'
                    ? 'Session failed before the CLI process started'
                    : selected.status === 'starting'
                      ? 'Waiting for CLI to initialize...'
                      : 'No conversation content available'}
                </span>
                {selected.status === 'error' && selected.metadata?.errorMessage && (
                  <span className="text-xs text-muted-foreground opacity-70">
                    {selected.metadata.errorMessage}
                  </span>
                )}
              </div>
            )}

            {/* Prompt input — only for active sessions or ended sessions that can be resumed */}
            {(selected.status === 'active' ||
              selected.status === 'ended' ||
              selected.status === 'error') && (
              <div className="px-5 py-3.5 border-t border-border bg-background/50 space-y-2">
                {selected.status !== 'active' && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">Model:</span>
                    <select
                      value={resumeModel}
                      onChange={(e) => setResumeModel(e.target.value)}
                      className="px-2 h-7 bg-muted text-foreground border border-border rounded-md text-[11px] outline-none transition-all duration-200 focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                    >
                      {MODEL_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.value ? opt.label : `Keep current (${selected.model ?? 'default'})`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex gap-2.5">
                  <input
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                    placeholder={
                      selected.status === 'active'
                        ? 'Send message...'
                        : 'Resume session with prompt...'
                    }
                    aria-label={
                      selected.status === 'active'
                        ? 'Message to send to session'
                        : 'Prompt to resume session'
                    }
                    className="flex-1 px-3.5 h-9 bg-muted text-foreground border border-border rounded-md text-[13px] outline-none transition-all duration-200 focus:ring-2 focus:ring-primary/20 focus:border-primary/40 placeholder:text-muted-foreground/50"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={sending || !prompt.trim()}
                    aria-label={selected.status === 'active' ? 'Send message' : 'Resume session'}
                    className={cn(
                      'h-9 px-5 bg-primary text-white rounded-md text-[13px] font-medium transition-all duration-200 hover:bg-primary/90',
                      sending || !prompt.trim() ? 'opacity-50' : 'opacity-100',
                    )}
                  >
                    {sending ? '...' : selected.status === 'active' ? 'Send' : 'Resume'}
                  </button>
                </div>
              </div>
            )}
          </>
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

/** Displays session duration, ticking live for active (no endedAt) sessions. */
function LiveDuration({
  startedAt,
  endedAt,
}: {
  startedAt: string;
  endedAt?: string | null;
}): React.JSX.Element {
  const [, setTick] = useState(0);
  const isActive = !endedAt;

  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(timer);
  }, [isActive]);

  return (
    <span className="text-muted-foreground" title={isActive ? 'Running' : 'Total duration'}>
      {formatDuration(startedAt, endedAt)}
    </span>
  );
}

function SessionListItem({
  session: s,
  isSelected,
  isFocused,
  onSelect,
  isChecked,
  onToggleCheck,
}: {
  session: Session;
  isSelected: boolean;
  isFocused: boolean;
  onSelect: (id: string) => void;
  isChecked: boolean;
  onToggleCheck: (id: string) => void;
}): React.JSX.Element {
  const meta = s.metadata;
  const errorMsg = meta?.errorMessage;
  const costUsd = meta?.costUsd;
  const messageCount = meta?.messageCount;

  return (
    <div
      role="option"
      id={`session-${s.id}`}
      aria-selected={isSelected}
      className={cn(
        'group flex w-full text-left border-b border-border transition-all duration-200 hover:border-border/80',
        isSelected
          ? 'bg-accent/15'
          : isFocused
            ? 'bg-accent/10 ring-1 ring-inset ring-primary/40'
            : 'bg-transparent hover:bg-accent/8',
        s.status === 'error'
          ? 'border-l-[3px] border-l-red-500'
          : s.status === 'starting'
            ? 'border-l-[3px] border-l-yellow-500'
            : s.status === 'active'
              ? 'border-l-[3px] border-l-green-500'
              : 'border-l-[3px] border-l-transparent',
      )}
    >
      {/* Checkbox */}
      <div className="flex items-start pt-4 pl-2.5 shrink-0">
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => onToggleCheck(s.id)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select session ${s.id.slice(0, 16)}`}
          className="w-3.5 h-3.5 cursor-pointer"
        />
      </div>
      {/* Session card content */}
      <button
        type="button"
        onClick={() => onSelect(s.id)}
        className="flex-1 text-left px-2.5 pr-4 py-3.5 bg-transparent border-0 cursor-pointer min-w-0"
      >
        <div className="flex justify-between items-center mb-1.5">
          <CopyableText
            value={s.id}
            maxDisplay={16}
            className="font-mono text-xs font-medium text-foreground/90"
          />
          <span className="flex items-center gap-2">
            {s.status === 'active' && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
            )}
            {s.status === 'starting' && (
              <span className="relative flex h-2 w-2">
                <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500" />
              </span>
            )}
            <StatusBadge status={s.status} />
          </span>
        </div>
        {/* Error message for failed sessions */}
        {s.status === 'error' && errorMsg && (
          <div className="text-[11px] text-red-600 dark:text-red-400 mb-1.5 line-clamp-1">
            {errorMsg}
          </div>
        )}
        <div className="text-xs text-muted-foreground flex gap-2 items-center">
          <span className="font-medium text-foreground/70">
            {s.agentName ? s.agentName : s.agentId.slice(0, 8)}
          </span>
          <span className="text-muted-foreground/50">|</span>
          <span>{s.machineId}</span>
          <span className="text-purple-600/70 dark:text-purple-400/70 text-[11px]">
            {s.model ? s.model.replace('claude-', '').replace(/-\d{8}$/, '') : 'default'}
          </span>
        </div>
        {s.projectPath && (
          <div className="mt-1">
            <PathBadge path={s.projectPath} className="text-[11px]" />
          </div>
        )}
        <div className="text-[11px] text-muted-foreground/70 mt-1 flex gap-2.5 items-center">
          <LiveTimeAgo date={s.startedAt} />
          <LiveDuration startedAt={s.startedAt} endedAt={s.endedAt} />
          {messageCount !== undefined && <span>{messageCount} msgs</span>}
          {costUsd !== undefined && <span className="tabular-nums">${costUsd.toFixed(2)}</span>}
        </div>
      </button>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  const handleCopy = useCallback(() => {
    if (!mono || value === '-') return;
    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => toast.error('Failed to copy'));
  }, [mono, value, toast]);

  return (
    <div className="group py-0.5">
      <span className="text-muted-foreground/70 text-[10px] font-medium">{label}</span>
      <div
        className={cn(
          'text-xs break-all flex items-start gap-1 mt-0.5 text-foreground/90',
          mono && 'font-mono',
        )}
      >
        <span className="flex-1">{value}</span>
        {mono && value !== '-' && (
          <button
            type="button"
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy to clipboard'}
            className={cn(
              'shrink-0 px-1 py-px text-[10px] border-0 rounded-md cursor-pointer transition-opacity duration-150',
              copied
                ? 'text-green-500 bg-muted opacity-100'
                : 'text-muted-foreground bg-transparent opacity-0 group-hover:opacity-70 hover:!opacity-100',
            )}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline session content viewer
// ---------------------------------------------------------------------------

const CONTENT_POLL_MS = 3_000;

function SessionContent({
  sessionId,
  rcSessionId,
  machineId,
  projectPath,
  isActive,
  lastSentMessage,
}: {
  sessionId: string;
  rcSessionId: string;
  machineId: string;
  projectPath?: string;
  isActive?: boolean;
  lastSentMessage?: { text: string; ts: number } | null;
}): React.JSX.Element {
  const PAGE_SIZE = 200;
  const { addNotification } = useNotificationContext();
  const addNotificationRef = useRef(addNotification);
  addNotificationRef.current = addNotification;

  const [allMessages, setAllMessages] = useState<SessionContentMessage[]>([]);
  const [totalMessages, setTotalMessages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [viewMode, setViewMode] = useState<'messages' | 'terminal'>('messages');
  const [renderMarkdown, setRenderMarkdown] = useState(true);
  const [showTools, setShowTools] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const [showProgress, setShowProgress] = useState(isActive ?? false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState<
    { id: string; text: string; timestamp: number }[]
  >([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(0);
  // Track how many messages we've loaded from the end
  const loadedOffsetRef = useRef(0);

  // SSE streaming for active sessions
  const stream = useSessionStream({
    sessionId: rcSessionId,
    enabled: isActive ?? false,
    onEvent: useCallback(
      (event: SessionStreamEvent) => {
        // Refetch latest content on status change / loop complete
        if (event.event === 'status' || event.event === 'loop_complete') {
          void fetchLatestRef.current();
        }
        // Fire notifications for session lifecycle events
        if (event.event === 'status') {
          const status = (event.data as { status?: string }).status;
          if (status === 'ended') {
            addNotificationRef.current({
              type: 'success',
              message: `Session ${rcSessionId.slice(0, 8)} completed`,
              sessionId: rcSessionId,
            });
          } else if (status === 'error') {
            addNotificationRef.current({
              type: 'error',
              message: `Session ${rcSessionId.slice(0, 8)} encountered an error`,
              sessionId: rcSessionId,
            });
          }
        }
        if (event.event === 'approval_needed') {
          const toolName = (event.data as { toolName?: string }).toolName ?? 'unknown';
          addNotificationRef.current({
            type: 'warning',
            message: `Session ${rcSessionId.slice(0, 8)} needs approval for ${toolName}`,
            sessionId: rcSessionId,
          });
        }
      },
      [rcSessionId],
    ),
  });

  // Fetch latest messages (offset=0, replaces tail of loaded messages)
  const fetchLatest = useCallback(async () => {
    try {
      const result = await api.getSessionContent(sessionId, {
        machineId,
        projectPath,
        limit: PAGE_SIZE,
      });
      setTotalMessages(result.totalMessages);
      // If we had older messages loaded, keep them and replace the tail
      setAllMessages((prev) => {
        const olderCount = Math.max(0, prev.length - PAGE_SIZE);
        const olderMessages = prev.slice(0, olderCount);
        return [...olderMessages, ...result.messages];
      });
      loadedOffsetRef.current = 0;
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId, machineId, projectPath]);

  const fetchLatestRef = useRef(fetchLatest);
  fetchLatestRef.current = fetchLatest;

  // Fetch older messages (prepend to existing)
  // Track whether we're prepending (to suppress auto-scroll to bottom)
  const prependingRef = useRef(false);

  const fetchOlder = useCallback(async () => {
    if (loadingOlder || allMessages.length >= totalMessages) return;
    setLoadingOlder(true);
    try {
      const offset = allMessages.length;
      const result = await api.getSessionContent(sessionId, {
        machineId,
        projectPath,
        limit: PAGE_SIZE,
        offset,
      });
      setTotalMessages(result.totalMessages);
      if (result.messages.length > 0) {
        const el = scrollRef.current;
        const prevScrollHeight = el?.scrollHeight ?? 0;
        const prevScrollTop = el?.scrollTop ?? 0;
        prependingRef.current = true;
        setAllMessages((prev) => [...result.messages, ...prev]);
        // Use double-RAF to ensure React has committed the DOM
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (el) {
              el.scrollTop = prevScrollTop + (el.scrollHeight - prevScrollHeight);
            }
            prependingRef.current = false;
          });
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingOlder(false);
    }
  }, [sessionId, machineId, projectPath, allMessages.length, totalMessages, loadingOlder]);

  // Initial fetch
  useEffect(() => {
    setLoading(true);
    setAllMessages([]);
    loadedOffsetRef.current = 0;
    void fetchLatest();
  }, [fetchLatest]);

  // Auto-poll when session is active (only refresh latest)
  useEffect(() => {
    if (!isActive) return;

    const timer = setInterval(() => void fetchLatest(), CONTENT_POLL_MS);

    const handleVisibility = (): void => {
      if (!document.hidden) void fetchLatest();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isActive, fetchLatest]);

  // Auto-scroll when new messages arrive at the END (not when prepending older)
  useEffect(() => {
    if (allMessages.length > 0 && scrollRef.current && !prependingRef.current) {
      const newCount = allMessages.length;
      if (newCount > prevMsgCountRef.current && autoScroll) {
        const isInitialLoad = prevMsgCountRef.current === 0;
        // Use instant scroll on initial load so user sees the latest messages immediately
        requestAnimationFrame(() => {
          scrollRef.current?.scrollTo({
            top: scrollRef.current?.scrollHeight ?? 0,
            behavior: isInitialLoad ? 'instant' : 'smooth',
          });
        });
      }
      prevMsgCountRef.current = newCount;
    }
  }, [allMessages.length, autoScroll]);

  // Clear optimistic messages when they appear in real data or after timeout
  const prevHumanCountRef = useRef(0);
  useEffect(() => {
    if (optimisticMessages.length === 0) return;
    const humanMessages = allMessages.filter((m) => m.type === 'human');
    const newHumanCount = humanMessages.length;
    // Only check when new human messages appeared
    if (newHumanCount <= prevHumanCountRef.current) {
      prevHumanCountRef.current = newHumanCount;
      return;
    }
    prevHumanCountRef.current = newHumanCount;
    // Check the latest few human messages (new ones since last check)
    const recentHumanTexts = humanMessages.slice(-5).map((m) => (m.content ?? '').trim());
    setOptimisticMessages((prev) =>
      prev.filter((om) => !recentHumanTexts.includes(om.text.trim())),
    );
  }, [allMessages, optimisticMessages.length]);

  // Safety net: clear stale optimistic messages after 8 seconds
  // This handles cases where text matching fails (encoding, format differences)
  useEffect(() => {
    if (optimisticMessages.length === 0) return;
    const now = Date.now();
    const timer = setTimeout(() => {
      setOptimisticMessages((prev) => prev.filter((om) => now - om.timestamp < 8_000));
    }, 8_000);
    return () => clearTimeout(timer);
  }, [optimisticMessages]);

  // Scroll handler for user-scrolled-up detection + infinite scroll top
  const fetchOlderRef = useRef(fetchOlder);
  fetchOlderRef.current = fetchOlder;
  const hasMoreRef = useRef(false);
  hasMoreRef.current = allMessages.length < totalMessages;

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setUserScrolledUp(!atBottom);
    setAutoScroll(atBottom);

    // Trigger lazy load when near the top
    if (el.scrollTop < 150 && hasMoreRef.current) {
      void fetchOlderRef.current();
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    setAutoScroll(true);
    setUserScrolledUp(false);
  }, []);

  // React to parent sending a message — add optimistic entry
  const lastSentRef = useRef<number>(0);
  useEffect(() => {
    if (!lastSentMessage || lastSentMessage.ts <= lastSentRef.current) return;
    lastSentRef.current = lastSentMessage.ts;
    setOptimisticMessages((prev) => [
      ...prev,
      {
        id: `opt-${lastSentMessage.ts}`,
        text: lastSentMessage.text,
        timestamp: lastSentMessage.ts,
      },
    ]);
    // Auto-scroll when user sends
    setAutoScroll(true);
    setUserScrolledUp(false);
    setTimeout(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current?.scrollHeight ?? 0,
        behavior: 'smooth',
      });
    }, 50);
  }, [lastSentMessage]);

  const hasMore = allMessages.length < totalMessages;

  const messages = allMessages.filter((m) => {
    // Always show these types
    if (m.type === 'human' || m.type === 'assistant' || m.type === 'subagent' || m.type === 'todo')
      return true;
    // Toggle-controlled types
    if (m.type === 'tool_use' || m.type === 'tool_result') return showTools;
    if (m.type === 'thinking') return showThinking;
    if (m.type === 'progress') return showProgress;
    // Hide unknown types unless tools are shown
    return showTools;
  });

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Controls */}
      <div className="px-5 py-1.5 border-b border-border flex justify-between items-center shrink-0">
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setViewMode('messages')}
              className={cn(
                'px-3 py-0.5 text-[11px] cursor-pointer transition-all duration-200 h-7 border-0',
                viewMode === 'messages'
                  ? 'bg-primary text-white font-medium'
                  : 'bg-muted text-muted-foreground hover:bg-accent',
              )}
            >
              Messages
            </button>
            <button
              type="button"
              onClick={() => setViewMode('terminal')}
              className={cn(
                'px-3 py-0.5 text-[11px] cursor-pointer transition-all duration-200 h-7 border-0 border-l border-border',
                viewMode === 'terminal'
                  ? 'bg-primary text-white font-medium'
                  : 'bg-muted text-muted-foreground hover:bg-accent',
              )}
            >
              Terminal
            </button>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {viewMode === 'messages' && allMessages.length > 0
              ? `${messages.length}${hasMore ? ` / ${totalMessages}` : ''} messages`
              : ''}
            {isActive && (
              <span
                className={cn(
                  'animate-pulse',
                  stream.connected ? 'text-green-500' : 'text-yellow-500',
                )}
                title={stream.connected ? 'SSE streaming live' : 'Polling every 3s'}
              >
                &#x25CF; {stream.connected ? 'Streaming' : 'Live'}
              </span>
            )}
          </span>
        </div>
        <div className="flex gap-1.5">
          {viewMode === 'messages' && (
            <>
              <button
                type="button"
                onClick={() => setShowThinking(!showThinking)}
                aria-label={showThinking ? 'Hide thinking' : 'Show thinking'}
                aria-pressed={showThinking}
                className={cn(
                  'px-2.5 py-0.5 rounded-md border text-[11px] cursor-pointer transition-all duration-200 h-7',
                  showThinking
                    ? 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/25 font-medium'
                    : 'bg-muted text-muted-foreground border-border hover:bg-accent',
                )}
              >
                Thinking
              </button>
              <button
                type="button"
                onClick={() => setShowTools(!showTools)}
                aria-label={showTools ? 'Hide tool messages' : 'Show tool messages'}
                aria-pressed={showTools}
                className={cn(
                  'px-2.5 py-0.5 rounded-md border text-[11px] cursor-pointer transition-all duration-200 h-7',
                  showTools
                    ? 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/25 font-medium'
                    : 'bg-muted text-muted-foreground border-border hover:bg-accent',
                )}
              >
                Tools
              </button>
              <button
                type="button"
                onClick={() => setShowProgress(!showProgress)}
                aria-label={showProgress ? 'Hide progress' : 'Show progress'}
                aria-pressed={showProgress}
                className={cn(
                  'px-2.5 py-0.5 rounded-md border text-[11px] cursor-pointer transition-all duration-200 h-7',
                  showProgress
                    ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/25 font-medium'
                    : 'bg-muted text-muted-foreground border-border hover:bg-accent',
                )}
              >
                Progress
              </button>
              <button
                type="button"
                onClick={() => setRenderMarkdown(!renderMarkdown)}
                aria-label={renderMarkdown ? 'Show raw text' : 'Render markdown'}
                aria-pressed={renderMarkdown}
                className={cn(
                  'px-2.5 py-0.5 rounded-md border text-[11px] cursor-pointer transition-all duration-200 h-7',
                  renderMarkdown
                    ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/25 font-medium'
                    : 'bg-muted text-muted-foreground border-border hover:bg-accent',
                )}
              >
                Markdown
              </button>
              <button
                type="button"
                onClick={() => void fetchLatest()}
                aria-label="Refresh conversation"
                className="px-2.5 py-0.5 bg-muted text-muted-foreground border border-border rounded-md text-[11px] cursor-pointer transition-all duration-200 h-7 hover:bg-accent hover:text-foreground"
              >
                Refresh
              </button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      {viewMode === 'terminal' ? (
        <TerminalView rawOutput={stream.rawOutput} isActive={isActive} />
      ) : (
        <div className="relative flex-1 min-h-0">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="absolute inset-0 overflow-auto px-5 py-2"
          >
            {loading && (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={`msg-sk-${String(i)}`}
                    className={cn('rounded-lg p-3', i % 2 === 0 ? 'ml-0 mr-8' : 'ml-8 mr-0')}
                  >
                    <Skeleton className="h-3 w-16 mb-2" />
                    <Skeleton className="h-3 w-full mb-1" />
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                ))}
              </div>
            )}
            {error && <ErrorBanner message={error} onRetry={() => void fetchLatest()} />}
            {allMessages.length > 0 && messages.length === 0 && !loading && (
              <div className="p-5 text-center text-muted-foreground text-xs">
                No messages match current filters
              </div>
            )}
            {allMessages.length === 0 && !loading && !error && (
              <div className="p-5 text-center text-muted-foreground text-xs">No messages yet</div>
            )}
            {/* Load older messages button */}
            {hasMore && !loading && (
              <div className="py-2 text-center">
                <button
                  type="button"
                  onClick={() => void fetchOlder()}
                  disabled={loadingOlder}
                  className="text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 hover:underline cursor-pointer disabled:opacity-50 bg-transparent border-none"
                >
                  {loadingOlder
                    ? 'Loading...'
                    : `Load older messages (${totalMessages - allMessages.length} more)`}
                </button>
              </div>
            )}
            {messages.map((msg, i) => {
              switch (msg.type) {
                case 'thinking':
                  return (
                    <ThinkingBlock
                      key={`${msg.type}-${String(i)}`}
                      content={msg.content}
                      timestamp={msg.timestamp}
                    />
                  );
                case 'progress':
                  return (
                    <ProgressIndicator
                      key={`${msg.type}-${String(i)}`}
                      content={msg.content}
                      toolName={msg.toolName}
                      timestamp={msg.timestamp}
                    />
                  );
                case 'subagent':
                  return (
                    <SubagentBlock
                      key={`${msg.type}-${String(i)}`}
                      content={msg.content}
                      toolName={msg.toolName}
                      subagentId={(msg as Record<string, unknown>).subagentId as string | undefined}
                      timestamp={msg.timestamp}
                    />
                  );
                case 'todo':
                  return (
                    <TodoBlock
                      key={`${msg.type}-${String(i)}`}
                      content={msg.content}
                      timestamp={msg.timestamp}
                    />
                  );
                default:
                  return (
                    <InlineMessage
                      key={`${msg.type}-${String(i)}`}
                      message={msg}
                      renderMarkdown={renderMarkdown}
                    />
                  );
              }
            })}

            {/* Optimistic messages */}
            {optimisticMessages.map((om) => (
              <div
                key={om.id}
                className="mb-1.5 px-2.5 py-1.5 rounded-md border-l-2 border-blue-500/50 bg-blue-500/10"
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                    You
                  </span>
                  <span className="text-[9px] text-blue-600/70 dark:text-blue-400/70 animate-pulse">
                    sending...
                  </span>
                </div>
                <div className="text-xs text-foreground whitespace-pre-wrap break-words">
                  {om.text}
                </div>
              </div>
            ))}

            {/* Live streaming output */}
            {stream.connected && stream.streamOutput.length > 0 && (
              <div className="rounded-md border border-green-500/20 bg-green-50/20 dark:bg-green-950/20 px-2.5 py-1.5 mb-1.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[9px] font-semibold text-green-500">Streaming</span>
                </div>
                <AnsiText className="text-[11px] text-foreground/90 whitespace-pre-wrap font-mono leading-relaxed max-h-[200px] overflow-auto m-0">
                  {stream.streamOutput.join('')}
                </AnsiText>
              </div>
            )}
          </div>

          {/* Floating scroll-to-bottom button */}
          {userScrolledUp && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-3 right-5 px-4 py-1.5 bg-primary text-white text-[11px] font-medium rounded-full shadow-lg cursor-pointer opacity-90 hover:opacity-100 transition-all duration-200 z-10 hover:shadow-xl"
            >
              Scroll to bottom
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const TRUNCATE_THRESHOLD = 800;

function InlineMessage({
  message,
  renderMarkdown,
}: {
  message: SessionContentMessage;
  renderMarkdown?: boolean;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const msgStyle = getMessageStyle(message.type);
  const isTool = message.type === 'tool_use' || message.type === 'tool_result';
  const isRenderable = renderMarkdown && (message.type === 'assistant' || message.type === 'human');
  const content = message.content ?? '';
  const isLong = content.length > TRUNCATE_THRESHOLD;
  const displayContent =
    isLong && !expanded ? `${content.slice(0, TRUNCATE_THRESHOLD)}...` : content;

  return (
    <div className={cn('mb-2 px-3 py-2 rounded-md border-l-2', msgStyle.bubbleClass)}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className={cn('text-[10px] font-semibold', msgStyle.textClass)}>
          {msgStyle.label}
        </span>
        {message.toolName && (
          <span className="text-[10px] font-mono text-muted-foreground">{message.toolName}</span>
        )}
        {message.timestamp && (
          <span className="text-[9px] text-muted-foreground ml-auto">
            {formatTime(message.timestamp)}
          </span>
        )}
      </div>
      <div
        className={cn(
          'leading-6 text-foreground break-words',
          isTool ? 'text-[11px] font-mono whitespace-pre-wrap' : 'text-xs',
          isRenderable ? '' : 'whitespace-pre-wrap',
          !expanded && (isTool ? 'max-h-[150px] overflow-auto' : 'max-h-[400px] overflow-auto'),
          expanded && 'max-h-none overflow-visible',
        )}
      >
        {isRenderable ? (
          <MarkdownContent className="text-xs leading-6">{displayContent}</MarkdownContent>
        ) : (
          <AnsiSpan>{displayContent}</AnsiSpan>
        )}
      </div>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 px-2 py-0.5 text-[10px] text-primary bg-transparent border-0 cursor-pointer font-medium"
        >
          {expanded ? 'Show less' : `Show all (${Math.round(content.length / 1000)}k chars)`}
        </button>
      )}
    </div>
  );
}
