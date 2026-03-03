import type React from 'react';

const STATUS_COLORS: Record<string, string> = {
  online: 'var(--green)',
  running: 'var(--green)',
  active: 'var(--green)',
  ok: 'var(--green)',
  registered: 'var(--accent)',
  starting: 'var(--yellow)',
  stopping: 'var(--yellow)',
  degraded: 'var(--yellow)',
  paused: 'var(--orange)',
  offline: 'var(--text-muted)',
  stopped: 'var(--text-muted)',
  idle: 'var(--text-muted)',
  ended: 'var(--text-muted)',
  error: 'var(--red)',
  timeout: 'var(--red)',
};

export function StatusBadge({ status }: { status: string }): React.JSX.Element {
  const color = STATUS_COLORS[status] ?? 'var(--text-muted)';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        fontWeight: 500,
        color,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          backgroundColor: color,
          flexShrink: 0,
        }}
      />
      {status}
    </span>
  );
}
