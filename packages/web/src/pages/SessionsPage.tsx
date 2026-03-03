import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { StatusBadge } from '../components/StatusBadge.tsx';
import { useToast } from '../components/Toast.tsx';
import { usePolling } from '../hooks/use-polling.ts';
import type {
  Machine,
  Session,
  SessionContentMessage,
  SessionContentResponse,
} from '../lib/api.ts';
import { api } from '../lib/api.ts';
import { formatDuration, shortenPath, timeAgo } from '../lib/format-utils.ts';

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
  return false;
}

export function SessionsPage(): React.JSX.Element {
  const toast = useToast();
  const sessions = usePolling<Session[]>({
    fetcher: api.listSessions,
    intervalMs: 5_000,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [sending, setSending] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [hideEmpty, setHideEmpty] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // --- New Session form state ---
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [machinesLoading, setMachinesLoading] = useState(false);
  const [formMachineId, setFormMachineId] = useState('');
  const [formProjectPath, setFormProjectPath] = useState('');
  const [formPrompt, setFormPrompt] = useState('');
  const [formModel, setFormModel] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
      .catch(() => {
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
    setFormModel('');
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
      });
      toast.success(`Session created: ${result.sessionId.slice(0, 16)}...`);
      resetForm();
      setShowCreateForm(false);
      sessions.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setFormSubmitting(false);
    }
  }, [formMachineId, formProjectPath, formPrompt, formModel, resetForm, sessions, toast]);

  const sessionList = sessions.data ?? [];

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
      sessions.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }, [selected, prompt, sessions, toast]);

  const handleStop = useCallback(async () => {
    if (!selected) return;
    try {
      await api.deleteSession(selected.id);
      toast.success('Session ended');
      sessions.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [selected, sessions, toast]);

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Session list panel */}
      <div
        style={{
          width: 340,
          minWidth: 340,
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '16px 16px 12px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>
            Sessions
            <span
              style={{
                marginLeft: 8,
                fontSize: 12,
                fontWeight: 400,
                color: 'var(--text-muted)',
              }}
            >
              ({filteredSessions.length})
            </span>
          </h2>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={() => {
                setShowCreateForm((prev) => !prev);
                setFormError(null);
              }}
              style={{
                padding: '4px 10px',
                backgroundColor: showCreateForm ? 'var(--accent)' : 'var(--bg-tertiary)',
                color: showCreateForm ? '#fff' : 'var(--text-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              {showCreateForm ? 'Cancel' : '+ New Session'}
            </button>
            <button
              type="button"
              onClick={sessions.refresh}
              style={{
                padding: '4px 10px',
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 12,
              }}
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Search / filter input */}
        <div
          style={{
            padding: '8px 16px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <label
            htmlFor="session-search"
            style={{
              position: 'absolute',
              width: 1,
              height: 1,
              overflow: 'hidden',
              clip: 'rect(0,0,0,0)',
            }}
          >
            Search sessions
          </label>
          <input
            id="session-search"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by ID, project, agent..."
            style={{
              width: '100%',
              padding: '6px 8px',
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 12,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Status filter tabs */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border)',
            padding: '0 8px',
          }}
        >
          {STATUS_TABS.map((tab) => (
            <button
              type="button"
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              style={{
                flex: 1,
                padding: '8px 4px',
                fontSize: 11,
                fontWeight: statusFilter === tab.key ? 600 : 400,
                color: statusFilter === tab.key ? 'var(--accent)' : 'var(--text-muted)',
                backgroundColor: 'transparent',
                border: 'none',
                borderBottom:
                  statusFilter === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
                cursor: 'pointer',
                transition: 'color 0.15s, border-color 0.15s',
              }}
            >
              {tab.label}
              <span
                style={{
                  marginLeft: 4,
                  fontSize: 10,
                  color: statusFilter === tab.key ? 'var(--accent)' : 'var(--text-muted)',
                  opacity: 0.7,
                }}
              >
                {statusCounts[tab.key]}
              </span>
            </button>
          ))}
        </div>

        {/* Sort / Group / Filter controls */}
        <div
          style={{
            padding: '6px 12px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as SortOrder)}
            aria-label="Sort order"
            style={{
              padding: '3px 6px',
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 10,
            }}
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="status">By Status</option>
          </select>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            aria-label="Group by"
            style={{
              padding: '3px 6px',
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 10,
            }}
          >
            <option value="none">No grouping</option>
            <option value="project">Group by Project</option>
            <option value="machine">Group by Machine</option>
          </select>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 10,
              color: 'var(--text-muted)',
              cursor: 'pointer',
              marginLeft: 'auto',
            }}
          >
            <input
              type="checkbox"
              checked={hideEmpty}
              onChange={(e) => setHideEmpty(e.target.checked)}
              style={{ width: 12, height: 12, cursor: 'pointer' }}
            />
            Hide empty
          </label>
        </div>

        {/* Inline "New Session" creation form */}
        {showCreateForm && (
          <div
            style={{
              padding: '14px 16px',
              borderBottom: '1px solid var(--border)',
              backgroundColor: 'var(--bg-secondary)',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
              Create New Session
            </div>

            {/* Machine selector */}
            <label
              htmlFor="create-session-machine"
              style={{
                display: 'block',
                fontSize: 11,
                color: 'var(--text-muted)',
                marginBottom: 4,
              }}
            >
              Machine
            </label>
            <select
              id="create-session-machine"
              value={formMachineId}
              onChange={(e) => setFormMachineId(e.target.value)}
              disabled={machinesLoading}
              style={{
                width: '100%',
                padding: '6px 8px',
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 12,
                marginBottom: 10,
                outline: 'none',
              }}
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
              style={{
                display: 'block',
                fontSize: 11,
                color: 'var(--text-muted)',
                marginBottom: 4,
              }}
            >
              Project Path
            </label>
            <input
              id="create-session-project"
              type="text"
              value={formProjectPath}
              onChange={(e) => setFormProjectPath(e.target.value)}
              placeholder="/home/user/project"
              style={{
                width: '100%',
                padding: '6px 8px',
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                marginBottom: 10,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />

            {/* Prompt */}
            <label
              htmlFor="create-session-prompt"
              style={{
                display: 'block',
                fontSize: 11,
                color: 'var(--text-muted)',
                marginBottom: 4,
              }}
            >
              Prompt
            </label>
            <textarea
              id="create-session-prompt"
              value={formPrompt}
              onChange={(e) => setFormPrompt(e.target.value)}
              placeholder="What should Claude work on?"
              rows={3}
              style={{
                width: '100%',
                padding: '6px 8px',
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 12,
                marginBottom: 10,
                outline: 'none',
                resize: 'vertical',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />

            {/* Model selector */}
            <label
              htmlFor="create-session-model"
              style={{
                display: 'block',
                fontSize: 11,
                color: 'var(--text-muted)',
                marginBottom: 4,
              }}
            >
              Model (optional)
            </label>
            <select
              id="create-session-model"
              value={formModel}
              onChange={(e) => setFormModel(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 8px',
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 12,
                marginBottom: 12,
                outline: 'none',
              }}
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            {/* Error / Success feedback */}
            {formError && (
              <div
                style={{
                  padding: '6px 8px',
                  backgroundColor: '#7f1d1d',
                  color: '#fca5a5',
                  fontSize: 12,
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: 10,
                }}
              >
                {formError}
              </div>
            )}
            {/* Submit button */}
            <button
              type="button"
              onClick={() => void handleCreateSession()}
              disabled={
                formSubmitting || !formMachineId || !formProjectPath.trim() || !formPrompt.trim()
              }
              style={{
                width: '100%',
                padding: '7px 14px',
                backgroundColor: 'var(--accent)',
                color: '#fff',
                borderRadius: 'var(--radius-sm)',
                fontSize: 12,
                fontWeight: 500,
                opacity:
                  formSubmitting || !formMachineId || !formProjectPath.trim() || !formPrompt.trim()
                    ? 0.5
                    : 1,
                cursor:
                  formSubmitting || !formMachineId || !formProjectPath.trim() || !formPrompt.trim()
                    ? 'not-allowed'
                    : 'pointer',
              }}
            >
              {formSubmitting ? 'Creating...' : 'Create Session'}
            </button>
          </div>
        )}

        <div style={{ flex: 1, overflow: 'auto' }}>
          {filteredSessions.length === 0 ? (
            <div
              style={{
                padding: 32,
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: 13,
              }}
            >
              {sessions.isLoading
                ? 'Loading...'
                : searchQuery || statusFilter !== 'all'
                  ? 'No matching sessions'
                  : 'No sessions found'}
            </div>
          ) : groupedSessions ? (
            Array.from(groupedSessions.entries()).map(([groupKey, groupItems]) => (
              <div key={groupKey}>
                <button
                  type="button"
                  onClick={() => toggleGroupCollapsed(groupKey)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: 'var(--bg-secondary)',
                    borderBottom: '1px solid var(--border)',
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      transition: 'transform 0.15s',
                      transform: collapsedGroups.has(groupKey) ? 'rotate(-90deg)' : 'rotate(0deg)',
                      fontSize: 10,
                    }}
                  >
                    &#x25BC;
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {groupKey}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                    {groupItems.length}
                  </span>
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
        </div>
      </div>

      {/* Session detail panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {selected ? (
          <>
            {/* Header */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    marginBottom: 4,
                  }}
                >
                  Session: {selected.id.slice(0, 20)}...
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    display: 'flex',
                    gap: 12,
                  }}
                >
                  <span>Agent: {selected.agentId}</span>
                  <span>Machine: {selected.machineId}</span>
                  <StatusBadge status={selected.status} />
                </div>
              </div>
              <button
                type="button"
                onClick={handleStop}
                style={{
                  padding: '6px 14px',
                  backgroundColor: '#7f1d1d',
                  color: '#fca5a5',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                End Session
              </button>
            </div>

            {/* Session metadata */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border)',
                fontSize: 13,
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 8,
                }}
              >
                <DetailRow label="ID" value={selected.id} mono />
                <DetailRow label="Status" value={selected.status} />
                <DetailRow label="Agent" value={selected.agentId} mono />
                <DetailRow label="Machine" value={selected.machineId} mono />
                <DetailRow label="Project" value={selected.projectPath ?? '-'} mono />
                <DetailRow label="Claude Session" value={selected.claudeSessionId ?? '-'} mono />
                <DetailRow label="PID" value={selected.pid ? String(selected.pid) : '-'} mono />
                <DetailRow label="Started" value={new Date(selected.startedAt).toLocaleString()} />
                {selected.endedAt && (
                  <DetailRow label="Ended" value={new Date(selected.endedAt).toLocaleString()} />
                )}
                <DetailRow
                  label="Duration"
                  value={formatDuration(selected.startedAt, selected.endedAt)}
                />
              </div>

              {/* Error message display */}
              {selected.status === 'error' && selected.metadata && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '8px 10px',
                    backgroundColor: 'rgba(127, 29, 29, 0.3)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: 'var(--radius-sm)',
                    color: '#fca5a5',
                    fontSize: 12,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>Error: </span>
                  {(selected.metadata as Record<string, unknown>).errorMessage
                    ? String((selected.metadata as Record<string, unknown>).errorMessage)
                    : 'Unknown error'}
                </div>
              )}

              {/* Starting state indicator */}
              {selected.status === 'starting' && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '8px 10px',
                    backgroundColor: 'rgba(234, 179, 8, 0.1)',
                    border: '1px solid rgba(234, 179, 8, 0.2)',
                    borderRadius: 'var(--radius-sm)',
                    color: '#facc15',
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span style={{ animation: 'fadeInUp 1s ease infinite alternate' }}>&#x25CF;</span>
                  Session is starting... Waiting for worker to respond.
                </div>
              )}
            </div>

            {/* Session content viewer */}
            {selected.claudeSessionId && selected.machineId && (
              <SessionContent
                sessionId={selected.claudeSessionId}
                machineId={selected.machineId}
                projectPath={selected.projectPath ?? undefined}
                isActive={selected.status === 'active' || selected.status === 'starting'}
              />
            )}

            {!selected.claudeSessionId && (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                  fontSize: 13,
                }}
              >
                No conversation content available
              </div>
            )}

            {/* Prompt input */}
            <div
              style={{
                padding: '12px 20px',
                borderTop: '1px solid var(--border)',
                display: 'flex',
                gap: 8,
              }}
            >
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
                  selected.status === 'active' ? 'Send message...' : 'Resume session with prompt...'
                }
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={sending || !prompt.trim()}
                style={{
                  padding: '8px 18px',
                  backgroundColor: 'var(--accent)',
                  color: '#fff',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                  fontWeight: 500,
                  opacity: sending || !prompt.trim() ? 0.5 : 1,
                }}
              >
                {sending ? '...' : selected.status === 'active' ? 'Send' : 'Resume'}
              </button>
            </div>
          </>
        ) : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontSize: 14,
            }}
          >
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
  const shortPath = shortenPath(s.projectPath);
  return (
    <button
      type="button"
      onClick={() => onSelect(s.id)}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '12px 16px',
        backgroundColor: isSelected ? 'var(--bg-hover)' : 'transparent',
        borderBottom: '1px solid var(--border)',
        borderLeft:
          s.status === 'error'
            ? '3px solid var(--red-subtle, #ef4444)'
            : s.status === 'starting'
              ? '3px solid var(--yellow-subtle, #eab308)'
              : s.status === 'active'
                ? '3px solid var(--green-subtle, #22c55e)'
                : '3px solid transparent',
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 4,
        }}
      >
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500 }}>
          {s.id.slice(0, 16)}...
        </span>
        <StatusBadge status={s.status} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 8 }}>
        <span>{s.agentId}</span>
        <span>{s.machineId}</span>
      </div>
      {shortPath && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)',
            marginTop: 2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {shortPath}
        </div>
      )}
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          marginTop: 2,
          display: 'flex',
          gap: 8,
        }}
      >
        <span>{timeAgo(s.startedAt)}</span>
        <span style={{ color: 'var(--text-secondary)' }}>
          {formatDuration(s.startedAt, s.endedAt)}
        </span>
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

  const handleCopy = useCallback(() => {
    if (!mono || value === '-') return;
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [mono, value]);

  return (
    <div>
      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{label}</span>
      <div
        style={{
          fontFamily: mono ? 'var(--font-mono)' : undefined,
          fontSize: 12,
          wordBreak: 'break-all',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 4,
        }}
      >
        <span style={{ flex: 1 }}>{value}</span>
        {mono && value !== '-' && (
          <button
            type="button"
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy to clipboard'}
            style={{
              flexShrink: 0,
              padding: '1px 4px',
              fontSize: 10,
              color: copied ? 'var(--green)' : 'var(--text-muted)',
              backgroundColor: copied ? 'var(--bg-tertiary)' : 'transparent',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              opacity: copied ? 1 : 0.5,
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '1';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = copied ? '1' : '0.5';
            }}
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

const MSG_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  human: { label: 'You', color: '#818cf8', bg: 'rgba(99, 102, 241, 0.08)' },
  assistant: { label: 'Claude', color: '#4ade80', bg: 'rgba(34, 197, 94, 0.06)' },
  tool_use: { label: 'Tool', color: '#facc15', bg: 'rgba(234, 179, 8, 0.04)' },
  tool_result: { label: 'Result', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.04)' },
};

const CONTENT_POLL_MS = 5_000;

function SessionContent({
  sessionId,
  machineId,
  projectPath,
  isActive,
}: {
  sessionId: string;
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
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
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
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Controls */}
      <div
        style={{
          padding: '6px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {data ? `${messages.length} messages${showTools ? '' : ' (conversations only)'}` : ''}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={() => setShowTools(!showTools)}
            style={{
              padding: '3px 8px',
              backgroundColor: showTools ? 'var(--accent)' : 'var(--bg-tertiary)',
              color: showTools ? '#fff' : 'var(--text-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 10,
              cursor: 'pointer',
            }}
          >
            {showTools ? 'Hide Tools' : 'Show Tools'}
          </button>
          <button
            type="button"
            onClick={() => void fetchContent()}
            style={{
              padding: '3px 8px',
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 10,
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Content */}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '8px 20px' }}>
        {loading && (
          <div
            style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}
          >
            Loading conversation...
          </div>
        )}
        {error && (
          <div
            style={{
              padding: '8px 12px',
              backgroundColor: '#7f1d1d',
              color: '#fca5a5',
              borderRadius: 'var(--radius-sm)',
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}
        {data && messages.length === 0 && !loading && (
          <div
            style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}
          >
            No messages yet
          </div>
        )}
        {messages.map((msg, i) => (
          <InlineMessage key={`${msg.type}-${String(i)}`} message={msg} />
        ))}
      </div>
    </div>
  );
}

const TRUNCATE_THRESHOLD = 800;

function InlineMessage({ message }: { message: SessionContentMessage }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const style = MSG_STYLES[message.type] ?? {
    label: message.type,
    color: 'var(--text-muted)',
    bg: 'var(--bg-secondary)',
  };
  const isTool = message.type === 'tool_use' || message.type === 'tool_result';
  const isLong = message.content.length > TRUNCATE_THRESHOLD;
  const displayContent =
    isLong && !expanded ? `${message.content.slice(0, TRUNCATE_THRESHOLD)}...` : message.content;

  return (
    <div
      style={{
        marginBottom: 6,
        padding: '6px 10px',
        backgroundColor: style.bg,
        borderRadius: 'var(--radius-sm)',
        borderLeft: `2px solid ${style.color}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: style.color }}>{style.label}</span>
        {message.toolName && (
          <span
            style={{
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)',
            }}
          >
            {message.toolName}
          </span>
        )}
        {message.timestamp && (
          <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 'auto' }}>
            {new Date(message.timestamp).toLocaleTimeString()}
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: isTool ? 11 : 12,
          lineHeight: 1.5,
          color: 'var(--text-primary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: isTool ? 'var(--font-mono)' : undefined,
          maxHeight: expanded ? 'none' : isTool ? 150 : 400,
          overflow: expanded ? 'visible' : 'auto',
        }}
      >
        {displayContent}
      </div>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          style={{
            marginTop: 4,
            padding: '2px 8px',
            fontSize: 10,
            color: 'var(--accent)',
            backgroundColor: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          {expanded
            ? 'Show less'
            : `Show all (${Math.round(message.content.length / 1000)}k chars)`}
        </button>
      )}
    </div>
  );
}
