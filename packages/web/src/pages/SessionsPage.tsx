import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { StatusBadge } from '../components/StatusBadge.tsx';
import { usePolling } from '../hooks/use-polling.ts';
import type { Machine, Session } from '../lib/api.ts';
import { api } from '../lib/api.ts';

const MODEL_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
];

type StatusFilter = 'all' | 'active' | 'completed' | 'ended';

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'ended', label: 'Ended' },
];

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function shortenProjectPath(path: string | null): string | null {
  if (!path) return null;
  const homePrefixes = ['/Users/', '/home/', '/root'];
  let shortened = path;

  for (const prefix of homePrefixes) {
    if (shortened.startsWith(prefix)) {
      if (prefix === '/root') {
        shortened = `~${shortened.slice('/root'.length)}`;
      } else {
        const afterPrefix = shortened.slice(prefix.length);
        const slashIdx = afterPrefix.indexOf('/');
        if (slashIdx >= 0) {
          shortened = `~${afterPrefix.slice(slashIdx)}`;
        } else {
          shortened = '~';
        }
      }
      break;
    }
  }

  const segments = shortened.split('/').filter(Boolean);
  if (segments.length <= 2) return shortened;

  const startsWithTilde = shortened.startsWith('~');
  const lastTwo = segments.slice(-2).join('/');
  return startsWithTilde ? `~/${lastTwo}` : lastTwo;
}

function matchesStatusFilter(status: string, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
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
  const sessions = usePolling<Session[]>({
    fetcher: api.listSessions,
    intervalMs: 5_000,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

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
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

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
    setFormSuccess(null);
  }, []);

  const handleCreateSession = useCallback(async () => {
    setFormError(null);
    setFormSuccess(null);

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
      setFormSuccess(`Session created: ${result.sessionId.slice(0, 16)}...`);
      resetForm();
      setShowCreateForm(false);
      sessions.refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setFormSubmitting(false);
    }
  }, [formMachineId, formProjectPath, formPrompt, formModel, resetForm, sessions]);

  const sessionList = sessions.data ?? [];

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: sessionList.length,
      active: 0,
      completed: 0,
      ended: 0,
    };
    for (const s of sessionList) {
      if (s.status === 'active') counts.active++;
      else if (s.status === 'completed') counts.completed++;
      else if (s.status === 'ended') counts.ended++;
    }
    return counts;
  }, [sessionList]);

  const filteredSessions = useMemo(() => {
    return sessionList.filter(
      (s) => matchesStatusFilter(s.status, statusFilter) && matchesSearchQuery(s, searchQuery),
    );
  }, [sessionList, statusFilter, searchQuery]);

  const selected = sessionList.find((s) => s.id === selectedId) ?? null;

  const handleSend = useCallback(async () => {
    if (!selected || !prompt.trim()) return;
    setSending(true);
    setActionError(null);
    try {
      if (selected.status === 'active') {
        await api.sendMessage(selected.id, prompt.trim());
      } else {
        await api.resumeSession(selected.id, prompt.trim());
      }
      setPrompt('');
      sessions.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }, [selected, prompt, sessions]);

  const handleStop = useCallback(async () => {
    if (!selected) return;
    setActionError(null);
    try {
      await api.deleteSession(selected.id);
      sessions.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [selected, sessions]);

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
                setFormSuccess(null);
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
            {formSuccess && (
              <div
                style={{
                  padding: '6px 8px',
                  backgroundColor: '#14532d',
                  color: '#86efac',
                  fontSize: 12,
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: 10,
                }}
              >
                {formSuccess}
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
          ) : (
            filteredSessions.map((s) => {
              const shortPath = shortenProjectPath(s.projectPath);
              return (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 16px',
                    backgroundColor: selectedId === s.id ? 'var(--bg-hover)' : 'transparent',
                    borderBottom: '1px solid var(--border)',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => {
                    if (selectedId !== s.id)
                      e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                  }}
                  onMouseLeave={(e) => {
                    if (selectedId !== s.id) e.currentTarget.style.backgroundColor = 'transparent';
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
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                    >
                      {s.id.slice(0, 16)}...
                    </span>
                    <StatusBadge status={s.status} />
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      display: 'flex',
                      gap: 8,
                    }}
                  >
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
                    }}
                  >
                    {formatRelativeTime(s.startedAt)}
                  </div>
                </button>
              );
            })
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
              </div>
            </div>

            {/* Action area */}
            <div style={{ flex: 1 }} />

            {actionError && (
              <div
                style={{
                  padding: '8px 20px',
                  backgroundColor: '#7f1d1d',
                  color: '#fca5a5',
                  fontSize: 12,
                }}
              >
                {actionError}
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

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <div>
      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{label}</span>
      <div
        style={{
          fontFamily: mono ? 'var(--font-mono)' : undefined,
          fontSize: 12,
          wordBreak: 'break-all',
        }}
      >
        {value}
      </div>
    </div>
  );
}
