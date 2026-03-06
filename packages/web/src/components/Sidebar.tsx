'use client';

import {
  Gauge,
  Server,
  Bot,
  MessageSquare,
  Compass,
  ScrollText,
  Settings,
  Moon,
  Sun,
  Menu,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { useNotificationContext } from '../contexts/notification-context';
import { useWebSocket } from '../hooks/use-websocket';
import { CommandPalette } from './CommandPalette';
import { ConnectionBanner } from './ConnectionBanner';
import { KeyboardHelpOverlay } from './KeyboardHelpOverlay';
import { NotificationBell } from './NotificationBell';
import { useToast } from './Toast';
import { WsStatusIndicator } from './WsStatusIndicator';

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  shortcut: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: Gauge, shortcut: '1' },
  { href: '/machines', label: 'Machines', icon: Server, shortcut: '2' },
  { href: '/agents', label: 'Agents', icon: Bot, shortcut: '3' },
  { href: '/sessions', label: 'Sessions', icon: MessageSquare, shortcut: '4' },
  { href: '/discover', label: 'Discover', icon: Compass, shortcut: '5' },
  { href: '/logs', label: 'Logs', icon: ScrollText, shortcut: '6' },
  { href: '/settings', label: 'Settings', icon: Settings, shortcut: '7' },
];

const SHORTCUT_MAP: Record<string, string> = {};
for (const item of NAV_ITEMS) {
  SHORTCUT_MAP[item.shortcut] = item.href;
}

export function Sidebar(): React.JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const toast = useToast();
  const { notifications, unreadCount, markRead, markAllRead, clearAll } = useNotificationContext();

  // Track WS connection for reconnect/disconnect toasts (skip initial connect)
  const wasConnectedRef = useRef(false);
  const { status: wsStatus } = useWebSocket({
    onOpen: () => {
      if (wasConnectedRef.current) {
        toast.success('Reconnected to control plane');
      }
      wasConnectedRef.current = true;
    },
    onClose: () => {
      if (wasConnectedRef.current) {
        toast.error('Lost connection to control plane');
      }
    },
    onMessage: (msg) => {
      if (msg.type === 'error') {
        toast.error(msg.message);
      }
    },
  });

  useEffect(() => setMounted(true), []);

  // Close mobile menu on route change
  const prevPathRef = useRef(pathname);
  useEffect(() => {
    if (prevPathRef.current !== pathname) {
      prevPathRef.current = pathname;
      setMobileOpen(false);
    }
  }, [pathname]);

  // Two-key sequence support: "g" followed by d/s/a/m
  const pendingKeyRef = useRef<string | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const GO_MAP: Record<string, string> = {
    d: '/',
    s: '/sessions',
    a: '/agents',
    m: '/machines',
  };

  // Keyboard shortcuts: 1-7 to navigate pages, Cmd+K for command palette, Esc to close
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // Cmd+K / Ctrl+K — command palette (works even in inputs)
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
        return;
      }

      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // Handle second key of "g + X" sequence
      if (pendingKeyRef.current === 'g') {
        pendingKeyRef.current = null;
        if (pendingTimerRef.current) {
          clearTimeout(pendingTimerRef.current);
          pendingTimerRef.current = null;
        }
        const goHref = GO_MAP[e.key];
        if (goHref) {
          e.preventDefault();
          router.push(goHref);
          return;
        }
      }

      // Start "g" sequence
      if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        pendingKeyRef.current = 'g';
        if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = setTimeout(() => {
          pendingKeyRef.current = null;
          pendingTimerRef.current = null;
        }, 500);
        return;
      }

      if (e.key === 'Escape') {
        setMobileOpen(false);
        setShowHelp(false);
        return;
      }

      if (e.key === '?') {
        setShowHelp((prev) => !prev);
        return;
      }

      const href = SHORTCUT_MAP[e.key];
      if (href) {
        e.preventDefault();
        router.push(href);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [router]);

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
          className="text-foreground p-1 -ml-1"
          aria-label="Toggle navigation"
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
        <span className="text-sm font-bold text-foreground tracking-tight">AgentCTL</span>
        <span className="text-[9px] text-primary bg-primary/10 px-1.5 py-px rounded-sm font-semibold tracking-wider">
          BETA
        </span>
        <span className="ml-auto">
          <WsStatusIndicator status={wsStatus} compact />
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
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 px-5 py-3 md:py-2.5 text-sm no-underline transition-all duration-150 min-h-[44px] md:min-h-0',
                'border-l-[3px]',
                isActive
                  ? 'bg-accent/10 text-foreground font-semibold border-l-primary'
                  : 'bg-transparent text-muted-foreground font-normal border-l-transparent hover:bg-accent/5',
              )}
            >
              <Icon size={16} className="shrink-0" />
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
          <div className="mb-0.5 font-medium text-[10px] text-muted-foreground/70">Shortcuts</div>
          <div>
            <Kbd>1</Kbd>-<Kbd>7</Kbd> Navigate
          </div>
          <div>
            <Kbd>{'\u2318'}K</Kbd> Command palette
          </div>
          <div>
            <Kbd>Esc</Kbd> Close panels
          </div>
        </div>

        <div className="px-5 py-1.5 border-t border-border hidden md:flex items-center gap-2">
          <WsStatusIndicator status={wsStatus} compact />
        </div>

        <div className="px-5 py-1.5 border-t border-border hidden md:flex items-center">
          <NotificationBell
            notifications={notifications}
            unreadCount={unreadCount}
            onMarkRead={markRead}
            onMarkAllRead={markAllRead}
            onClearAll={clearAll}
          />
          <span className="ml-2 text-[11px] text-muted-foreground">
            {unreadCount > 0 ? `${unreadCount} new` : 'Notifications'}
          </span>
        </div>

        <div className="px-5 py-2.5 border-t border-border flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">AgentCTL v0.1.0</span>
          {mounted ? (
            <button
              type="button"
              onClick={toggleTheme}
              className="text-muted-foreground hover:text-foreground transition-colors duration-150 p-1 rounded-sm hover:bg-muted"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
            </button>
          ) : (
            <span className="w-6 h-5" />
          )}
        </div>
      </nav>

      <KeyboardHelpOverlay open={showHelp} onClose={() => setShowHelp(false)} />
      <CommandPalette open={showCommandPalette} onClose={() => setShowCommandPalette(false)} />
      <ConnectionBanner status={wsStatus} />
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
