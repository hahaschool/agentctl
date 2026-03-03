import type React from 'react';

import { StatusBadge } from '../components/StatusBadge.tsx';
import { usePolling } from '../hooks/use-polling.ts';
import type { Machine } from '../lib/api.ts';
import { api } from '../lib/api.ts';

export function MachinesPage(): React.JSX.Element {
  const machines = usePolling<Machine[]>({
    fetcher: api.listMachines,
    intervalMs: 10_000,
  });

  const list = machines.data ?? [];
  const online = list.filter((m) => m.status === 'online').length;
  const offline = list.filter((m) => m.status !== 'online').length;

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Machines</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            Fleet machines connected via Tailscale mesh.
            {list.length > 0 && (
              <span>
                {' '}
                {online} online, {offline} offline
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={machines.refresh}
          style={{
            padding: '6px 14px',
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 13,
          }}
        >
          Refresh
        </button>
      </div>

      {machines.error && (
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
          {machines.error.message}
        </div>
      )}

      {list.length === 0 ? (
        <div
          style={{
            padding: 48,
            textAlign: 'center',
            color: 'var(--text-muted)',
          }}
        >
          {machines.isLoading ? 'Loading machines...' : 'No machines registered'}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: 12,
          }}
        >
          {list.map((m) => (
            <div
              key={m.id}
              style={{
                padding: 16,
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 10,
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 15 }}>{m.hostname}</span>
                <StatusBadge status={m.status} />
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 8,
                  fontSize: 12,
                }}
              >
                <Info label="ID" value={m.id} mono />
                <Info label="Tailscale IP" value={m.tailscaleIp} mono />
                <Info label="OS" value={m.os} />
                <Info label="Arch" value={m.arch} />
                <Info
                  label="Last Heartbeat"
                  value={m.lastHeartbeat ? new Date(m.lastHeartbeat).toLocaleString() : 'never'}
                />
                <Info label="Registered" value={new Date(m.createdAt).toLocaleString()} />
              </div>

              {m.capabilities && (
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: '1px solid var(--border)',
                    display: 'flex',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <CapBadge label="GPU" enabled={m.capabilities.gpu} />
                  <CapBadge label="Docker" enabled={m.capabilities.docker} />
                  <CapBadge
                    label={`Max ${m.capabilities.maxConcurrentAgents} agents`}
                    enabled={true}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Info({
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
        {value}
      </div>
    </div>
  );
}

function CapBadge({ label, enabled }: { label: string; enabled: boolean }): React.JSX.Element {
  return (
    <span
      style={{
        padding: '2px 8px',
        fontSize: 11,
        borderRadius: 'var(--radius-sm)',
        backgroundColor: enabled ? '#14532d' : 'var(--bg-tertiary)',
        color: enabled ? '#86efac' : 'var(--text-muted)',
        border: `1px solid ${enabled ? '#166534' : 'var(--border)'}`,
      }}
    >
      {label}
    </span>
  );
}
