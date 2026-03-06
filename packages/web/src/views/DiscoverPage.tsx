'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { CopyableText } from '../components/CopyableText';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { FetchingBar } from '../components/FetchingBar';
import { HighlightText } from '../components/HighlightText';
import { LastUpdated } from '../components/LastUpdated';
import { LiveTimeAgo } from '../components/LiveTimeAgo';
import { PathBadge } from '../components/PathBadge';
import { RefreshButton } from '../components/RefreshButton';
import { SessionPreview } from '../components/SessionPreview';
import { SimpleTooltip } from '../components/SimpleTooltip';
import { useToast } from '../components/Toast';
import { useHotkeys } from '../hooks/use-hotkeys';
import type { DiscoveredSession } from '../lib/api';
import { api } from '../lib/api';
import { formatNumber, recencyColorClass } from '../lib/format-utils';
import { discoverQuery, queryKeys, sessionsQuery } from '../lib/queries';

type MinMessages = 0 | 1 | 5 | 10 | 50;
type SortOption = 'recent' | 'messages' | 'project';
type GroupMode = 'project' | 'machine' | 'flat';

type SessionGroup = {
  projectPath: string;
  projectName: string;
  sessions: DiscoveredSession[];
  totalMessages: number;
  latestActivity: string;
};

const MIN_MESSAGE_OPTIONS: { label: string; value: MinMessages }[] = [
  { label: 'All', value: 0 },
  { label: '1+', value: 1 },
  { label: '5+', value: 5 },
  { label: '10+', value: 10 },
  { label: '50+', value: 50 },
];

const SORT_OPTIONS: { label: string; value: SortOption }[] = [
  { label: '\u2193 Recent activity', value: 'recent' },
  { label: '\u2193 Most messages', value: 'messages' },
  { label: '\u2191 Project name', value: 'project' },
];

/** Compute a human-readable recency label directly from a date string. */
function recencyTitle(dateStr: string): string {
  if (!dateStr) return 'Older';
  const diff = Date.now() - new Date(dateStr).getTime();
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;
  if (diff < oneHour) return 'Active in last hour';
  if (diff < oneDay) return 'Active today';
  return 'Older';
}

