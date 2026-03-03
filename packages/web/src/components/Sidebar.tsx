'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

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
  { href: '/settings', label: 'Settings', icon: '\u2630', shortcut: '7' },
];

const SHORTCUT_MAP: Record<string, string> = {};
for (const item of NAV_ITEMS) {
  SHORTCUT_MAP[item.shortcut] = item.href;
}

export function Sidebar(): React.JSX.Element {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => setMounted(true), []);

  // Close mobile menu on route change
  const prevPathRef = useRef(pathname);
  useEffect(() => {
    if (prevPathRef.current !== pathname) {
      prevPathRef.current = pathname;
      setMobileOpen(false);
    }
  });

  // Keyboard shortcuts: 1-7 to navigate pages, Esc to close mobile menu
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'Escape') {
        setMobileOpen(false);
        return;
      }

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

  const toggleTheme = useCallback((): void => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return (
    <>
      {/* Mobile header bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 h-12 bg-sidebar border-b border-border flex items-center px-4 gap-3">
        <button
          type="button"
          onClick={() => setMobileOpen(!mobileOpen)}
          className="text-foreground text-lg p-1"
          aria-label="Toggle navigation"
        >
          {mobileOpen ? '\u2715' : '\u2630'}
        </button>
        <span className="text-sm font-bold text-foreground tracking-tight">AgentCTL</span>
        <span className="text-[9px] text-primary bg-primary/10 px-1.5 py-px rounded-sm font-semibold tracking-wider">
          BETA
        </span>
      </div>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <button
          type="button"
          className="md:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        />
      )}

      {/* Sidebar */}
      <nav
        className={cn(
          'bg-sidebar border-r border-border flex flex-col py-4 shrink-0',
          // Desktop: always visible, fixed width
          'hidden md:flex w-[220px] min-w-[220px]',
          // Mobile: overlay from left
          mobileOpen &&
            'fixed inset-y-0 left-0 z-50 flex w-[260px] shadow-lg pt-14 md:relative md:pt-4 md:w-[220px] md:min-w-[220px] md:shadow-none',
        )}
      >
        {/* Logo (desktop only, mobile has it in the top bar) */}
        <div className="px-5 pb-5 items-center gap-2 hidden md:flex">
          <span className="text-lg font-bold text-foreground tracking-tight">AgentCTL</span>
          <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-px rounded-sm font-semibold tracking-wider">
            BETA
          </span>
        </div>

        {NAV_ITEMS.map((item) => {
          const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 px-5 py-2.5 text-sm no-underline transition-all duration-150',
                'border-l-[3px]',
                isActive
                  ? 'bg-accent/10 text-foreground font-semibold border-l-primary'
                  : 'bg-transparent text-muted-foreground font-normal border-l-transparent hover:bg-accent/5',
              )}
            >
              <span className="text-base w-5 text-center">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              <span
                className={cn(
                  'text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-px rounded-sm hidden md:inline',
                  isActive ? 'opacity-80' : 'opacity-50',
                )}
              >
                {item.shortcut}
              </span>
            </Link>
          );
        })}

        <div className="flex-1" />

        <div className="px-5 py-2 text-[11px] text-muted-foreground leading-relaxed hidden md:block">
          <div className="mb-0.5 font-medium text-[10px] uppercase tracking-wider">Shortcuts</div>
          <div>
            <Kbd>1</Kbd>-<Kbd>7</Kbd> Navigate
          </div>
          <div>
            <Kbd>Esc</Kbd> Close panels
          </div>
        </div>

        <div className="px-5 py-2.5 border-t border-border flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">AgentCTL v0.1.0</span>
          {mounted ? (
            <button
              type="button"
              onClick={toggleTheme}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-150 px-1.5 py-0.5 rounded-sm hover:bg-muted"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? '\u263D' : '\u2600'}
            </button>
          ) : (
            <span className="w-6 h-5" />
          )}
        </div>
      </nav>
    </>
  );
}

function Kbd({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <kbd className="inline-block px-1 text-[10px] font-mono bg-muted rounded-sm border border-border leading-4 min-w-4 text-center">
      {children}
    </kbd>
  );
}
