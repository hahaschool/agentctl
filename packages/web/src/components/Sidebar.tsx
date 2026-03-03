import type React from 'react';

export type Page = 'dashboard' | 'machines' | 'agents' | 'sessions' | 'discover' | 'logs';

const NAV_ITEMS: { key: Page; label: string; icon: string }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: '\u25A0' },
  { key: 'machines', label: 'Machines', icon: '\u2302' },
  { key: 'agents', label: 'Agents', icon: '\u2699' },
  { key: 'sessions', label: 'Sessions', icon: '\u25B6' },
  { key: 'discover', label: 'Discover', icon: '\u2315' },
  { key: 'logs', label: 'Logs', icon: '\u2261' },
];

export function Sidebar({
  activePage,
  onNavigate,
}: {
  activePage: Page;
  onNavigate: (page: Page) => void;
}): React.JSX.Element {
  return (
    <nav
      style={{
        width: 220,
        minWidth: 220,
        backgroundColor: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 0',
      }}
    >
      <div
        style={{
          padding: '0 20px 20px',
          fontSize: 18,
          fontWeight: 700,
          color: 'var(--text-primary)',
          letterSpacing: '-0.02em',
        }}
      >
        AgentCTL
      </div>

      {NAV_ITEMS.map((item) => {
        const isActive = activePage === item.key;
        return (
          <button
            type="button"
            key={item.key}
            onClick={() => onNavigate(item.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 20px',
              backgroundColor: isActive ? 'var(--bg-hover)' : 'transparent',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontSize: 14,
              fontWeight: isActive ? 600 : 400,
              borderLeft: isActive ? '3px solid var(--accent)' : '3px solid transparent',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <span style={{ fontSize: 16 }}>{item.icon}</span>
            {item.label}
          </button>
        );
      })}

      <div style={{ flex: 1 }} />

      <div
        style={{
          padding: '12px 20px',
          fontSize: 11,
          color: 'var(--text-muted)',
          borderTop: '1px solid var(--border)',
        }}
      >
        AgentCTL v0.1.0
      </div>
    </nav>
  );
}
