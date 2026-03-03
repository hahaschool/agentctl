import type React from 'react';
import { useCallback, useMemo, useState } from 'react';

import { SessionPreview } from '../components/SessionPreview.tsx';
import { usePolling } from '../hooks/use-polling.ts';
import type { DiscoveredSession } from '../lib/api.ts';
import { api } from '../lib/api.ts';

type MinMessages = 0 | 1 | 5 | 10 | 50;
type SortOption = 'recent' | 'messages' | 'project';

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

export function DiscoverPage(): React.JSX.Element {
  const discovered = usePolling<{
    sessions: DiscoveredSession[];
    count: number;
    machinesQueried: number;
    machinesFailed: number;
  }>({
    fetcher: api.discoverSessions,
    intervalMs: 30_000,
  });

  const [resuming, setResuming] = useState<string | null>(null);
  const [resumePrompt, setResumePrompt] = useState('');
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  // New session form state
  const [showNewSession, setShowNewSession] = useState(false);
  const [newProjectPath, setNewProjectPath] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [newSessionCreating, setNewSessionCreating] = useState(false);

  // Filter state
  const [search, setSearch] = useState('');
  const [minMessages, setMinMessages] = useState<MinMessages>(1);
  const [sort, setSort] = useState<SortOption>('recent');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const data = discovered.data;
  const allSessions = data?.sessions ?? [];

  // Filtered sessions
  const filtered = useMemo(() => {
    const lowerSearch = search.toLowerCase().trim();
    return allSessions.filter((s) => {
      if (s.messageCount < minMessages) return false;
      if (lowerSearch) {
        const haystack = `${s.summary} ${s.projectPath} ${s.sessionId}`.toLowerCase();
        if (!haystack.includes(lowerSearch)) return false;
      }
      return true;
    });
  }, [allSessions, minMessages, search]);

  // Grouped + sorted
  const groups = useMemo((): SessionGroup[] => {
    const map = new Map<string, DiscoveredSession[]>();
    for (const s of filtered) {
      const key = s.projectPath;
      const arr = map.get(key);
      if (arr) {
        arr.push(s);
      } else {
        map.set(key, [s]);
      }
    }

    const result: SessionGroup[] = [];
    for (const [projectPath, sessions] of map) {
      const parts = projectPath.split('/');
      const projectName = parts[parts.length - 1] || projectPath;
      let totalMessages = 0;
      let latestActivity = '';
      for (const s of sessions) {
        totalMessages += s.messageCount;
        if (!latestActivity || s.lastActivity > latestActivity) {
          latestActivity = s.lastActivity;
        }
      }
      result.push({ projectPath, projectName, sessions, totalMessages, latestActivity });
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
  }, [filtered, sort]);

  // Unique project count
  const projectCount = groups.length;

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
    setActionMsg(null);
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
      setActionMsg('Session created successfully');
      setNewProjectPath('');
      setNewPrompt('');
      setShowNewSession(false);
      discovered.refresh();
    } catch (err) {
      setActionMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setNewSessionCreating(false);
    }
  }, [newProjectPath, newPrompt, allSessions, discovered]);

  const handleResume = useCallback(
    async (session: DiscoveredSession) => {
      if (!resumePrompt.trim()) return;
      setResuming(session.sessionId);
      setActionMsg(null);
      try {
        await api.createSession({
          agentId: 'adhoc',
          machineId: session.machineId,
          projectPath: session.projectPath,
          prompt: resumePrompt.trim(),
          resumeSessionId: session.sessionId,
        });
        setActionMsg(`Session resumed on ${session.hostname}`);
        setResumePrompt('');
        setResuming(null);
        discovered.refresh();
      } catch (err) {
        setActionMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
        setResuming(null);
      }
    },
    [resumePrompt, discovered],
  );

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Discover Sessions</h1>
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-muted)',
              marginTop: 4,
            }}
          >
            Browse Claude Code sessions across all fleet machines.
            {data && (
              <span>
                {' '}
                Queried {data.machinesQueried} machine(s)
                {data.machinesFailed > 0 && (
                  <span style={{ color: 'var(--yellow)' }}>, {data.machinesFailed} failed</span>
                )}
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => setShowNewSession(!showNewSession)}
            style={{
              padding: '6px 14px',
              backgroundColor: showNewSession ? 'var(--accent)' : 'var(--bg-tertiary)',
              color: showNewSession ? '#fff' : 'var(--text-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 13,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            {showNewSession ? 'Cancel' : '+ New Session'}
          </button>
          <button
            type="button"
            onClick={discovered.refresh}
            style={{
              padding: '6px 14px',
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Scan All Machines
          </button>
        </div>
      </div>

      {/* Quick new session form */}
      {showNewSession && (
        <div
          style={{
            padding: '16px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            marginBottom: 16,
            display: 'flex',
            gap: 12,
            alignItems: 'flex-end',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
              Project Path
            </div>
            <input
              type="text"
              value={newProjectPath}
              onChange={(e) => setNewProjectPath(e.target.value)}
              placeholder="/Users/hahaschool/my-project"
              style={{
                width: '100%',
                padding: '6px 10px',
                backgroundColor: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ flex: 2, minWidth: 300 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Prompt</div>
            <input
              type="text"
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleNewSession();
              }}
              placeholder="What should Claude work on?"
              style={{
                width: '100%',
                padding: '6px 10px',
                backgroundColor: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 12,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <button
            type="button"
            onClick={() => void handleNewSession()}
            disabled={!newProjectPath.trim() || !newPrompt.trim() || newSessionCreating}
            style={{
              padding: '6px 18px',
              backgroundColor: 'var(--accent)',
              color: '#fff',
              borderRadius: 'var(--radius-sm)',
              fontSize: 13,
              fontWeight: 500,
              border: 'none',
              cursor: 'pointer',
              opacity: !newProjectPath.trim() || !newPrompt.trim() || newSessionCreating ? 0.5 : 1,
            }}
          >
            {newSessionCreating ? 'Creating...' : 'Create'}
          </button>
        </div>
      )}

      {/* Error banner */}
      {discovered.error && (
        <div
          style={{
            padding: '10px 16px',
            backgroundColor: '#7f1d1d',
            color: '#fca5a5',
            borderRadius: 'var(--radius)',
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          {discovered.error.message}
        </div>
      )}

      {/* Action message banner */}
      {actionMsg && (
        <div
          style={{
            padding: '10px 16px',
            backgroundColor: actionMsg.startsWith('Error') ? '#7f1d1d' : '#14532d',
            color: actionMsg.startsWith('Error') ? '#fca5a5' : '#86efac',
            borderRadius: 'var(--radius)',
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          {actionMsg}
        </div>
      )}

      {/* Filter bar */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: '12px 16px',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          marginBottom: 16,
        }}
      >
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sessions..."
          style={{
            flex: 1,
            minWidth: 200,
            padding: '6px 10px',
            backgroundColor: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 13,
            outline: 'none',
          }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Min msgs:</span>
          <select
            value={minMessages}
            onChange={(e) => setMinMessages(Number(e.target.value) as MinMessages)}
            style={{
              padding: '5px 8px',
              backgroundColor: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 13,
            }}
          >
            {MIN_MESSAGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Sort:</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            style={{
              padding: '5px 8px',
              backgroundColor: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 13,
            }}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={toggleAll}
          style={{
            padding: '5px 12px',
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {allExpanded ? 'Collapse All' : 'Expand All'}
        </button>
      </div>

      {/* Stats line */}
      <div
        style={{
          fontSize: 13,
          color: 'var(--text-muted)',
          marginBottom: 16,
        }}
      >
        Showing {filtered.length} of {allSessions.length} sessions across {projectCount} projects
      </div>

      {/* Content */}
      {allSessions.length === 0 ? (
        <div
          style={{
            padding: 48,
            textAlign: 'center',
            color: 'var(--text-muted)',
          }}
        >
          {discovered.isLoading
            ? 'Scanning machines for sessions...'
            : 'No sessions discovered across the fleet'}
        </div>
      ) : filtered.length === 0 ? (
        <div
          style={{
            padding: 48,
            textAlign: 'center',
            color: 'var(--text-muted)',
          }}
        >
          No sessions match the current filters
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groups.map((group) => {
            const isCollapsed = collapsedGroups.has(group.projectPath);
            return (
              <div
                key={group.projectPath}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  overflow: 'hidden',
                }}
              >
                {/* Group header */}
                <button
                  type="button"
                  onClick={() => toggleGroup(group.projectPath)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 16px',
                    backgroundColor: 'var(--bg-secondary)',
                    border: 'none',
                    borderBottom: isCollapsed ? 'none' : '1px solid var(--border)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    color: 'var(--text-primary)',
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      transition: 'transform 0.15s',
                      transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                      display: 'inline-block',
                      width: 16,
                      textAlign: 'center',
                      flexShrink: 0,
                    }}
                  >
                    ▼
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{group.projectName}</div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {group.projectPath}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
                    <span
                      style={{
                        fontSize: 12,
                        color: 'var(--text-secondary)',
                        backgroundColor: 'var(--bg-tertiary)',
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-sm)',
                        fontWeight: 500,
                      }}
                    >
                      {group.sessions.length} session{group.sessions.length !== 1 ? 's' : ''}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: 'var(--text-muted)',
                      }}
                    >
                      {group.totalMessages} msgs
                    </span>
                  </div>
                </button>

                {/* Session rows */}
                {!isCollapsed && (
                  <div>
                    {group.sessions.map((s) => {
                      const isSelected = selectedSessionId === s.sessionId;
                      const isResuming = resuming === s.sessionId;
                      return (
                        <div key={`${s.machineId}-${s.sessionId}`}>
                          <button
                            type="button"
                            onClick={() => setSelectedSessionId(s.sessionId)}
                            style={{
                              width: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 12,
                              padding: '8px 16px 8px 44px',
                              backgroundColor: isSelected
                                ? 'var(--bg-tertiary)'
                                : 'var(--bg-primary)',
                              borderLeft: isSelected
                                ? '3px solid var(--accent)'
                                : '3px solid transparent',
                              borderRight: 'none',
                              borderTop: 'none',
                              cursor: 'pointer',
                              borderBottom: '1px solid var(--border)',
                              transition: 'background-color 0.1s',
                              textAlign: 'left',
                              color: 'var(--text-primary)',
                              font: 'inherit',
                            }}
                            onMouseEnter={(e) => {
                              if (!isSelected) {
                                e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                              }
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = isSelected
                                ? 'var(--bg-tertiary)'
                                : 'var(--bg-primary)';
                            }}
                          >
                            {/* Summary */}
                            <span
                              style={{
                                flex: 1,
                                fontSize: 13,
                                fontWeight: 500,
                                color: 'var(--text-primary)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                minWidth: 0,
                              }}
                            >
                              {s.summary || 'Untitled'}
                            </span>

                            {/* Message count */}
                            <span
                              style={{
                                fontSize: 12,
                                color: 'var(--text-muted)',
                                whiteSpace: 'nowrap',
                                flexShrink: 0,
                              }}
                            >
                              {s.messageCount} msgs
                            </span>

                            {/* Branch */}
                            {s.branch && (
                              <span
                                style={{
                                  fontSize: 11,
                                  fontFamily: 'var(--font-mono)',
                                  color: 'var(--green)',
                                  backgroundColor: 'var(--bg-tertiary)',
                                  padding: '1px 6px',
                                  borderRadius: 'var(--radius-sm)',
                                  whiteSpace: 'nowrap',
                                  flexShrink: 0,
                                  maxWidth: 140,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {s.branch}
                              </span>
                            )}

                            {/* Hostname */}
                            <span
                              style={{
                                fontSize: 11,
                                fontFamily: 'var(--font-mono)',
                                color: 'var(--text-muted)',
                                backgroundColor: 'var(--bg-tertiary)',
                                padding: '1px 6px',
                                borderRadius: 'var(--radius-sm)',
                                whiteSpace: 'nowrap',
                                flexShrink: 0,
                              }}
                            >
                              {s.hostname}
                            </span>

                            {/* Last activity */}
                            <span
                              style={{
                                fontSize: 12,
                                color: 'var(--text-muted)',
                                whiteSpace: 'nowrap',
                                flexShrink: 0,
                                minWidth: 60,
                                textAlign: 'right',
                              }}
                            >
                              {relativeTime(s.lastActivity)}
                            </span>

                            {/* Session ID */}
                            <span
                              style={{
                                fontSize: 11,
                                fontFamily: 'var(--font-mono)',
                                color: 'var(--text-muted)',
                                whiteSpace: 'nowrap',
                                flexShrink: 0,
                              }}
                            >
                              {s.sessionId.slice(0, 8)}
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
                                style={{
                                  padding: '3px 10px',
                                  backgroundColor: 'var(--accent)',
                                  color: '#fff',
                                  borderRadius: 'var(--radius-sm)',
                                  fontSize: 11,
                                  fontWeight: 500,
                                  border: 'none',
                                  cursor: 'pointer',
                                  whiteSpace: 'nowrap',
                                  flexShrink: 0,
                                }}
                              >
                                Resume
                              </button>
                            )}
                          </button>

                          {/* Inline resume input */}
                          {isResuming && (
                            <div
                              style={{
                                display: 'flex',
                                gap: 6,
                                padding: '6px 16px 6px 44px',
                                backgroundColor: 'var(--bg-secondary)',
                                borderBottom: '1px solid var(--border)',
                              }}
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
                                style={{
                                  flex: 1,
                                  padding: '5px 10px',
                                  backgroundColor: 'var(--bg-primary)',
                                  color: 'var(--text-primary)',
                                  border: '1px solid var(--border)',
                                  borderRadius: 'var(--radius-sm)',
                                  fontSize: 12,
                                  outline: 'none',
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => void handleResume(s)}
                                disabled={!resumePrompt.trim()}
                                style={{
                                  padding: '5px 12px',
                                  backgroundColor: 'var(--accent)',
                                  color: '#fff',
                                  borderRadius: 'var(--radius-sm)',
                                  fontSize: 12,
                                  border: 'none',
                                  cursor: 'pointer',
                                  opacity: resumePrompt.trim() ? 1 : 0.5,
                                }}
                              >
                                Go
                              </button>
                              <button
                                type="button"
                                onClick={() => setResuming(null)}
                                style={{
                                  padding: '5px 10px',
                                  backgroundColor: 'var(--bg-tertiary)',
                                  color: 'var(--text-secondary)',
                                  border: '1px solid var(--border)',
                                  borderRadius: 'var(--radius-sm)',
                                  fontSize: 12,
                                  cursor: 'pointer',
                                }}
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

function relativeTime(dateStr: string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}
