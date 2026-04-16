'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  CalendarClock,
  Compass,
  Database,
  ExternalLink,
  FileClock,
  Gauge,
  GitMerge,
  ListTree,
  Menu,
  MessageSquare,
  Moon,
  Network,
  Plus,
  Rocket,
  ScrollText,
  Server,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sun,
  UserCog,
  Webhook,
  Wifi,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { useNotificationContext } from '../contexts/notification-context';
import { useHotkeys } from '../hooks/use-hotkeys';
import { useWebSocket } from '../hooks/use-websocket';
import { KEYBOARD_HELP_OPEN_EVENT } from '../lib/keyboard-shortcuts';
import {
  formatVersionGroups,
  groupPeerVersions,
  type SyncPeerWithVersion,
  useLocalVersion,
} from '../lib/mesh-version';
import { syncConflictCountQuery, syncPeersQuery } from '../lib/queries';
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
  shortcut?: string;
  /** Second key of the `g`-prefix chord (e.g. 'd' for "g d" → Dashboard). */
  goKey?: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: Gauge, shortcut: '1', goKey: 'd' },
  { href: '/machines', label: 'Machines', icon: Server, shortcut: '2', goKey: 'm' },
  { href: '/agents', label: 'Agents', icon: Bot, shortcut: '3', goKey: 'a' },
  { href: '/agent-profiles', label: 'Agent Profiles', icon: UserCog, goKey: 'p' },
  { href: '/sessions', label: 'Sessions', icon: MessageSquare, shortcut: '4', goKey: 's' },
  { href: '/discover', label: 'Discover', icon: Compass, shortcut: '5', goKey: 'i' },
  { href: '/logs', label: 'Logs', icon: ScrollText, shortcut: '6', goKey: 'l' },
  { href: '/settings', label: 'Settings', icon: Settings, shortcut: '7', goKey: 'e' },
  { href: '/approvals', label: 'Approvals', icon: ShieldCheck, goKey: 'v' },
  { href: '/memory', label: 'Memory', icon: Database, shortcut: '8', goKey: 'y' },
  { href: '/spaces', label: 'Spaces', icon: Network, shortcut: '9', goKey: 'x' },
  { href: '/tasks', label: 'Tasks', icon: ListTree, goKey: 't' },
  { href: '/scheduler', label: 'Scheduler', icon: CalendarClock, goKey: 'c' },
  { href: '/deployment', label: 'Deployment', icon: Rocket, shortcut: '0', goKey: 'u' },
  { href: '/conflicts', label: 'Conflicts', icon: GitMerge, goKey: 'f' },
  { href: '/mesh-peers', label: 'Mesh Peers', icon: Wifi, goKey: 'n' },
  { href: '/security-findings', label: 'Security', icon: ShieldAlert, goKey: 'r' },
  { href: '/audit', label: 'Audit', icon: FileClock, goKey: 'q' },
  { href: '/webhooks', label: 'Webhooks', icon: Webhook, goKey: 'w' },
];

const SHORTCUT_MAP: Record<string, string> = {};
const SIDEBAR_GO_MAP: Record<string, string> = {};
for (const item of NAV_ITEMS) {
  if (item.shortcut) {
    SHORTCUT_MAP[item.shortcut] = item.href;
  }
  if (item.goKey) {
    SIDEBAR_GO_MAP[item.goKey] = item.href;
  }
}

export const SIDEBAR_NAV_ITEMS = NAV_ITEMS;
export const SIDEBAR_GO_KEY_MAP = SIDEBAR_GO_MAP;

