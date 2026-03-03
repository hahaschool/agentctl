import type React from 'react';
import { useCallback, useMemo, useState } from 'react';

import { CopyableText } from '../components/CopyableText.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { useToast } from '../components/Toast.tsx';
import { usePolling } from '../hooks/use-polling.ts';
import type { Agent, Machine } from '../lib/api.ts';
import { api } from '../lib/api.ts';
import { formatCost, timeAgo } from '../lib/format-utils.ts';

const AGENT_TYPES = ['autonomous', 'adhoc', 'scheduled'] as const;

type AgentSortOrder = 'name' | 'status' | 'lastRun' | 'cost';
type AgentStatusFilter = 'all' | 'running' | 'registered' | 'stopped' | 'error';

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AgentsPage(): React.JSX.Element {
  const toast = useToast();
  const agents = usePolling<Agent[]>({
    fetcher: api.listAgents,
    intervalMs: 10_000,
  });

  const machines = usePolling<Machine[]>({
    fetcher: api.listMachines,
    intervalMs: 30_000,
  });

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createMachineId, setCreateMachineId] = useState('');
  const [createType, setCreateType] = useState<string>('autonomous');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);

  const [promptAgentId, setPromptAgentId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');

  // -- Filter / Sort state --
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<AgentStatusFilter>('all');
  const [sortOrder, setSortOrder] = useState<AgentSortOrder>('name');

  const agentList = agents.data ?? [];
  const machineList = machines.data ?? [];

  // Summary stats
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const agent of agentList) {
      counts[agent.status] = (counts[agent.status] ?? 0) + 1;
    }
    return counts;
  }, [agentList]);

  // Filtered + sorted list
  const filteredAgents = useMemo(() => {
    let list = agentList;

    // Status filter
    if (statusFilter !== 'all') {
      list = list.filter((a) => a.status === statusFilter);
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.id.toLowerCase().includes(q) ||
          a.machineId.toLowerCase().includes(q) ||
          (a.projectPath ?? '').toLowerCase().includes(q),
      );
    }

    // Sort
    const sorted = [...list];
    switch (sortOrder) {
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'status':
        sorted.sort((a, b) => a.status.localeCompare(b.status));
        break;
      case 'lastRun':
        sorted.sort((a, b) => {
          const ta = a.lastRunAt ? new Date(a.lastRunAt).getTime() : 0;
          const tb = b.lastRunAt ? new Date(b.lastRunAt).getTime() : 0;
          return tb - ta;
        });
        break;
      case 'cost':
        sorted.sort((a, b) => (b.totalCostUsd ?? 0) - (a.totalCostUsd ?? 0));
        break;
    }

    return sorted;
  }, [agentList, statusFilter, search, sortOrder]);

  // -- Create agent handler --
  const handleCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!createName.trim() || !createMachineId) return;

      setCreateError(null);
      setCreateLoading(true);
      try {
        await api.createAgent({
          name: createName.trim(),
          machineId: createMachineId,
          type: createType,
        });
        toast.success(`Agent "${createName.trim()}" created`);
        setCreateName('');
        setCreateMachineId('');
        setCreateType('autonomous');
        setShowCreateForm(false);
        agents.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setCreateLoading(false);
      }
    },
    [createName, createMachineId, createType, agents, toast],
  );

  // -- Start agent handler --
  const handleStart = useCallback(
    async (agentId: string) => {
      if (!prompt.trim()) return;
      try {
        await api.startAgent(agentId, prompt.trim());
        toast.success('Agent started');
        setPrompt('');
        setPromptAgentId(null);
        agents.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    },
    [prompt, agents, toast],
  );

  // -- Stop agent handler --
  const handleStop = useCallback(
    async (agentId: string) => {
      try {
        await api.stopAgent(agentId);
        toast.success('Agent stopped');
        agents.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    },
    [agents, toast],
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
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Agents</h1>
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-muted)',
              marginTop: 4,
            }}
          >
            {agentList.length} agent{agentList.length !== 1 ? 's' : ''} registered
            {Object.keys(statusCounts).length > 0 && (
              <span>
                {' '}
                &mdash;{' '}
                {Object.entries(statusCounts)
                  .map(([status, count]) => `${count} ${status}`)
                  .join(', ')}
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={agents.refresh}
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
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowCreateForm((prev) => !prev)}
            style={{
              padding: '6px 14px',
              backgroundColor: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {showCreateForm ? 'Cancel' : 'Create Agent'}
          </button>
        </div>
      </div>

      {/* Error banners */}
      {agents.error && (
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
          {agents.error.message}
        </div>
      )}

      {/* Inline create form */}
      {showCreateForm && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          style={{
            padding: 16,
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            marginBottom: 20,
          }}
        >
          <h3
            style={{
              fontSize: 14,
              fontWeight: 600,
              marginBottom: 12,
            }}
          >
            New Agent
          </h3>

          {createError && (
            <div
              style={{
                padding: '8px 12px',
                backgroundColor: '#7f1d1d',
                color: '#fca5a5',
                borderRadius: 'var(--radius-sm)',
                marginBottom: 12,
                fontSize: 12,
              }}
            >
              {createError}
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 12,
              alignItems: 'end',
            }}
          >
            <div>
              <label
                htmlFor="create-agent-name"
                style={{
                  display: 'block',
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: 4,
                }}
              >
                Name
              </label>
              <input
                id="create-agent-name"
                type="text"
                required
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="my-agent"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label
                htmlFor="create-agent-machine"
                style={{
                  display: 'block',
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: 4,
                }}
              >
                Machine
              </label>
              <select
                id="create-agent-machine"
                required
                value={createMachineId}
                onChange={(e) => setCreateMachineId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              >
                <option value="">Select machine...</option>
                {machineList.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.hostname} ({m.id})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="create-agent-type"
                style={{
                  display: 'block',
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: 4,
                }}
              >
                Type
              </label>
              <select
                id="create-agent-type"
                value={createType}
                onChange={(e) => setCreateType(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              >
                {AGENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="submit"
              disabled={createLoading || !createName.trim() || !createMachineId}
              style={{
                padding: '8px 20px',
                backgroundColor: 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                fontSize: 13,
                fontWeight: 500,
                cursor:
                  createLoading || !createName.trim() || !createMachineId
                    ? 'not-allowed'
                    : 'pointer',
                opacity: createLoading || !createName.trim() || !createMachineId ? 0.5 : 1,
              }}
            >
              {createLoading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {/* Filter / Sort controls */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <input
          type="text"
          placeholder="Search agents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: '6px 10px',
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
            outline: 'none',
            minWidth: 180,
          }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as AgentStatusFilter)}
          style={{
            padding: '6px 10px',
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
          }}
        >
          <option value="all">All statuses</option>
          <option value="running">Running</option>
          <option value="registered">Registered</option>
          <option value="stopped">Stopped</option>
          <option value="error">Error</option>
        </select>
        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as AgentSortOrder)}
          style={{
            padding: '6px 10px',
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
          }}
        >
          <option value="name">Sort: Name</option>
          <option value="status">Sort: Status</option>
          <option value="lastRun">Sort: Last run</option>
          <option value="cost">Sort: Total cost</option>
        </select>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {filteredAgents.length}/{agentList.length} agents
        </span>
      </div>

      {/* Summary stats */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <StatCard
          label="Total Agents"
          value={String(agentList.length)}
          color="var(--text-primary)"
        />
        {Object.entries(statusCounts).map(([status, count]) => (
          <StatCard
            key={status}
            label={status.charAt(0).toUpperCase() + status.slice(1)}
            value={String(count)}
            color={statusColor(status)}
          />
        ))}
      </div>

      {/* Agent cards grid */}
      {filteredAgents.length === 0 ? (
        <div
          style={{
            padding: 48,
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 14,
          }}
        >
          {agents.isLoading
            ? 'Loading agents...'
            : agentList.length === 0
              ? 'No agents registered'
              : 'No agents match the current filters'}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
            gap: 12,
          }}
        >
          {filteredAgents.map((agent) => (
            <div
              key={agent.id}
              style={{
                padding: 16,
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
              }}
            >
              {/* Card header: name + status */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12,
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 15 }}>{agent.name}</span>
                <StatusBadge status={agent.status} />
              </div>

              {/* Card details */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 8,
                  fontSize: 12,
                }}
              >
                <Info label="ID" value={agent.id} mono copyable />
                <Info label="Machine" value={agent.machineId} mono copyable />
                <Info label="Type" value={agent.type} />
                {agent.projectPath && <Info label="Project" value={agent.projectPath} mono />}
                {agent.worktreeBranch && <Info label="Branch" value={agent.worktreeBranch} mono />}
                {agent.schedule && <Info label="Schedule" value={agent.schedule} mono />}
              </div>

              {/* Cost + Last run */}
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 12,
                }}
              >
                <div style={{ display: 'flex', gap: 16 }}>
                  <span style={{ color: 'var(--text-muted)' }}>
                    Last: {formatCost(agent.lastCostUsd)}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    Total: {formatCost(agent.totalCostUsd)}
                  </span>
                </div>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                  {agent.lastRunAt ? timeAgo(agent.lastRunAt) : 'never run'}
                </span>
              </div>

              {/* Actions */}
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: '1px solid var(--border)',
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                {agent.status === 'running' ? (
                  <button
                    type="button"
                    onClick={() => void handleStop(agent.id)}
                    style={{
                      padding: '6px 14px',
                      backgroundColor: '#7f1d1d',
                      color: '#fca5a5',
                      border: '1px solid #991b1b',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    Stop
                  </button>
                ) : promptAgentId === agent.id ? (
                  <>
                    <input
                      id={`prompt-${agent.id}`}
                      type="text"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleStart(agent.id);
                        if (e.key === 'Escape') {
                          setPromptAgentId(null);
                          setPrompt('');
                        }
                      }}
                      placeholder="Enter prompt..."
                      style={{
                        flex: 1,
                        padding: '6px 10px',
                        backgroundColor: 'var(--bg-tertiary)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: 12,
                        outline: 'none',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => void handleStart(agent.id)}
                      disabled={!prompt.trim()}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: 'var(--accent)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: prompt.trim() ? 'pointer' : 'not-allowed',
                        opacity: prompt.trim() ? 1 : 0.5,
                      }}
                    >
                      Go
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPromptAgentId(null);
                        setPrompt('');
                      }}
                      style={{
                        padding: '6px 10px',
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
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setPromptAgentId(agent.id);
                      setPrompt('');
                    }}
                    style={{
                      padding: '6px 14px',
                      backgroundColor: 'var(--accent)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    Start
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function statusColor(status: string): string {
  switch (status) {
    case 'running':
    case 'online':
    case 'active':
      return 'var(--green)';
    case 'starting':
    case 'stopping':
      return 'var(--yellow)';
    case 'error':
      return 'var(--red, #ef4444)';
    default:
      return 'var(--text-muted)';
  }
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}): React.JSX.Element {
  return (
    <div
      style={{
        padding: '14px 16px',
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function Info({
  label,
  value,
  mono,
  copyable,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copyable?: boolean;
}): React.JSX.Element {
  return (
    <div>
      <span
        style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </span>
      <div
        style={{
          marginTop: 1,
          fontFamily: mono ? 'var(--font-mono)' : undefined,
          fontSize: 12,
          wordBreak: 'break-all',
        }}
      >
        {copyable ? <CopyableText value={value} maxDisplay={12} fontSize={12} /> : value}
      </div>
    </div>
  );
}