export function DiscoverPage(): React.JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery(discoverQuery());
  const { data, error, refetch } = query;
  const isLoading = query.isLoading;

  const [resuming, setResuming] = useState<string | null>(null);
  const [resumePrompt, setResumePrompt] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  // New session form state
  const [showNewSession, setShowNewSession] = useState(false);
  const [newProjectPath, setNewProjectPath] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [newMachineId, setNewMachineId] = useState('');
  const [newSessionCreating, setNewSessionCreating] = useState(false);

  // Existing sessions query — used to mark already-imported sessions
  const existingSessionsQuery = useQuery(sessionsQuery({ limit: 1000 }));
  const importedSessionIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of existingSessionsQuery.data?.sessions ?? []) {
      if (s.claudeSessionId) set.add(s.claudeSessionId);
    }
    return set;
  }, [existingSessionsQuery.data]);

  // Selection state for bulk import
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkImporting, setBulkImporting] = useState(false);

  // Single-session import state
  const [importingSessionId, setImportingSessionId] = useState<string | null>(null);

  const handleSingleImport = useCallback(
    async (session: DiscoveredSession) => {
      setImportingSessionId(session.sessionId);
      try {
        await api.createSession({
          agentId: 'adhoc',
          machineId: session.machineId,
          projectPath: session.projectPath,
          prompt: 'Imported from discover — continue previous work.',
          resumeSessionId: session.sessionId,
        });
        toast.success(`Imported session from ${session.hostname}`);
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.discover });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setImportingSessionId(null);
      }
    },
    [queryClient, toast],
  );

  // Filter state
  const [search, setSearch] = useState('');
  const [minMessages, setMinMessages] = useState<MinMessages>(1);
  const [machineFilter, setMachineFilter] = useState<string>('all');
  const [sort, setSort] = useState<SortOption>('recent');
  const [groupMode, setGroupMode] = useState<GroupMode>('project');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const searchRef = useRef<HTMLInputElement>(null);

  // Global keyboard shortcuts
  useHotkeys(
    useMemo(
      () => ({
        slash: (e) => {
          e.preventDefault();
          searchRef.current?.focus();
        },
        r: () => void refetch(),
        Escape: () => {
          if (resuming) setResuming(null);
          else if (showNewSession) setShowNewSession(false);
          else if (selectedSessionId) setSelectedSessionId(null);
        },
      }),
      [refetch, resuming, showNewSession, selectedSessionId],
    ),
  );

  const allSessions = data?.sessions ?? [];

  // Unique hostnames for filter dropdown
  const hostnames = useMemo(() => {
    const set = new Set<string>();
    for (const s of allSessions) set.add(s.hostname);
    return Array.from(set).sort();
  }, [allSessions]);

  // Unique machines for new session form
  const machines = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of allSessions) map.set(s.machineId, s.hostname);
    return Array.from(map.entries()).map(([id, hostname]) => ({ id, hostname }));
  }, [allSessions]);

  // Filtered sessions
  const filtered = useMemo(() => {
    const lowerSearch = search.toLowerCase().trim();
    return allSessions.filter((s) => {
      if (s.messageCount < minMessages) return false;
      if (machineFilter !== 'all' && s.hostname !== machineFilter) return false;
      if (lowerSearch) {
        const haystack = `${s.summary} ${s.projectPath} ${s.sessionId} ${s.hostname}`.toLowerCase();
        if (!haystack.includes(lowerSearch)) return false;
      }
      return true;
    });
  }, [allSessions, minMessages, machineFilter, search]);

  // Grouped + sorted
  const groups = useMemo((): SessionGroup[] => {
    if (groupMode === 'flat') {
      // Flat list: one synthetic group containing all sessions
      const sorted = [...filtered];
      sorted.sort((a, b) => {
        if (sort === 'messages') return b.messageCount - a.messageCount;
        if (sort === 'project') return (a.summary || '').localeCompare(b.summary || '');
        return b.lastActivity.localeCompare(a.lastActivity);
      });
      let totalMessages = 0;
      let latestActivity = '';
      for (const s of sorted) {
        totalMessages += s.messageCount;
        if (!latestActivity || s.lastActivity > latestActivity) {
          latestActivity = s.lastActivity;
        }
      }
      return [
        {
          projectPath: '__flat__',
          projectName: 'All Sessions',
          sessions: sorted,
          totalMessages,
          latestActivity,
        },
      ];
    }

    const map = new Map<string, DiscoveredSession[]>();
    for (const s of filtered) {
      const key = groupMode === 'machine' ? s.hostname : s.projectPath;
      const arr = map.get(key);
      if (arr) {
        arr.push(s);
      } else {
        map.set(key, [s]);
      }
    }

    const result: SessionGroup[] = [];
    for (const [projectPath, sessions] of map) {
      const projectName =
        groupMode === 'machine' ? projectPath : projectPath.split('/').pop() || projectPath;
      let totalMessages = 0;
      let latestActivity = '';
      for (const s of sessions) {
        totalMessages += s.messageCount;
        if (!latestActivity || s.lastActivity > latestActivity) {
          latestActivity = s.lastActivity;
        }
      }
      result.push({
        projectPath,
        projectName,
        sessions,
        totalMessages,
        latestActivity,
      });
    }

    // Sort sessions within each group by last activity descending
    for (const g of result) {
      g.sessions.sort((a, b) => {
        if (sort === 'messages') return b.messageCount - a.messageCount;
        if (sort === 'project') return (a.summary || '').localeCompare(b.summary || '');
        return b.lastActivity.localeCompare(a.lastActivity);
      });
    }

    // Sort groups
    result.sort((a, b) => {
      if (sort === 'messages') return b.totalMessages - a.totalMessages;
      if (sort === 'project') return a.projectName.localeCompare(b.projectName);
      return b.latestActivity.localeCompare(a.latestActivity);
    });

    return result;
  }, [filtered, sort, groupMode]);

  // Unique project and machine counts
  const projectCount = new Set(filtered.map((s) => s.projectPath)).size;
  const machineCount = new Set(filtered.map((s) => s.hostname)).size;

  // Find the full selected session for preview
  const selectedSession = selectedSessionId
    ? (filtered.find((s) => s.sessionId === selectedSessionId) ?? null)
    : null;

  const allExpanded = collapsedGroups.size === 0;

  const toggleGroup = useCallback((path: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (allExpanded) {
      setCollapsedGroups(new Set(groups.map((g) => g.projectPath)));
    } else {
      setCollapsedGroups(new Set());
    }
  }, [allExpanded, groups]);

  // Clear selection when filters change
  useEffect(() => {
    setSelectedIds(new Set());
  }, [search, minMessages, machineFilter]);

  const toggleSelect = useCallback((sessionId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }, []);

  const selectAllFiltered = useCallback(() => {
    const notImported = filtered.filter((s) => !importedSessionIds.has(s.sessionId));
    if (selectedIds.size === notImported.length && notImported.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(notImported.map((s) => s.sessionId)));
    }
  }, [filtered, importedSessionIds, selectedIds.size]);

  const handleBulkImport = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setBulkImporting(true);
    const sessionsToImport = filtered.filter((s) => selectedIds.has(s.sessionId));
    let successCount = 0;
    let failCount = 0;
    for (const s of sessionsToImport) {
      try {
        await api.createSession({
          agentId: 'adhoc',
          machineId: s.machineId,
          projectPath: s.projectPath,
          prompt: 'Imported from discover — continue previous work.',
          resumeSessionId: s.sessionId,
        });
        successCount++;
      } catch {
        failCount++;
      }
    }
    setBulkImporting(false);
    setSelectedIds(new Set());
    if (failCount === 0) {
      toast.success(`Imported ${successCount} session${successCount !== 1 ? 's' : ''}`);
    } else {
      toast.error(`Imported ${successCount}, failed ${failCount}`);
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.discover });
  }, [selectedIds, filtered, queryClient, toast]);

  const handleNewSession = useCallback(async () => {
    if (!newProjectPath.trim() || !newPrompt.trim()) return;
    const machineId = newMachineId || machines[0]?.id;
    if (!machineId) {
      toast.error('No machines available. Ensure at least one machine is online.');
      return;
    }
    setNewSessionCreating(true);
    try {
      await api.createSession({
        agentId: 'adhoc',
        machineId,
        projectPath: newProjectPath.trim(),
        prompt: newPrompt.trim(),
      });
      toast.success('Session created successfully');
      setNewProjectPath('');
      setNewPrompt('');
      setShowNewSession(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.discover });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setNewSessionCreating(false);
    }
  }, [newProjectPath, newPrompt, newMachineId, machines, queryClient, toast]);

  const handleResume = useCallback(
    async (session: DiscoveredSession) => {
      if (!resumePrompt.trim()) return;
      setResuming(session.sessionId);
      try {
        await api.createSession({
          agentId: 'adhoc',
          machineId: session.machineId,
          projectPath: session.projectPath,
          prompt: resumePrompt.trim(),
          resumeSessionId: session.sessionId,
        });
        toast.success(`Session resumed on ${session.hostname}`);
        setResumePrompt('');
        setResuming(null);
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.discover });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        setResuming(null);
      }
    },
    [resumePrompt, queryClient, toast],
  );

  return (
    <div className="relative p-4 md:p-6 max-w-[1100px] animate-fade-in">
      <FetchingBar isFetching={query.isFetching && !query.isLoading} />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-5">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Discover Sessions</h1>
          <p className="text-[13px] text-muted-foreground mt-1">
            Browse Claude Code sessions across all fleet machines.
            {data && (
              <span>
                {' '}
                Queried {data.machinesQueried} machine(s)
                {data.machinesFailed > 0 && (
                  <span className="text-yellow-500">, {data.machinesFailed} failed</span>
                )}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
          <button
            type="button"
            onClick={() => setShowNewSession(!showNewSession)}
            aria-label={showNewSession ? 'Cancel new session form' : 'Show new session form'}
            aria-expanded={showNewSession}
            className={cn(
              'px-3.5 py-1.5 border border-border rounded-md text-[13px] cursor-pointer font-medium',
              showNewSession ? 'bg-primary text-white' : 'bg-muted text-muted-foreground',
            )}
          >
            {showNewSession ? 'Cancel' : '+ New Session'}
          </button>
          <RefreshButton
            onClick={() => void refetch()}
            isFetching={query.isFetching && !query.isLoading}
            label="Scan All Machines"
          />
        </div>
      </div>

      {/* Quick new session form */}
      {showNewSession && (
        <div className="p-4 bg-card border border-border/50 rounded-lg mb-4 flex gap-3 items-end flex-wrap">
          <div className="min-w-[120px]">
            <label
              htmlFor="new-session-machine"
              className="text-[11px] text-muted-foreground mb-1 block"
            >
              Machine
            </label>
            <select
              id="new-session-machine"
              value={newMachineId}
              onChange={(e) => setNewMachineId(e.target.value)}
              disabled={newSessionCreating}
              className="w-full px-2.5 py-1.5 bg-background text-foreground border border-border rounded-md font-mono text-xs outline-none box-border focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
            >
              {machines.length === 0 ? (
                <option value="">No machines</option>
              ) : (
                machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.hostname}
                  </option>
                ))
              )}
            </select>
          </div>
          <div className="flex-1 min-w-[150px]">
            <label
              htmlFor="new-session-project-path"
              className="text-[11px] text-muted-foreground mb-1 block"
            >
              Project Path
            </label>
            <input
              id="new-session-project-path"
              type="text"
              value={newProjectPath}
              onChange={(e) => setNewProjectPath(e.target.value)}
              disabled={newSessionCreating}
              placeholder="/Users/hahaschool/my-project"
              className="w-full px-2.5 py-1.5 bg-background text-foreground border border-border rounded-md font-mono text-xs outline-none box-border focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
            />
          </div>
          <div className="flex-[2] min-w-[200px]">
            <label
              htmlFor="new-session-prompt"
              className="text-[11px] text-muted-foreground mb-1 block"
            >
              Prompt
            </label>
            <input
              id="new-session-prompt"
              type="text"
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleNewSession();
              }}
              disabled={newSessionCreating}
              placeholder="What should Claude work on?"
              className="w-full px-2.5 py-1.5 bg-background text-foreground border border-border rounded-md text-xs outline-none box-border focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleNewSession()}
            disabled={!newProjectPath.trim() || !newPrompt.trim() || newSessionCreating}
            className={cn(
              'px-[18px] py-1.5 bg-primary text-white rounded-sm text-[13px] font-medium border-none cursor-pointer',
              (!newProjectPath.trim() || !newPrompt.trim() || newSessionCreating) && 'opacity-50',
            )}
          >
            {newSessionCreating ? 'Creating...' : 'Create'}
          </button>
        </div>
      )}

      {/* Error banner */}
      {error && <ErrorBanner message={error.message} onRetry={() => void query.refetch()} />}

      {/* Filter bar */}
      <div className="flex gap-3 items-center flex-wrap px-4 py-3 bg-card border border-border/50 rounded-lg mb-4">
        <input
          ref={searchRef}
          id="discover-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sessions... (press /)"
          aria-label="Search sessions"
          className="flex-1 min-w-[140px] px-2.5 py-1.5 bg-background text-foreground border border-border rounded-md text-[13px] outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
        />
        <label htmlFor="discover-min-msgs" className="flex items-center gap-1.5 text-[13px]">
          <span className="text-muted-foreground">Min msgs:</span>
          <select
            id="discover-min-msgs"
            value={minMessages}
            onChange={(e) => setMinMessages(Number(e.target.value) as MinMessages)}
            aria-label="Minimum message count"
            className="px-2 py-[5px] bg-background text-foreground border border-border rounded-md text-[13px] focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
          >
            {MIN_MESSAGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="discover-sort" className="flex items-center gap-1.5 text-[13px]">
          <span className="text-muted-foreground">Sort:</span>
          <select
            id="discover-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            aria-label="Sort order"
            className="px-2 py-[5px] bg-background text-foreground border border-border rounded-md text-[13px] focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        {/* Machine filter */}
        {hostnames.length > 1 && (
          <label htmlFor="discover-machine" className="flex items-center gap-1.5 text-[13px]">
            <span className="text-muted-foreground">Machine:</span>
            <select
              id="discover-machine"
              value={machineFilter}
              onChange={(e) => setMachineFilter(e.target.value)}
              className="px-2 py-[5px] bg-background text-foreground border border-border rounded-md text-[13px] focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
            >
              <option value="all">All ({hostnames.length})</option>
              {hostnames.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
        )}
        {/* Group by toggle */}
        <label htmlFor="discover-group" className="flex items-center gap-1.5 text-[13px]">
          <span className="text-muted-foreground">Group:</span>
          <select
            id="discover-group"
            value={groupMode}
            onChange={(e) => setGroupMode(e.target.value as GroupMode)}
            aria-label="Group by"
            className="px-2 py-[5px] bg-background text-foreground border border-border rounded-md text-[13px] focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
          >
            <option value="project">By Project</option>
            <option value="machine">By Machine</option>
            <option value="flat">Flat List</option>
          </select>
        </label>
        {groupMode !== 'flat' && (
          <button
            type="button"
            onClick={toggleAll}
            aria-label={allExpanded ? 'Collapse all groups' : 'Expand all groups'}
            className="py-[5px] px-3 bg-muted text-muted-foreground border border-border rounded-sm text-xs cursor-pointer whitespace-nowrap"
          >
            {allExpanded ? 'Collapse All' : 'Expand All'}
          </button>
        )}
      </div>

      {/* Stats line + bulk import controls */}
      <div className="flex items-center justify-between gap-3 text-[13px] text-muted-foreground mb-4">
        <div>
          Showing {formatNumber(filtered.length)} of {formatNumber(allSessions.length)} sessions
          across {projectCount} project{projectCount !== 1 ? 's' : ''} on {machineCount} machine
          {machineCount !== 1 ? 's' : ''}
          {importedSessionIds.size > 0 && (
            <span className="ml-2 text-green-600">
              ({filtered.filter((s) => importedSessionIds.has(s.sessionId)).length} already imported)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={selectAllFiltered}
            className="px-2.5 py-1 bg-muted text-muted-foreground border border-border rounded-sm text-[11px] cursor-pointer whitespace-nowrap"
          >
            {selectedIds.size > 0 &&
            selectedIds.size === filtered.filter((s) => !importedSessionIds.has(s.sessionId)).length
              ? 'Deselect All'
              : 'Select All'}
          </button>
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={() => void handleBulkImport()}
              disabled={bulkImporting}
              className={cn(
                'px-3 py-1 bg-primary text-white rounded-sm text-[11px] font-medium border-none cursor-pointer whitespace-nowrap',
                bulkImporting && 'opacity-50',
              )}
            >
              {bulkImporting
                ? 'Importing...'
                : `Import ${selectedIds.size} Selected`}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, gi) => (
            <div
              key={`gsk-${String(gi)}`}
              className="border border-border/50 rounded-lg overflow-hidden"
            >
              <div className="px-4 py-2.5 bg-card flex items-center gap-3">
                <Skeleton className="w-4 h-4 shrink-0" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-4 w-20" />
              </div>
              <div>
                {Array.from({ length: gi === 0 ? 4 : 2 }, (_, si) => (
                  <div
                    key={`ssk-${String(si)}`}
                    className="flex items-center gap-3 px-4 py-2 border-t border-border"
                  >
                    <Skeleton className="w-[7px] h-[7px] rounded-full shrink-0" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-3 w-12 shrink-0" />
                    <Skeleton className="h-3 w-16 shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : allSessions.length === 0 ? (
        <EmptyState
          icon={'\u25B6'}
          title="No sessions discovered"
          description={
            data
              ? `Scanned ${data.machinesQueried} machine(s) and found no Claude Code sessions. Try clicking "Scan All Machines" or start a new session.`
              : 'No machines have been queried yet. Try clicking "Scan All Machines" to get started.'
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon={'\u2315'} title="No sessions match the current filters" />
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => {
            const isFlat = group.projectPath === '__flat__';
            const isCollapsed = collapsedGroups.has(group.projectPath);
            return (
              <div
                key={group.projectPath}
                className="border border-border/50 rounded-lg overflow-hidden transition-colors hover:border-border"
              >
                {/* Group header (hidden in flat mode) */}
                {!isFlat && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.projectPath)}
                    aria-expanded={!isCollapsed}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-2.5 bg-card border-none cursor-pointer text-left text-foreground',
                      !isCollapsed && 'border-b border-border',
                    )}
                  >
                    <span
                      className={cn(
                        'text-xs inline-block w-4 text-center shrink-0 transition-transform duration-150',
                        isCollapsed && '-rotate-90',
                      )}
                    >
                      {'\u25BC'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm leading-5">{group.projectName}</div>
                      {groupMode === 'machine' ? (
                        <div className="font-mono text-[11px] text-muted-foreground leading-4">
                          {new Set(group.sessions.map((s) => s.projectPath)).size} project(s)
                        </div>
                      ) : (
                        <PathBadge path={group.projectPath} className="text-[11px] leading-4" />
                      )}
                    </div>
                    <div className="flex gap-2.5 items-center shrink-0">
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                        last active: <LiveTimeAgo date={group.latestActivity} />
                      </span>
                      <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-sm font-medium">
                        {group.sessions.length} session
                        {group.sessions.length !== 1 ? 's' : ''}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatNumber(group.totalMessages)} msgs
                      </span>
                    </div>
                  </button>
                )}

                {/* Session rows */}
                {(isFlat || !isCollapsed) && (
                  <div>
                    {group.sessions.map((s) => {
                      const isSelected = selectedSessionId === s.sessionId;
                      const isResuming = resuming === s.sessionId;
                      const dotClass = recencyColorClass(s.lastActivity);
                      const isImported = importedSessionIds.has(s.sessionId);
                      const isChecked = selectedIds.has(s.sessionId);
                      return (
                        <div key={`${s.machineId}-${s.sessionId}`}>
                          <div
                            className={cn(
                              'w-full flex items-center gap-3 border-b border-border transition-colors duration-100 text-left text-foreground font-[inherit]',
                              'border-t-0 border-r-0',
                              isFlat ? 'px-4 py-2' : 'py-2 pr-4 pl-[44px]',
                              isSelected
                                ? 'bg-muted border-l-[3px] border-l-primary'
                                : 'bg-background border-l-[3px] border-l-transparent hover:bg-accent/10',
                            )}
                          >
                            {/* Selection checkbox */}
                            <input
                              type="checkbox"
                              checked={isChecked}
                              disabled={isImported}
                              onChange={() => toggleSelect(s.sessionId)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Select session ${s.sessionId.slice(0, 8)}`}
                              className={cn(
                                'shrink-0 w-3.5 h-3.5 accent-primary cursor-pointer',
                                isImported && 'opacity-30 cursor-not-allowed',
                              )}
                            />

                            {/* Clickable session content */}
                            <button
                              type="button"
                              onClick={() => setSelectedSessionId(s.sessionId)}
                              className="flex-1 flex items-center gap-3 min-w-0 cursor-pointer bg-transparent border-none p-0 text-left text-foreground font-[inherit]"
                            >
                              {/* Recency dot */}
                              <span
                                className={cn(
                                  'w-[7px] h-[7px] rounded-full shrink-0 inline-block',
                                  dotClass,
                                )}
                                title={recencyTitle(s.lastActivity)}
                              />

                              {/* Summary */}
                              <SimpleTooltip content={s.summary || 'Untitled'}>
                                <span className="flex-1 text-[13px] font-medium text-foreground overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
                                  <HighlightText text={s.summary || 'Untitled'} highlight={search} />
                                </span>
                              </SimpleTooltip>
                            </button>

                            {/* Message count */}
                            <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                              {formatNumber(s.messageCount)} msgs
                            </span>

                            {/* Branch badge */}
                            {s.branch && (
                              <SimpleTooltip content={`Branch: ${s.branch}`}>
                                <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-mono text-green-500 bg-green-500/10 border border-green-500/20 px-1.5 py-px rounded-sm whitespace-nowrap shrink-0 max-w-[140px] overflow-hidden text-ellipsis">
                                  <svg className="w-3 h-3 shrink-0" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                                    <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" />
                                  </svg>
                                  {s.branch}
                                </span>
                              </SimpleTooltip>
                            )}

                            {/* Imported badge */}
                            {isImported && (
                              <span className="hidden sm:inline text-[10px] font-medium text-green-600 bg-green-600/10 border border-green-600/20 px-1.5 py-px rounded-sm whitespace-nowrap shrink-0">
                                Imported
                              </span>
                            )}

                            {/* Hostname */}
                            <span className="hidden sm:inline text-[11px] font-mono text-muted-foreground bg-muted px-1.5 py-px rounded-sm whitespace-nowrap shrink-0">
                              {s.hostname}
                            </span>

                            {/* Last activity */}
                            <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 min-w-[60px] text-right">
                              <LiveTimeAgo date={s.lastActivity} />
                            </span>

                            {/* Session ID (copyable) */}
                            <span className="hidden md:inline">
                              <CopyableText value={s.sessionId} />
                            </span>

                            {/* Import button */}
                            {!isImported && !isResuming && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleSingleImport(s);
                                }}
                                disabled={importingSessionId === s.sessionId}
                                aria-label={`Import session ${s.sessionId.slice(0, 8)}`}
                                className={cn(
                                  'px-2.5 py-1 bg-muted text-muted-foreground border border-border rounded-sm text-[11px] font-medium cursor-pointer whitespace-nowrap shrink-0',
                                  importingSessionId === s.sessionId && 'opacity-50 cursor-not-allowed',
                                )}
                              >
                                {importingSessionId === s.sessionId ? 'Importing...' : 'Import'}
                              </button>
                            )}

                            {/* Resume button */}
                            {!isResuming && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setResuming(s.sessionId);
                                  setResumePrompt('');
                                }}
                                aria-label={`Resume session ${s.sessionId.slice(0, 8)}`}
                                className="px-2.5 py-1 bg-primary text-white rounded-sm text-[11px] font-medium border-none cursor-pointer whitespace-nowrap shrink-0"
                              >
                                Resume
                              </button>
                            )}
                          </div>

                          {/* Inline resume input */}
                          {isResuming && (
                            <div
                              className={cn(
                                'flex gap-1.5 bg-card border-b border-border',
                                isFlat ? 'px-4 py-1.5' : 'py-1.5 pr-4 pl-[44px]',
                              )}
                            >
                              <input
                                type="text"
                                value={resumePrompt}
                                onChange={(e) => setResumePrompt(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void handleResume(s);
                                  if (e.key === 'Escape') setResuming(null);
                                }}
                                placeholder="Enter prompt to resume..."
                                aria-label="Prompt to resume session"
                                className="flex-1 px-2.5 py-[5px] bg-background text-foreground border border-border rounded-md text-xs outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                              />
                              <button
                                type="button"
                                onClick={() => void handleResume(s)}
                                disabled={!resumePrompt.trim()}
                                aria-label="Submit resume prompt"
                                className={cn(
                                  'py-[5px] px-3 bg-primary text-white rounded-sm text-xs border-none cursor-pointer',
                                  !resumePrompt.trim() && 'opacity-50',
                                )}
                              >
                                Go
                              </button>
                              <button
                                type="button"
                                onClick={() => setResuming(null)}
                                aria-label="Cancel resume"
                                className="py-[5px] px-2.5 bg-muted text-muted-foreground border border-border rounded-sm text-xs cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Session preview panel */}
      {selectedSession && (
        <SessionPreview
          sessionId={selectedSession.sessionId}
          machineId={selectedSession.machineId}
          projectPath={selectedSession.projectPath}
          onClose={() => setSelectedSessionId(null)}
        />
      )}
    </div>
  );
}
