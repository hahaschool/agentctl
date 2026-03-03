'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type React from 'react';
import { useCallback, useMemo, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { CopyableText } from '../components/CopyableText';
import { EmptyState } from '../components/EmptyState';
import { LiveTimeAgo } from '../components/LiveTimeAgo';
import { SessionPreview } from '../components/SessionPreview';
import { SimpleTooltip } from '../components/SimpleTooltip';
import { useToast } from '../components/Toast';
import type { DiscoveredSession } from '../lib/api';
import { api } from '../lib/api';
import { recencyColor, shortenPath } from '../lib/format-utils';
import { discoverQuery, queryKeys } from '../lib/queries';

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
  { label: 'Recent activity', value: 'recent' },
  { label: 'Most messages', value: 'messages' },
  { label: 'Project name', value: 'project' },
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
  const [newSessionCreating, setNewSessionCreating] = useState(false);

  // Filter state
  const [search, setSearch] = useState('');
  const [minMessages, setMinMessages] = useState<MinMessages>(1);
  const [machineFilter, setMachineFilter] = useState<string>('all');
  const [sort, setSort] = useState<SortOption>('recent');
  const [groupMode, setGroupMode] = useState<GroupMode>('project');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const allSessions = data?.sessions ?? [];

  // Unique hostnames for filter dropdown
  const hostnames = useMemo(() => {
    const set = new Set<string>();
    for (const s of allSessions) set.add(s.hostname);
    return Array.from(set).sort();
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

  const handleNewSession = useCallback(async () => {
    if (!newProjectPath.trim() || !newPrompt.trim()) return;
    setNewSessionCreating(true);
    try {
      // Use the first machine from discovered sessions, or 'mac-local' as default
      const first = allSessions[0];
      const machineId = first ? first.machineId : 'mac-local';
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
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.discover });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setNewSessionCreating(false);
    }
  }, [newProjectPath, newPrompt, allSessions, queryClient, toast]);

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
        void queryClient.invalidateQueries({ queryKey: ['sessions'] });
        void queryClient.invalidateQueries({ queryKey: queryKeys.discover });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        setResuming(null);
      }
    },
    [resumePrompt, queryClient, toast],
  );

  return (
    <div className="p-6 max-w-[1100px] animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-5">
        <div>
          <h1 className="text-[22px] font-bold">Discover Sessions</h1>
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
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowNewSession(!showNewSession)}
            className={cn(
              'px-3.5 py-1.5 border border-border rounded-sm text-[13px] cursor-pointer font-medium',
              showNewSession ? 'bg-primary text-white' : 'bg-muted text-muted-foreground',
            )}
          >
            {showNewSession ? 'Cancel' : '+ New Session'}
          </button>
          <button
            type="button"
            onClick={() => void refetch()}
            className="px-3.5 py-1.5 bg-muted text-muted-foreground border border-border rounded-sm text-[13px] cursor-pointer"
          >
            Scan All Machines
          </button>
        </div>
      </div>

      {/* Quick new session form */}
      {showNewSession && (
        <div className="p-4 bg-card border border-border rounded-lg mb-4 flex gap-3 items-end flex-wrap">
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
              placeholder="/Users/hahaschool/my-project"
              className="w-full px-2.5 py-1.5 bg-background text-foreground border border-border rounded-sm font-mono text-xs outline-none box-border"
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
              placeholder="What should Claude work on?"
              className="w-full px-2.5 py-1.5 bg-background text-foreground border border-border rounded-sm text-xs outline-none box-border"
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
      {error && (
        <div className="px-4 py-2.5 bg-red-900 text-red-300 rounded-lg mb-4 text-[13px]">
          {error.message}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex gap-3 items-center flex-wrap px-4 py-3 bg-card border border-border rounded-lg mb-4">
        <input
          id="discover-search"
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sessions..."
          className="flex-1 min-w-[140px] px-2.5 py-1.5 bg-background text-foreground border border-border rounded-sm text-[13px] outline-none"
        />
        <label htmlFor="discover-min-msgs" className="flex items-center gap-1.5 text-[13px]">
          <span className="text-muted-foreground">Min msgs:</span>
          <select
            id="discover-min-msgs"
            value={minMessages}
            onChange={(e) => setMinMessages(Number(e.target.value) as MinMessages)}
            className="px-2 py-[5px] bg-background text-foreground border border-border rounded-sm text-[13px]"
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
            className="px-2 py-[5px] bg-background text-foreground border border-border rounded-sm text-[13px]"
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
              className="px-2 py-[5px] bg-background text-foreground border border-border rounded-sm text-[13px]"
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
            className="px-2 py-[5px] bg-background text-foreground border border-border rounded-sm text-[13px]"
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
            className="py-[5px] px-3 bg-muted text-muted-foreground border border-border rounded-sm text-xs cursor-pointer whitespace-nowrap"
          >
            {allExpanded ? 'Collapse All' : 'Expand All'}
          </button>
        )}
      </div>

      {/* Stats line */}
      <div className="text-[13px] text-muted-foreground mb-4">
        Showing {filtered.length} of {allSessions.length} sessions across {projectCount} project
        {projectCount !== 1 ? 's' : ''} on {machineCount} machine{machineCount !== 1 ? 's' : ''}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, gi) => (
            <div
              key={`gsk-${String(gi)}`}
              className="border border-border rounded-lg overflow-hidden"
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
                className="border border-border rounded-lg overflow-hidden"
              >
                {/* Group header (hidden in flat mode) */}
                {!isFlat && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.projectPath)}
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
                      <SimpleTooltip content={group.projectPath}>
                        <div className="font-mono text-[11px] text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap leading-4 cursor-default">
                          {groupMode === 'machine'
                            ? `${new Set(group.sessions.map((s) => s.projectPath)).size} project(s)`
                            : shortenPath(group.projectPath)}
                        </div>
                      </SimpleTooltip>
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
                        {group.totalMessages} msgs
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
                      const dotColor = recencyColor(s.lastActivity);
                      return (
                        <div key={`${s.machineId}-${s.sessionId}`}>
                          <button
                            type="button"
                            onClick={() => setSelectedSessionId(s.sessionId)}
                            className={cn(
                              'w-full flex items-center gap-3 border-b border-border transition-colors duration-100 text-left text-foreground font-[inherit]',
                              'border-t-0 border-r-0',
                              isFlat ? 'px-4 py-2' : 'py-2 pr-4 pl-[44px]',
                              isSelected
                                ? 'bg-muted border-l-[3px] border-l-primary'
                                : 'bg-background border-l-[3px] border-l-transparent hover:bg-accent/10',
                              'cursor-pointer',
                            )}
                          >
                            {/* Recency dot */}
                            <span
                              className="w-[7px] h-[7px] rounded-full shrink-0 inline-block"
                              style={{ backgroundColor: dotColor }}
                              title={recencyTitle(s.lastActivity)}
                            />

                            {/* Summary */}
                            <SimpleTooltip content={s.summary || 'Untitled'}>
                              <span className="flex-1 text-[13px] font-medium text-foreground overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
                                {s.summary || 'Untitled'}
                              </span>
                            </SimpleTooltip>

                            {/* Message count */}
                            <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                              {s.messageCount} msgs
                            </span>

                            {/* Branch */}
                            {s.branch && (
                              <span className="hidden sm:inline text-[11px] font-mono text-green-500 bg-muted px-1.5 py-px rounded-sm whitespace-nowrap shrink-0 max-w-[140px] overflow-hidden text-ellipsis">
                                {s.branch}
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

                            {/* Resume button */}
                            {!isResuming && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setResuming(s.sessionId);
                                  setResumePrompt('');
                                }}
                                className="px-2.5 py-1 bg-primary text-white rounded-sm text-[11px] font-medium border-none cursor-pointer whitespace-nowrap shrink-0"
                              >
                                Resume
                              </button>
                            )}
                          </button>

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
                                className="flex-1 px-2.5 py-[5px] bg-background text-foreground border border-border rounded-sm text-xs outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => void handleResume(s)}
                                disabled={!resumePrompt.trim()}
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
