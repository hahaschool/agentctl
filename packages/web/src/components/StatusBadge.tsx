import type React from 'react';

type StatusConfig = {
  color: string;
  bg: string;
  pulse?: boolean;
};

const STATUS_MAP: Record<string, StatusConfig> = {
  online: { color: 'var(--green)', bg: 'var(--green-subtle)', pulse: true },
  running: { color: 'var(--green)', bg: 'var(--green-subtle)', pulse: true },
  active: { color: 'var(--green)', bg: 'var(--green-subtle)', pulse: true },
  ok: { color: 'var(--green)', bg: 'var(--green-subtle)' },
  registered: { color: 'var(--accent)', bg: 'var(--accent-subtle)' },
  starting: { color: 'var(--yellow)', bg: 'var(--yellow-subtle)', pulse: true },
  stopping: { color: 'var(--yellow)', bg: 'var(--yellow-subtle)' },
  degraded: { color: 'var(--yellow)', bg: 'var(--yellow-subtle)' },
  paused: { color: 'var(--orange)', bg: 'rgba(249, 115, 22, 0.1)' },
  offline: { color: 'var(--text-muted)', bg: 'transparent' },
  stopped: { color: 'var(--text-muted)', bg: 'transparent' },
  idle: { color: 'var(--text-muted)', bg: 'transparent' },
  ended: { color: 'var(--text-muted)', bg: 'transparent' },
  error: { color: 'var(--red)', bg: 'var(--red-subtle)' },
  timeout: { color: 'var(--red)', bg: 'var(--red-subtle)' },
};

const DEFAULT_CONFIG: StatusConfig = { color: 'var(--text-muted)', bg: 'transparent' };

export function StatusBadge({ status }: { status: string }): React.JSX.Element {
  const cfg = STATUS_MAP[status] ?? DEFAULT_CONFIG;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11,
        fontWeight: 500,
        color: cfg.color,
        backgroundColor: cfg.bg,
        padding: '2px 8px',
        borderRadius: 'var(--radius-sm)',
        textTransform: 'capitalize',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: cfg.color,
          flexShrink: 0,
          boxShadow: cfg.pulse ? `0 0 4px ${cfg.color}` : undefined,
        }}
      />
      {status}
    </span>
  );
}