export function Sidebar(): React.JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const localVersion = useLocalVersion();
  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const toast = useToast();
  const { notifications, unreadCount, markRead, markAllRead, clearAll } = useNotificationContext();
  const queryClient = useQueryClient();
  const conflictCount = useQuery(syncConflictCountQuery());
  const pendingConflicts = conflictCount.data?.count ?? 0;

  // Peer versions for the footer tooltip (33.9 Mesh Version Observability).
  // Lazy: only fetch once the user focuses or hovers the version link so pages
  // that don't mock /api/sync/peers (e2e specs, embeds) boot cleanly.
  const [peerSummaryArmed, setPeerSummaryArmed] = useState(false);
  const armPeerSummary = useCallback(() => setPeerSummaryArmed(true), []);
  const syncPeers = useQuery({ ...syncPeersQuery(), enabled: peerSummaryArmed });
  const peerVersionSummary = useMemo(() => {
    const peers = (syncPeers.data?.peers ?? []) as SyncPeerWithVersion[];
    const externalPeers = peers.filter((p) => !p.isSelf);
    const groups = groupPeerVersions(externalPeers);
    if (groups.length === 0) return '';
    return formatVersionGroups(groups);
  }, [syncPeers.data]);

  const versionLinkTitle = peerVersionSummary
    ? `Local ${localVersion} • Peers: ${peerVersionSummary}`
    : `Local ${localVersion} • No peer versions reported yet`;

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
      if (msg.type === 'permission_request_created' || msg.type === 'permission_request_resolved') {
        queryClient.invalidateQueries({ queryKey: ['permission-requests'] });
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

  // Two-key sequence support: "g" followed by a nav goKey.
  const pendingKeyRef = useRef<string | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closePanels = useCallback((): void => {
    setMobileOpen(false);
    setShowHelp(false);
    setShowCommandPalette(false);
  }, []);

  const openKeyboardHelp = useCallback((): void => {
    setShowHelp(true);
  }, []);

  useEffect(() => {
    window.addEventListener(KEYBOARD_HELP_OPEN_EVENT, openKeyboardHelp);
    return () => window.removeEventListener(KEYBOARD_HELP_OPEN_EVENT, openKeyboardHelp);
  }, [openKeyboardHelp]);

  const isSettingsPath = useMemo(
    () => pathname.startsWith('/settings') || /^\/agents\/[^/]+\/settings$/.test(pathname),
    [pathname],
  );

  const triggerSettingsSave = useCallback((): boolean => {
    if (!isSettingsPath) return false;

    const saveButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter(
      (button) => {
        if (button.disabled) return false;
        const label = button.textContent?.trim().toLowerCase() ?? '';
        if (!label.startsWith('save')) return false;

        const panel = button.closest<HTMLElement>('[role="tabpanel"]');
        if (
          panel &&
          (panel.hasAttribute('hidden') || panel.getAttribute('data-state') === 'inactive')
        ) {
          return false;
        }

        const style = window.getComputedStyle(button);
        return style.display !== 'none' && style.visibility !== 'hidden';
      },
    );

    const saveButton = saveButtons[0];
    if (!saveButton) return false;
    saveButton.click();
    return true;
  }, [isSettingsPath]);

  useHotkeys(
    useMemo(
      () => ({
        'mod+k': (e: KeyboardEvent) => {
          e.preventDefault();
          setShowCommandPalette((prev) => !prev);
        },
        'mod+n': (e: KeyboardEvent) => {
          e.preventDefault();
          router.push('/agents?new=1');
        },
        'mod+s': (e: KeyboardEvent) => {
          if (!isSettingsPath) return;
          e.preventDefault();
          triggerSettingsSave();
        },
        Escape: () => {
          closePanels();
        },
      }),
      [closePanels, isSettingsPath, router, triggerSettingsSave],
    ),
    { enableOnFormTags: true },
  );

  // Keyboard shortcuts: number navigation, go sequences, help overlay toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // Handle second key of "g + X" sequence
      if (pendingKeyRef.current === 'g') {
        pendingKeyRef.current = null;
        if (pendingTimerRef.current) {
          clearTimeout(pendingTimerRef.current);
          pendingTimerRef.current = null;
        }
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const goHref = SIDEBAR_GO_MAP[e.key];
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
        }, 1500);
        return;
      }

      if (e.key === 'Escape') {
        closePanels();
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
  }, [closePanels, router]);

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
          className="text-foreground p-2.5 -ml-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md active:bg-accent/10"
          aria-label="Toggle navigation"
          aria-expanded={mobileOpen}
          aria-controls="app-sidebar"
        >
          {mobileOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        </button>
        <span className="text-sm font-bold text-foreground tracking-tight">AgentCTL</span>
        <span className="text-[9px] text-primary-foreground bg-primary px-1.5 py-px rounded-sm font-semibold tracking-wider">
          BETA
        </span>
        <span className="ml-auto">
          <WsStatusIndicator status={wsStatus} compact />
        </span>
      </div>

      {/* Mobile backdrop */}
      <button
        type="button"
        className={cn(
          'md:hidden fixed inset-0 z-40 bg-black/50 transition-opacity duration-200',
          mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        onClick={() => setMobileOpen(false)}
        aria-label="Close navigation"
      />

      {/* Sidebar */}
      <nav
        id="app-sidebar"
        className={cn(
          'bg-sidebar border-r border-border flex flex-col py-4 shrink-0',
          // Desktop: always visible, fixed width
          'hidden md:flex md:w-[60px] md:min-w-[60px] lg:w-[220px] lg:min-w-[220px]',
          // Mobile: always rendered, slide in/out from left
          'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:flex max-md:w-[260px] max-md:shadow-lg max-md:pt-14',
          'max-md:transition-transform max-md:duration-200 max-md:ease-in-out',
          mobileOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full',
        )}
      >
        {/* Logo (desktop only, mobile has it in the top bar) */}
        <div className="px-5 pb-5 items-center gap-2 hidden md:flex md:justify-center lg:justify-start">
          <span className="text-lg font-bold text-foreground tracking-tight hidden lg:inline">
            AgentCTL
          </span>
          <span className="text-[10px] text-primary-foreground bg-primary px-1.5 py-px rounded-sm font-semibold tracking-wider hidden lg:inline">
            BETA
          </span>
          {/* Icon-only logo for medium screens */}
          <span className="text-lg font-bold text-foreground tracking-tight lg:hidden">A</span>
        </div>

        {NAV_ITEMS.map((item) => {
          const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <div key={item.href} className="relative flex items-center group/nav">
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2.5 px-5 py-3 md:justify-center lg:justify-start md:py-2.5 text-sm no-underline transition-all duration-150 min-h-[44px] md:min-h-0 flex-1 active:bg-accent/10',
                  'border-l-[3px]',
                  isActive
                    ? 'bg-accent/10 text-foreground font-semibold border-l-primary'
                    : 'bg-transparent text-muted-foreground font-normal border-l-transparent hover:bg-accent/5',
                )}
              >
                <span className="relative shrink-0">
                  <Icon size={16} aria-hidden="true" />
                  {item.href === '/conflicts' && pendingConflicts > 0 && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500 lg:hidden" />
                  )}
                </span>
                <span className="flex-1 max-md:inline hidden lg:inline">{item.label}</span>
                {item.shortcut && (
                  <span
                    className={cn(
                      'text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-px rounded-sm max-md:inline hidden lg:inline',
                      isActive ? 'opacity-80' : 'opacity-50',
                    )}
                  >
                    {item.shortcut}
                  </span>
                )}
                {item.href === '/conflicts' && pendingConflicts > 0 && (
                  <span className="ml-auto px-1.5 py-px rounded-full bg-red-500 text-white text-[10px] font-semibold leading-tight min-w-[18px] text-center max-md:inline hidden lg:inline">
                    {pendingConflicts}
                  </span>
                )}
              </Link>
              {item.href === '/sessions' && (
                <button
                  type="button"
                  aria-label="Quick session"
                  title="Quick session"
                  onClick={() => router.push('/sessions?create=true')}
                  className={cn(
                    'absolute right-2 p-0.5 rounded-md transition-all duration-150',
                    'text-muted-foreground/60 hover:text-primary hover:bg-primary/10',
                    'opacity-0 group-hover/nav:opacity-100 focus:opacity-100',
                    'hidden lg:flex items-center justify-center',
                    'min-w-[44px] min-h-[44px]',
                  )}
                >
                  <Plus size={14} aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}

        <div className="flex-1" />

        {/* Bottom section */}
        <div className="border-t border-border px-4 lg:px-4 md:px-2 py-3 space-y-2.5">
          {/* Connection + Notifications row */}
          <div className="flex items-center gap-3 md:flex-col md:gap-2 lg:flex-row lg:gap-3">
            <WsStatusIndicator status={wsStatus} compact />
            <div className="flex-1 max-md:block hidden lg:block" />
            <NotificationBell
              notifications={notifications}
              unreadCount={unreadCount}
              onMarkRead={markRead}
              onMarkAllRead={markAllRead}
              onClearAll={clearAll}
            />
            {unreadCount > 0 && (
              <span className="text-[10px] text-primary font-medium max-md:inline hidden lg:inline">
                {unreadCount}
              </span>
            )}
          </div>

          {/* Keyboard hints (hidden on medium, shown on large) */}
          <div className="text-[10px] text-muted-foreground/60 leading-relaxed flex-wrap gap-x-3 gap-y-0.5 hidden lg:flex">
            <span>
              <Kbd>1</Kbd>-<Kbd>9</Kbd>, <Kbd>0</Kbd> Nav
            </span>
            <span>
              <Kbd>g</Kbd> <Kbd>x</Kbd> Go-to
            </span>
            <span>
              <Kbd>{'\u2318'}K</Kbd> Search
            </span>
            <span>
              <Kbd>?</Kbd> Help
            </span>
          </div>

          {/* Version + theme */}
          <div className="flex items-center justify-between md:justify-center lg:justify-between">
            <a
              href="https://github.com/hahaschool/agentctl/releases"
              target="_blank"
              rel="noopener noreferrer"
              title={versionLinkTitle}
              data-testid="sidebar-version-link"
              onMouseEnter={armPeerSummary}
              onFocus={armPeerSummary}
              className="text-[11px] font-mono text-muted-foreground hover:text-blue-500 transition-colors flex items-center gap-1 max-md:inline-flex hidden lg:flex"
            >
              {localVersion}
              <ExternalLink className="size-2.5" aria-hidden="true" />
            </a>
            {mounted ? (
              <button
                type="button"
                onClick={toggleTheme}
                className="text-muted-foreground/60 hover:text-foreground transition-colors p-2.5 md:p-1 rounded-md hover:bg-muted active:bg-muted min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center"
                aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              >
                {theme === 'dark' ? (
                  <Moon size={16} className="md:w-[13px] md:h-[13px]" aria-hidden="true" />
                ) : (
                  <Sun size={16} className="md:w-[13px] md:h-[13px]" aria-hidden="true" />
                )}
              </button>
            ) : (
              <span className="w-[44px] h-[44px] md:w-6 md:h-5" />
            )}
          </div>
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
