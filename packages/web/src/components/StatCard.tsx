import type React from 'react';

type Props = {
  label: string;
  value: string;
  color: string;
  sublabel?: string;
};

export function StatCard({ label, value, color, sublabel }: Props): React.JSX.Element {
  return (
    <div
      style={{
        padding: '16px 18px',
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
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
      {sublabel && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{sublabel}</div>
      )}
    </div>
  );
}
