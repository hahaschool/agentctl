'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { AnsiSpan, AnsiText } from '../components/AnsiText';
import { ConfirmButton } from '../components/ConfirmButton';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { FetchingBar } from '../components/FetchingBar';
import { LastUpdated } from '../components/LastUpdated';
import { LiveTimeAgo } from '../components/LiveTimeAgo';
import { PathBadge } from '../components/PathBadge';
import { RefreshButton } from '../components/RefreshButton';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { useHotkeys } from '../hooks/use-hotkeys';
import type { SessionStreamEvent } from '../hooks/use-session-stream';
import { useSessionStream } from '../hooks/use-session-stream';
import type {
  ApiAccount,
  Machine,
  Session,
  SessionContentMessage,
  SessionContentResponse,
} from '../lib/api';
import { api } from '../lib/api';
import { formatDateTime, formatDuration, formatTime, shortenPath } from '../lib/format-utils';
import { getMessageStyle } from '../lib/message-styles';
import { accountsQuery, queryKeys, sessionsQuery } from '../lib/queries';

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
  if (session.projectPath?.toLowerCase().includes(q)) return true;
  if (session.machineId.toLowerCase().includes(q)) return true;
  if (session.model?.toLowerCase().includes(q)) return true;
  return false;
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
    setAccumulatedSessions((prev) =>
      offset === 0 ? newSessions : [...prev, ...newSessions],
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.data]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [sending, setSending] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [hideEmpty, setHideEmpty] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Reset pagination when filter or search changes so we don't stay on a stale page.
  useEffect(() => {
    setOffset(0);
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
        Escape: () => {
          if (showCreateForm) setShowCreateForm(false);
          else setSelectedId(null);
        },
      }),
      [resetAndInvalidateSessions, showCreateForm],
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
          const first = list[0];
          if (first) setFormMachineId((prev) => prev || first.id);
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
      const results = await Promise.allSettled(
        cleanupSessions.map((s) => api.deleteSession(s.id)),
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

  const selected = sessionList.find((s) => s.id === selectedId) ?? null;

  const handleSend = useCallback(async () => {
    if (!selected || !prompt.trim()) return;
    setSending(true);
    try {
      if (selected.status === 'active') {
        await api.sendMessage(selected.id, prompt.trim());
      } else {
        await api.resumeSession(selected.id, prompt.trim());
      }
      setPrompt('');
      resetAndInvalidateSessions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }, [selected, prompt, resetAndInvalidateSessions, toast]);

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

  // Keyboard navigation: arrow up/down to move through sessions, Escape to deselect
  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedId(null);
        return;
      }
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const list = filteredSessions;
      if (list.length === 0) return;
      const idx = selectedId ? list.findIndex((s) => s.id === selectedId) : -1;
      let next: number;
      if (e.key === 'ArrowDown') {
        next = idx < list.length - 1 ? idx + 1 : 0;
      } else {
        next = idx > 0 ? idx - 1 : list.length - 1;
      }
      const nextSession = list[next];
      if (nextSession) setSelectedId(nextSession.id);
    },
    [filteredSessions, selectedId],
  );

  const isFormDisabled =
    formSubmitting || !formMachineId || !formProjectPath.trim() || !formPrompt.trim();

  return (
    <div className="relative flex h-full">
      <FetchingBar isFetching={sessions.isFetching && !sessions.isLoading} />
      {/* Session list panel */}
      <div
        className={cn(
          'border-r border-border flex flex-col',
          // Mobile: full width, hidden when a session is selected
          selected ? 'hidden md:flex' : 'flex w-full',
          // Desktop: fixed sidebar width
          'md:w-[340px] md:min-w-[340px]',
        )}
      >
        <div className="px-4 pt-4 pb-3 border-b border-border space-y-2">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-semibold">
              Sessions
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                ({filteredSessions.length})
              </span>
            </h2>
            <div className="flex items-center gap-1 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  setShowCreateForm((prev) => !prev);
                  setFormError(null);
                }}
                aria-label={showCreateForm ? 'Cancel new session form' : 'Create new session'}
                aria-expanded={showCreateForm}
                className={cn(
                  'px-2 py-1.5 border border-border rounded-sm text-xs font-medium whitespace-nowrap',
                  showCreateForm ? 'bg-primary text-white' : 'bg-muted text-muted-foreground',
                )}
              >
                {showCreateForm ? 'Cancel' : '+ New Session'}
              </button>
              {cleanupSessions.length > 0 && (
                <ConfirmButton
                  label={`Clean Up (${cleanupSessions.length})`}
                  confirmLabel={`Delete ${cleanupSessions.length}?`}
                  onConfirm={() => void handleCleanup()}
                  className="px-2 py-1.5 border border-border rounded-sm text-xs font-medium whitespace-nowrap bg-muted text-muted-foreground"
                  confirmClassName="px-2 py-1.5 border border-destructive rounded-sm text-xs font-medium whitespace-nowrap bg-destructive text-destructive-foreground"
                />
              )}
              <RefreshButton
                onClick={() => resetAndInvalidateSessions()}
                isFetching={sessions.isFetching && !sessions.isLoading}
                className="px-2 py-1.5 text-xs"
              />
            </div>
          </div>
          <LastUpdated dataUpdatedAt={sessions.dataUpdatedAt} />
        </div>

        {/* Search / filter input */}
        <div className="px-4 py-2 border-b border-border">
          <label
            htmlFor="session-search"
            className="absolute w-px h-px overflow-hidden [clip:rect(0,0,0,0)]"
          >
            Search sessions
          </label>
          <input
            id="session-search"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by ID, project, agent, model..."
            className="w-full px-2 py-1.5 bg-muted text-foreground border border-border rounded-sm text-xs outline-none box-border"
          />
        </div>

        {/* Status filter tabs */}
        <div className="flex border-b border-border px-2 overflow-x-auto">
          {STATUS_TABS.map((tab) => (
            <button
              type="button"
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={cn(
                'flex-1 py-2 px-1 text-[11px] bg-transparent border-0 cursor-pointer transition-colors duration-150',
                statusFilter === tab.key
                  ? 'font-semibold text-primary border-b-2 border-b-primary'
                  : 'font-normal text-muted-foreground border-b-2 border-b-transparent',
              )}
            >
              {tab.label}
              <span
                className={cn(
                  'ml-1 text-[10px] opacity-70',
                  statusFilter === tab.key ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {statusCounts[tab.key]}
              </span>
            </button>
          ))}
        </div>

        {/* Sort / Group / Filter controls */}
        <div className="px-3 py-1.5 border-b border-border flex items-center gap-2 flex-wrap">
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as SortOrder)}
            aria-label="Sort order"
            className="px-2 py-1 bg-muted text-muted-foreground border border-border rounded-sm text-[11px] min-h-[32px]"
          >
            <option value="newest">{'\u2193'} Newest first</option>
            <option value="oldest">{'\u2191'} Oldest first</option>
            <option value="status">{'\u2191'} By status</option>
          </select>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            aria-label="Group by"
            className="px-2 py-1 bg-muted text-muted-foreground border border-border rounded-sm text-[11px] min-h-[32px]"
          >
            <option value="none">No grouping</option>
            <option value="project">Group by Project</option>
            <option value="machine">Group by Machine</option>
          </select>
          <label
            htmlFor="sessions-hide-empty"
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer ml-auto py-1"
          >
            <input
              id="sessions-hide-empty"
              type="checkbox"
              checked={hideEmpty}
              onChange={(e) => setHideEmpty(e.target.checked)}
              className="w-3.5 h-3.5 cursor-pointer"
            />
            Hide empty
          </label>
        </div>

        {/* Inline "New Session" creation form */}
        {showCreateForm && (
          <div className="px-4 py-3.5 border-b border-border bg-card">
            <div className="text-[13px] font-semibold mb-2.5">Create New Session</div>

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
              className="w-full px-2 py-1.5 bg-muted text-foreground border border-border rounded-sm text-xs mb-2.5 outline-none"
            >
              {machinesLoading && <option value="">Loading machines...</option>}
              {!machinesLoading && machines.length === 0 && (
                <option value="">No machines available</option>
              )}
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.hostname} ({m.status})
                </option>
              ))}
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
              className="w-full px-2 py-1.5 bg-muted text-foreground border border-border rounded-sm font-mono text-xs mb-2.5 outline-none box-border"
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
              className="w-full px-2 py-1.5 bg-muted text-foreground border border-border rounded-sm text-xs mb-2.5 outline-none resize-y font-[inherit] box-border"
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
              className="w-full px-2 py-1.5 bg-muted text-foreground border border-border rounded-sm text-xs mb-2.5 outline-none"
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
              className="w-full px-2 py-1.5 bg-muted text-foreground border border-border rounded-sm text-xs mb-3 outline-none"
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
                'w-full py-[7px] px-3.5 bg-primary text-white rounded-sm text-xs font-medium',
                isFormDisabled ? 'opacity-50 cursor-not-allowed' : 'opacity-100 cursor-pointer',
              )}
            >
              {formSubmitting ? 'Creating...' : 'Create Session'}
            </button>
          </div>
        )}

        <div
          className="flex-1 overflow-auto"
          role="listbox"
          tabIndex={0}
          onKeyDown={handleListKeyDown}
          aria-label="Session list"
          aria-activedescendant={selectedId ? `session-${selectedId}` : undefined}
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
                icon={'▶'}
                title="No sessions yet"
                description="Create a new session using the form above to get started."
              />
            ) : (
              <EmptyState
                icon={'\u2315'}
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
                      onSelect={setSelectedId}
                    />
                  ))}
              </div>
            ))
          ) : (
            filteredSessions.map((s) => (
              <SessionListItem
                key={s.id}
                session={s}
                isSelected={selectedId === s.id}
                onSelect={setSelectedId}
              />
            ))
          )}
          {hasMore && !sessions.isLoading && (
            <div className="px-4 py-3 border-t border-border">
              <button
                type="button"
                onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
                disabled={sessions.isFetching}
                className="w-full px-3 py-2 bg-muted text-muted-foreground border border-border rounded-sm text-xs font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sessions.isFetching
                  ? 'Loading...'
                  : `Show more (${totalCount - sessionList.length} remaining)`}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Session detail panel */}
      <div
        className={cn(
          'flex-1 flex flex-col',
          // Mobile: hidden when no session selected, full width when selected
          selected ? 'flex' : 'hidden md:flex',
        )}
      >
        {selected ? (
          <>
            {/* Header */}
            <div className="px-5 py-4 border-b border-border flex justify-between items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {/* Mobile back button */}
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="md:hidden text-muted-foreground text-sm shrink-0"
                    aria-label="Back to session list"
                  >
                    {'\u2190'}
                  </button>
                  <div className="text-[15px] font-semibold truncate" title={selected.id}>
                    Session: {selected.id.slice(0, 20)}...
                  </div>
                </div>
                <div className="text-xs text-muted-foreground flex gap-3 flex-wrap mt-1">
                  <span>Agent: {selected.agentId}</span>
                  <span>Machine: {selected.machineId}</span>
                  <StatusBadge status={selected.status} />
                </div>
              </div>
              <div className="flex gap-2 items-center shrink-0">
                <Link
                  href={`/sessions/${selected.id}`}
                  className="px-3.5 py-1.5 bg-muted text-foreground border border-border rounded-sm text-xs font-medium no-underline hover:bg-accent/10"
                >
                  Open Full View
                </Link>
                {selected.claudeSessionId && (
                  <Link
                    href={`/sessions/${selected.id}`}
                    className="px-3.5 py-1.5 bg-blue-900/50 text-blue-300 border border-blue-800/50 rounded-sm text-xs font-medium no-underline hover:bg-blue-900"
                    title="Fork this session in Full View"
                  >
                    Fork
                  </Link>
                )}
                {(selected.status === 'active' || selected.status === 'starting') && (
                  <ConfirmButton
                    label="End Session"
                    confirmLabel="End Session?"
                    onConfirm={() => void handleStop()}
                    className="px-3.5 py-1.5 bg-red-900 text-red-300 rounded-sm text-xs font-medium cursor-pointer"
                    confirmClassName="px-3.5 py-1.5 bg-red-700 text-white rounded-sm text-xs font-medium cursor-pointer animate-pulse"
                  />
                )}
              </div>
            </div>

            {/* Session metadata */}
            <div className="px-5 py-4 border-b border-border text-[13px]">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <DetailRow label="ID" value={selected.id} mono />
                <DetailRow label="Status" value={selected.status} />
                <DetailRow label="Agent" value={selected.agentId} mono />
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
                {selected.model && <DetailRow label="Model" value={selected.model} />}
                {typeof selected.metadata?.forkedFrom === 'string' && (
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

              {/* Error message display */}
              {selected.status === 'error' && selected.metadata && (
                <div className="mt-2.5 px-2.5 py-2 bg-red-900/30 border border-red-500/30 rounded-sm text-red-300 text-xs">
                  <span className="font-semibold">Error: </span>
                  {(selected.metadata as Record<string, unknown>).errorMessage
                    ? String((selected.metadata as Record<string, unknown>).errorMessage)
                    : 'Unknown error'}
                </div>
              )}

              {/* Starting state indicator */}
              {selected.status === 'starting' && (
                <div className="mt-2.5 px-2.5 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-sm text-yellow-400 text-xs flex items-center gap-2">
                  <span className="animate-pulse">&#x25CF;</span>
                  Session is starting... Waiting for worker to respond.
                </div>
              )}
            </div>

            {/* Session content viewer */}
            {selected.claudeSessionId && selected.machineId && (
              <SessionContent
                sessionId={selected.claudeSessionId}
                rcSessionId={selected.id}
                machineId={selected.machineId}
                projectPath={selected.projectPath ?? undefined}
                isActive={selected.status === 'active' || selected.status === 'starting'}
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
                {selected.status === 'error' &&
                  typeof selected.metadata?.errorMessage === 'string' && (
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
              <div className="px-5 py-3 border-t border-border flex gap-2">
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
                  className="flex-1 px-3 py-2 bg-muted text-foreground border border-border rounded-sm text-[13px] outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={sending || !prompt.trim()}
                  aria-label={selected.status === 'active' ? 'Send message' : 'Resume session'}
                  className={cn(
                    'px-[18px] py-2 bg-primary text-white rounded-sm text-[13px] font-medium',
                    sending || !prompt.trim() ? 'opacity-50' : 'opacity-100',
                  )}
                >
                  {sending ? '...' : selected.status === 'active' ? 'Send' : 'Resume'}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Select a session to view details
          </div>
        )}
      </div>
    </div>
  );
}

function SessionListItem({
  session: s,
  isSelected,
  onSelect,
}: {
  session: Session;
  isSelected: boolean;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="option"
      id={`session-${s.id}`}
      aria-selected={isSelected}
      onClick={() => onSelect(s.id)}
      className={cn(
        'block w-full text-left px-4 py-3 border-b border-border transition-colors duration-100',
        isSelected ? 'bg-accent/10' : 'bg-transparent hover:bg-accent/10',
        s.status === 'error'
          ? 'border-l-[3px] border-l-red-500'
          : s.status === 'starting'
            ? 'border-l-[3px] border-l-yellow-500'
            : s.status === 'active'
              ? 'border-l-[3px] border-l-green-500'
              : 'border-l-[3px] border-l-transparent',
      )}
    >
      <div className="flex justify-between items-center mb-1">
        <span className="font-mono text-xs font-medium">{s.id.slice(0, 16)}...</span>
        <StatusBadge status={s.status} />
      </div>
      <div className="text-xs text-muted-foreground flex gap-2">
        <span>{s.agentId}</span>
        <span>{s.machineId}</span>
      </div>
      {s.projectPath && (
        <div className="mt-0.5">
          <PathBadge path={s.projectPath} className="text-[11px]" />
        </div>
      )}
      <div className="text-[11px] text-muted-foreground mt-0.5 flex gap-2">
        <LiveTimeAgo date={s.startedAt} />
        <span className="text-muted-foreground">{formatDuration(s.startedAt, s.endedAt)}</span>
      </div>
    </button>
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
    <div className="group">
      <span className="text-muted-foreground text-[11px]">{label}</span>
      <div className={cn('text-xs break-all flex items-start gap-1', mono && 'font-mono')}>
        <span className="flex-1">{value}</span>
        {mono && value !== '-' && (
          <button
            type="button"
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy to clipboard'}
            className={cn(
              'shrink-0 px-1 py-px text-[10px] border-0 rounded-sm cursor-pointer transition-opacity duration-150',
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
}: {
  sessionId: string;
  rcSessionId: string;
  machineId: string;
  projectPath?: string;
  isActive?: boolean;
}): React.JSX.Element {
  const [data, setData] = useState<SessionContentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTools, setShowTools] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(0);

  // SSE streaming for active sessions
  const stream = useSessionStream({
    sessionId: rcSessionId,
    enabled: isActive ?? false,
    onEvent: useCallback((event: SessionStreamEvent) => {
      // Refetch full content on status change / loop complete
      if (event.event === 'status' || event.event === 'loop_complete') {
        void fetchContentRef.current();
      }
    }, []),
  });

  const fetchContent = useCallback(async () => {
    try {
      const result = await api.getSessionContent(sessionId, {
        machineId,
        projectPath,
        limit: 100,
      });
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId, machineId, projectPath]);

  const fetchContentRef = useRef(fetchContent);
  fetchContentRef.current = fetchContent;

  // Initial fetch
  useEffect(() => {
    setLoading(true);
    void fetchContent();
  }, [fetchContent]);

  // Auto-poll when session is active
  useEffect(() => {
    if (!isActive) return;

    const timer = setInterval(() => void fetchContent(), CONTENT_POLL_MS);

    const handleVisibility = (): void => {
      if (!document.hidden) void fetchContent();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isActive, fetchContent]);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    if (data && scrollRef.current) {
      const newCount = data.messages.length;
      if (newCount > prevMsgCountRef.current) {
        scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      }
      prevMsgCountRef.current = newCount;
    }
  }, [data]);

  const messages = data
    ? showTools
      ? data.messages
      : data.messages.filter((m) => m.type === 'human' || m.type === 'assistant')
    : [];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Controls */}
      <div className="px-5 py-1.5 border-b border-border flex justify-between items-center shrink-0">
        <span className="text-[11px] text-muted-foreground">
          {data ? `${messages.length} messages${showTools ? '' : ' (conversations only)'}` : ''}
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
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setShowTools(!showTools)}
            aria-label={showTools ? 'Hide tool messages' : 'Show tool messages'}
            aria-pressed={showTools}
            className={cn(
              'px-2.5 py-1 border border-border rounded-sm text-[11px] cursor-pointer min-h-[28px]',
              showTools ? 'bg-primary text-white' : 'bg-muted text-muted-foreground',
            )}
          >
            {showTools ? 'Hide Tools' : 'Show Tools'}
          </button>
          <button
            type="button"
            onClick={() => void fetchContent()}
            aria-label="Refresh conversation"
            className="px-2.5 py-1 bg-muted text-muted-foreground border border-border rounded-sm text-[11px] cursor-pointer min-h-[28px]"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-5 py-2 scroll-smooth">
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
        {error && <ErrorBanner message={error} onRetry={() => void fetchContent()} />}
        {data && messages.length === 0 && !loading && (
          <div className="p-5 text-center text-muted-foreground text-xs">No messages yet</div>
        )}
        {messages.map((msg, i) => (
          <InlineMessage key={`${msg.type}-${String(i)}`} message={msg} />
        ))}

        {/* Live streaming output */}
        {stream.connected && stream.streamOutput.length > 0 && (
          <div className="rounded-sm border border-green-500/20 bg-green-950/20 px-2.5 py-1.5 mb-1.5">
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
    </div>
  );
}

const TRUNCATE_THRESHOLD = 800;

function InlineMessage({ message }: { message: SessionContentMessage }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const msgStyle = getMessageStyle(message.type);
  const isTool = message.type === 'tool_use' || message.type === 'tool_result';
  const content = message.content ?? '';
  const isLong = content.length > TRUNCATE_THRESHOLD;
  const displayContent =
    isLong && !expanded ? `${content.slice(0, TRUNCATE_THRESHOLD)}...` : content;

  return (
    <div className={cn('mb-1.5 px-2.5 py-1.5 rounded-sm border-l-2', msgStyle.bubbleClass)}>
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
          'leading-6 text-foreground whitespace-pre-wrap break-words',
          isTool ? 'text-[11px] font-mono' : 'text-xs',
          !expanded && (isTool ? 'max-h-[150px] overflow-auto' : 'max-h-[400px] overflow-auto'),
          expanded && 'max-h-none overflow-visible',
        )}
      >
        <AnsiSpan>{displayContent}</AnsiSpan>
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
