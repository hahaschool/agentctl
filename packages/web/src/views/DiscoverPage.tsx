'use client';

import type { ManagedRuntime } from '@agentctl/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Compass, Filter } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { GroupMode, MinMessages, SortOption } from '../components/DiscoverFilterBar';
import { DiscoverFilterBar } from '../components/DiscoverFilterBar';
import { DiscoverLoadingSkeleton } from '../components/DiscoverLoadingSkeleton';
import { DiscoverNewSessionForm } from '../components/DiscoverNewSessionForm';
import type { SessionGroup } from '../components/DiscoverSessionGroup';
import { DiscoverSessionGroup } from '../components/DiscoverSessionGroup';
import { DiscoverStatsBar } from '../components/DiscoverStatsBar';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { FetchingBar } from '../components/FetchingBar';
import { LastUpdated } from '../components/LastUpdated';
import { RefreshButton } from '../components/RefreshButton';
import { SessionPreview } from '../components/SessionPreview';
import { useToast } from '../components/Toast';
import { useHotkeys } from '../hooks/use-hotkeys';
import type { DiscoveredSession } from '../lib/api';
import { api } from '../lib/api';
import { discoverQuery, queryKeys, sessionsQuery } from '../lib/queries';

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
  const [newSessionRuntime, setNewSessionRuntime] = useState<ManagedRuntime>('claude-code');

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
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(
    null,
  );

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
  const [runtimeFilter, setRuntimeFilter] = useState<string>('all');
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
      if (runtimeFilter !== 'all') {
        if (runtimeFilter === 'unknown') {
          if (s.runtime !== undefined) return false;
        } else {
          if (s.runtime !== runtimeFilter) return false;
        }
      }
      if (lowerSearch) {
        const haystack = `${s.summary} ${s.projectPath} ${s.sessionId} ${s.hostname}`.toLowerCase();
        if (!haystack.includes(lowerSearch)) return false;
      }
      return true;
    });
  }, [allSessions, minMessages, machineFilter, runtimeFilter, search]);

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

  // Clear selection when filters change — deps are intentionally the filter values, not setSelectedIds
  // biome-ignore lint/correctness/useExhaustiveDependencies: effect intentionally tracks filter values
  useEffect(() => {
    setSelectedIds(new Set());
  }, [search, minMessages, machineFilter, runtimeFilter]);

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

  const notImportedFiltered = useMemo(
    () => filtered.filter((s) => !importedSessionIds.has(s.sessionId)),
    [filtered, importedSessionIds],
  );

  const selectAllFiltered = useCallback(() => {
    if (selectedIds.size === notImportedFiltered.length && notImportedFiltered.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(notImportedFiltered.map((s) => s.sessionId)));
    }
  }, [notImportedFiltered, selectedIds.size]);

  const handleBulkImport = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setBulkImporting(true);
    const sessionsToImport = filtered.filter((s) => selectedIds.has(s.sessionId));
    setImportProgress({ current: 0, total: sessionsToImport.length });
    let successCount = 0;
    let failCount = 0;
    for (let i = 0; i < sessionsToImport.length; i++) {
      const s = sessionsToImport[i];
      if (!s) continue;
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
      setImportProgress({ current: i + 1, total: sessionsToImport.length });
    }
    setImportProgress(null);
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
        runtime: newSessionRuntime,
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
  }, [newProjectPath, newPrompt, newMachineId, newSessionRuntime, machines, queryClient, toast]);

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

  const handleStartResume = useCallback((sessionId: string) => {
    setResuming(sessionId);
    setResumePrompt('');
  }, []);

  const handleCancelResume = useCallback(() => {
    setResuming(null);
  }, []);

  return (
    <div className="relative p-4 md:p-6 max-w-[1100px] animate-page-enter">
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
              'px-3.5 py-1.5 border border-border rounded-md text-[13px] cursor-pointer font-medium transition-colors focus:ring-2 focus:ring-primary/20 focus:border-primary/40',
              showNewSession
                ? 'bg-primary text-white hover:bg-primary/90'
                : 'bg-muted text-muted-foreground hover:bg-muted/80',
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
        <DiscoverNewSessionForm
          machines={machines}
          machineId={newMachineId}
          onMachineIdChange={setNewMachineId}
          projectPath={newProjectPath}
          onProjectPathChange={setNewProjectPath}
          prompt={newPrompt}
          onPromptChange={setNewPrompt}
          creating={newSessionCreating}
          onSubmit={() => void handleNewSession()}
          runtime={newSessionRuntime}
          onRuntimeChange={setNewSessionRuntime}
        />
      )}

      {/* Error banner */}
      {error && <ErrorBanner message={error.message} onRetry={() => void query.refetch()} />}

      {/* Runtime filter */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm text-muted-foreground">Runtime:</span>
        <select
          value={runtimeFilter}
          onChange={(e) => setRuntimeFilter(e.target.value)}
          className="bg-muted border border-border rounded px-2 py-1 text-xs text-foreground outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
        >
          <option value="all">All</option>
          <option value="claude-code">Claude Code</option>
          <option value="codex">Codex</option>
          <option value="unknown">Unknown</option>
        </select>
      </div>

      {/* Filter bar */}
      <DiscoverFilterBar
        searchRef={searchRef}
        search={search}
        onSearchChange={setSearch}
        minMessages={minMessages}
        onMinMessagesChange={setMinMessages}
        sort={sort}
        onSortChange={setSort}
        hostnames={hostnames}
        machineFilter={machineFilter}
        onMachineFilterChange={setMachineFilter}
        groupMode={groupMode}
        onGroupModeChange={setGroupMode}
        allExpanded={allExpanded}
        onToggleAll={toggleAll}
      />

      {/* Stats line + bulk import controls */}
      <DiscoverStatsBar
        filteredCount={filtered.length}
        totalCount={allSessions.length}
        projectCount={projectCount}
        machineCount={machineCount}
        importedInFilterCount={filtered.filter((s) => importedSessionIds.has(s.sessionId)).length}
        hasImported={importedSessionIds.size > 0}
        selectedCount={selectedIds.size}
        notImportedFilteredCount={notImportedFiltered.length}
        onSelectAll={selectAllFiltered}
        onBulkImport={() => void handleBulkImport()}
        bulkImporting={bulkImporting}
        importProgress={importProgress}
      />

      {/* Content */}
      {isLoading ? (
        <DiscoverLoadingSkeleton />
      ) : allSessions.length === 0 ? (
        <EmptyState
          icon={Compass}
          title="No sessions discovered"
          description={
            data
              ? `Scanned ${data.machinesQueried} machine(s) and found no Claude Code sessions. Try clicking "Scan All Machines" or start a new session.`
              : 'No machines have been queried yet. Try clicking "Scan All Machines" to get started.'
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Filter} title="No sessions match the current filters" />
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <DiscoverSessionGroup
              key={group.projectPath}
              group={group}
              groupMode={groupMode}
              isCollapsed={collapsedGroups.has(group.projectPath)}
              onToggleGroup={toggleGroup}
              selectedSessionId={selectedSessionId}
              resumingSessionId={resuming}
              resumePrompt={resumePrompt}
              onResumePromptChange={setResumePrompt}
              importedSessionIds={importedSessionIds}
              selectedIds={selectedIds}
              importingSessionId={importingSessionId}
              search={search}
              onSelectSession={setSelectedSessionId}
              onToggleCheck={toggleSelect}
              onImport={handleSingleImport}
              onStartResume={handleStartResume}
              onSubmitResume={handleResume}
              onCancelResume={handleCancelResume}
            />
          ))}
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
