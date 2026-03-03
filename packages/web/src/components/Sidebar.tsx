'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type React from 'react';
import { useEffect } from 'react';

type NavItem = {
  href: string;
  label: string;
  icon: string;
  shortcut: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: '\u25A0', shortcut: '1' },
  { href: '/machines', label: 'Machines', icon: '\u2302', shortcut: '2' },
  { href: '/agents', label: 'Agents', icon: '\u2699', shortcut: '3' },
  { href: '/sessions', label: 'Sessions', icon: '\u25B6', shortcut: '4' },
  { href: '/discover', label: 'Discover', icon: '\u2315', shortcut: '5' },
  { href: '/logs', label: 'Logs', icon: '\u2261', shortcut: '6' },
];

const SHORTCUT_MAP: Record<string, string> = {};
for (const item of NAV_ITEMS) {
  SHORTCUT_MAP[item.shortcut] = item.href;
}

export function Sidebar(): React.JSX.Element {
  const pathname = usePathname();

  // Keyboard shortcuts: 1-6 to navigate pages
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const href = SHORTCUT_MAP[e.key];
      if (href) {
        e.preventDefault();
        window.history.pushState(null, '', href);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

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
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: 'var(--text-primary)',
            letterSpacing: '-0.02em',
          }}
        >
          AgentCTL
        </span>
        <span
          style={{
            fontSize: 10,
            color: 'var(--accent)',
            backgroundColor: 'rgba(59, 130, 246, 0.12)',
            padding: '1px 6px',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 600,
            letterSpacing: '0.04em',
          }}
        >
          BETA
        </span>
      </div>

      {NAV_ITEMS.map((item) => {
        const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
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
              textDecoration: 'none',
            }}
          >
            <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{item.icon}</span>
            <span style={{ flex: 1 }}>{item.label}</span>
            <span
              style={{
                fontSize: 10,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)',
                backgroundColor: 'var(--bg-tertiary)',
                padding: '1px 5px',
                borderRadius: 'var(--radius-sm)',
                opacity: isActive ? 0.8 : 0.5,
              }}
            >
              {item.shortcut}
            </span>
          </Link>
        );
      })}

      <div style={{ flex: 1 }} />

      <div
        style={{
          padding: '8px 20px',
          fontSize: 11,
          color: 'var(--text-muted)',
          lineHeight: 1.6,
        }}
      >
        <div
          style={{
            marginBottom: 2,
            fontWeight: 500,
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Shortcuts
        </div>
        <div>
          <kbd style={kbdStyle}>1</kbd>-<kbd style={kbdStyle}>6</kbd> Navigate
        </div>
        <div>
          <kbd style={kbdStyle}>Esc</kbd> Close panels
        </div>
      </div>

      <div
        style={{
          padding: '10px 20px',
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

const kbdStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '0 4px',
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  backgroundColor: 'var(--bg-tertiary)',
  borderRadius: 2,
  border: '1px solid var(--border)',
  lineHeight: '16px',
  minWidth: 16,
  textAlign: 'center',
};
