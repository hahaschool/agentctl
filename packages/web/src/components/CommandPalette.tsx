'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BellOff,
  Bot,
  Compass,
  Gauge,
  HelpCircle,
  MessageSquare,
  Moon,
  Plus,
  RefreshCw,
  ScrollText,
  Server,
  Settings,
  StopCircle,
  Sun,
  Terminal,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import type React from 'react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from '@/components/Toast';

import { fuzzyScore } from '@/lib/fuzzy-search';
import { agentsQuery, machinesQuery, sessionsQuery, useDeleteSession } from '@/lib/queries';
import { cn } from '@/lib/utils';

type IconComponent = React.ComponentType<{ size?: number; className?: string }>;

type CommandItem = {
  id: string;
  label: string;
  description?: string;
  icon: string | IconComponent;
  shortcut?: string;
  badge?: { text: string; variant: 'default' | 'success' | 'warning' | 'destructive' };
  action: () => void;
  section: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

const NAV_COMMANDS = [
  { href: '/', label: 'Dashboard', icon: Gauge, shortcut: '1', section: 'Navigate' },
  { href: '/machines', label: 'Machines', icon: Server, shortcut: '2', section: 'Navigate' },
  { href: '/agents', label: 'Agents', icon: Bot, shortcut: '3', section: 'Navigate' },
  { href: '/sessions', label: 'Sessions', icon: MessageSquare, shortcut: '4', section: 'Navigate' },
  {
    href: '/discover',
    label: 'Discover Sessions',
    icon: Compass,
    shortcut: '5',
    section: 'Navigate',
  },
  { href: '/logs', label: 'Logs & Metrics', icon: ScrollText, shortcut: '6', section: 'Navigate' },
  { href: '/settings', label: 'Settings', icon: Settings, shortcut: '7', section: 'Navigate' },
] as const;

const STATUS_BADGE_VARIANTS: Record<string, 'default' | 'success' | 'warning' | 'destructive'> = {
  running: 'success',
  active: 'success',
  online: 'success',
  idle: 'default',
  stopped: 'default',
  offline: 'destructive',
  error: 'destructive',
  failed: 'destructive',
  completed: 'default',
  paused: 'warning',
  starting: 'warning',
  degraded: 'warning',
};

function badgeVariant(status: string): 'default' | 'success' | 'warning' | 'destructive' {
  return STATUS_BADGE_VARIANTS[status.toLowerCase()] ?? 'default';
}

/**
 * Score a command item against a query by checking label, description,
 * section, badge text, and id. Returns the best score or null.
 */
function scoreCommand(cmd: CommandItem, query: string): number | null {
  let best: number | null = null;

  const fields = [cmd.label, cmd.description, cmd.section, cmd.badge?.text, cmd.id];

  for (const field of fields) {
    if (!field) continue;
    const s = fuzzyScore(query, field);
    if (s !== null && (best === null || s > best)) {
      best = s;
    }
  }

  return best;
}

/** Truncate long paths to a readable suffix. */
function shortPath(path: string | null, maxLen = 30): string {
  if (!path) return '';
  if (path.length <= maxLen) return path;
  return `...${path.slice(path.length - maxLen + 3)}`;
}

export function CommandPalette({ open, onClose }: Props): React.JSX.Element | null {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const deleteSession = useDeleteSession();
  const optionIdPrefix = useId().replaceAll(':', '');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  // Fetch agents, machines, and sessions (only when palette is open)
  const { data: agents } = useQuery({
    ...agentsQuery(),
    enabled: open,
  });
  const { data: machines } = useQuery({
    ...machinesQuery(),
    enabled: open,
  });
  const { data: sessions } = useQuery({
    ...sessionsQuery(),
    enabled: open,
  });

  // Build command list
  const commands: CommandItem[] = useMemo(() => {
    const items: CommandItem[] = [];

    // ----- Navigation commands -----
    for (const nav of NAV_COMMANDS) {
      items.push({
        id: `nav-${nav.href}`,
        label: nav.label,
        icon: nav.icon,
        shortcut: nav.shortcut,
        section: nav.section,
        action: () => {
          router.push(nav.href);
          onClose();
        },
      });
    }

    // ----- Agents (recent, up to 8) -----
    if (agents && agents.length > 0) {
      const sorted = [...agents].sort(
        (a, b) =>
          new Date(b.lastRunAt ?? b.createdAt).getTime() -
          new Date(a.lastRunAt ?? a.createdAt).getTime(),
      );
      for (const agent of sorted.slice(0, 8)) {
        items.push({
          id: `agent-${agent.id}`,
          label: agent.name || agent.id,
          description: agent.projectPath ? shortPath(agent.projectPath) : agent.type,
          icon: Bot,
          badge: { text: agent.status, variant: badgeVariant(agent.status) },
          section: 'Agents',
          action: () => {
            router.push(`/agents/${agent.id}`);
            onClose();
          },
        });
      }
    }

    // ----- Machines (by hostname) -----
    if (machines && machines.length > 0) {
      const sorted = [...machines].sort(
        (a, b) =>
          new Date(b.lastHeartbeat ?? b.createdAt).getTime() -
          new Date(a.lastHeartbeat ?? a.createdAt).getTime(),
      );
      for (const machine of sorted.slice(0, 8)) {
        items.push({
          id: `machine-${machine.id}`,
          label: machine.hostname,
          description: `${machine.os}/${machine.arch} \u2014 ${machine.tailscaleIp}`,
          icon: Server,
          badge: { text: machine.status, variant: badgeVariant(machine.status) },
          section: 'Machines',
          action: () => {
            router.push(`/machines/${machine.id}`);
            onClose();
          },
        });
      }
    }

    // ----- Sessions (recent, up to 8) -----
    const sessionList = sessions?.sessions ?? [];
    if (sessionList.length > 0) {
      const sorted = [...sessionList].sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      );
      for (const session of sorted.slice(0, 8)) {
        const shortId = session.id.length > 12 ? `${session.id.slice(0, 8)}...` : session.id;
        const label = session.agentName ? `${session.agentName} \u2014 ${shortId}` : shortId;
        items.push({
          id: `session-${session.id}`,
          label,
          description: session.projectPath ? shortPath(session.projectPath) : undefined,
          icon: MessageSquare,
          badge: { text: session.status, variant: badgeVariant(session.status) },
          section: 'Sessions',
          action: () => {
            router.push(`/sessions/${session.id}`);
            onClose();
          },
        });
      }
    }

    // ----- Stop active sessions -----
    if (sessionList.length > 0) {
      const activeSessions = sessionList.filter(
        (s) => s.status === 'active' || s.status === 'starting',
      );
      for (const session of activeSessions.slice(0, 5)) {
        const shortId = session.id.length > 12 ? `${session.id.slice(0, 8)}...` : session.id;
        const label = session.agentName
          ? `Stop: ${session.agentName} — ${shortId}`
          : `Stop: ${shortId}`;
        items.push({
          id: `stop-${session.id}`,
          label,
          description: session.projectPath ? shortPath(session.projectPath) : undefined,
          icon: StopCircle,
          badge: { text: session.status, variant: badgeVariant(session.status) },
          section: 'Actions',
          action: () => {
            deleteSession.mutate(session.id, {
              onSuccess: () => toast.success(`Session ${shortId} stopped`),
              onError: (err) => toast.error(err.message),
            });
            onClose();
          },
        });
      }
    }

    // ----- Action commands -----
    items.push({
      id: 'action-new-session',
      label: 'New Session',
      description: 'Create a new agent session',
      icon: Plus,
      section: 'Actions',
      action: () => {
        router.push('/sessions?create=true');
        onClose();
      },
    });

    if (machines && machines.length > 0) {
      for (const machine of machines.filter((m) => m.status === 'online')) {
        items.push({
          id: `terminal-${machine.id}`,
          label: `Terminal: ${machine.hostname}`,
          description: 'Open interactive terminal',
          icon: Terminal,
          section: 'Actions',
          action: () => {
            router.push(`/machines/${machine.id}/terminal`);
            onClose();
          },
        });
      }
    }

    items.push({
      id: 'action-refresh',
      label: 'Refresh All Data',
      description: 'Invalidate all cached queries',
      icon: RefreshCw,
      section: 'Actions',
      action: () => {
        void queryClient.invalidateQueries();
        toast.success('All data refreshed');
        onClose();
      },
    });

    items.push({
      id: 'action-theme',
      label: 'Toggle Dark/Light Mode',
      icon: theme === 'dark' ? Sun : Moon,
      section: 'Actions',
      shortcut: 'Theme',
      action: () => {
        setTheme(theme === 'dark' ? 'light' : 'dark');
        onClose();
      },
    });

    items.push({
      id: 'action-clear-notifications',
      label: 'Clear Notifications',
      description: 'Dismiss all toast messages',
      icon: BellOff,
      section: 'Actions',
      action: () => {
        toast.dismiss();
        onClose();
      },
    });

    items.push({
      id: 'action-help',
      label: 'Keyboard Shortcuts',
      icon: HelpCircle,
      section: 'Actions',
      shortcut: '?',
      action: () => {
        // Close palette, then trigger help
        onClose();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
      },
    });

    return items;
  }, [router, onClose, theme, setTheme, agents, machines, sessions, queryClient, deleteSession]);

  // Filter commands by fuzzy query and sort by match score
  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const scored: { cmd: CommandItem; score: number }[] = [];
    for (const cmd of commands) {
      const s = scoreCommand(cmd, query.trim());
      if (s !== null) {
        scored.push({ cmd, score: s });
      }
    }
    // Sort descending by score (best matches first)
    scored.sort((a, b) => b.score - a.score);
    return scored.map((entry) => entry.cmd);
  }, [commands, query]);

  // Group by section with stable ordering
  const sections = useMemo(() => {
    const sectionOrder = ['Navigate', 'Agents', 'Machines', 'Sessions', 'Actions'];
    const map = new Map<string, CommandItem[]>();
    for (const cmd of filtered) {
      const arr = map.get(cmd.section);
      if (arr) {
        arr.push(cmd);
      } else {
        map.set(cmd.section, [cmd]);
      }
    }
    // Return in stable order
    const ordered = new Map<string, CommandItem[]>();
    for (const section of sectionOrder) {
      const items = map.get(section);
      if (items) ordered.set(section, items);
    }
    // Add any remaining sections not in the predefined order
    for (const [section, items] of map) {
      if (!ordered.has(section)) ordered.set(section, items);
    }
    return ordered;
  }, [filtered]);

  // Reset active index when filter changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset index when result count changes
  useEffect(() => {
    setActiveIndex(0);
  }, [filtered.length]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      // Slight delay for animation
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Close on Escape, navigate on Arrow/Enter
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filtered[activeIndex];
        if (cmd) cmd.action();
      }
    },
    [filtered, activeIndex, onClose],
  );

  // Scroll active item into view
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when active index changes
  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.querySelector('[data-active="true"]');
    if (active) {
      active.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  if (!open) return null;

  let flatIndex = 0;
  const activeOptionId =
    filtered.length > 0 ? `${optionIdPrefix}-command-option-${activeIndex}` : undefined;

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm border-none"
        onClick={onClose}
        aria-label="Close command palette"
      />

      {/* Panel */}
      <div
        className="relative w-full max-w-[520px] mx-4 bg-card border border-border rounded-lg shadow-xl overflow-hidden animate-fade-in"
        role="dialog"
        aria-label="Command palette"
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <span className="text-muted-foreground text-sm">{'\u2315'}</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search agents, machines, sessions..."
            aria-label="Search commands"
            className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden sm:inline px-1.5 py-0.5 text-[10px] font-mono bg-muted text-muted-foreground border border-border rounded-sm">
            Esc
          </kbd>
        </div>

        {/* Command list */}
        <div
          ref={listRef}
          className="max-h-[360px] overflow-auto py-1"
          role="listbox"
          aria-label="Commands"
          aria-activedescendant={activeOptionId}
          tabIndex={-1}
        >
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-muted-foreground text-sm">
              No matching commands
            </div>
          )}

          {Array.from(sections.entries()).map(([section, items]) => (
            <div key={section}>
              <div className="px-4 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                {section}
              </div>
              {items.map((cmd) => {
                const idx = flatIndex++;
                const isActive = idx === activeIndex;
                const optionId = `${optionIdPrefix}-command-option-${idx}`;
                return (
                  <button
                    key={cmd.id}
                    id={optionId}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    data-active={isActive}
                    onClick={() => cmd.action()}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors duration-75 border-none',
                      isActive
                        ? 'bg-accent/15 text-foreground'
                        : 'bg-transparent text-muted-foreground hover:bg-accent/10',
                    )}
                  >
                    {typeof cmd.icon === 'string' ? (
                      <span className="w-5 text-center text-base shrink-0">{cmd.icon}</span>
                    ) : (
                      <cmd.icon size={16} className="w-5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="font-medium">{cmd.label}</span>
                      {cmd.description && (
                        <span className="ml-2 text-[11px] text-muted-foreground truncate">
                          {cmd.description}
                        </span>
                      )}
                    </span>
                    {cmd.badge && (
                      <span
                        className={cn(
                          'shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded-full',
                          cmd.badge.variant === 'success' && 'bg-emerald-500/15 text-emerald-500',
                          cmd.badge.variant === 'warning' && 'bg-amber-500/15 text-amber-500',
                          cmd.badge.variant === 'destructive' && 'bg-red-500/15 text-red-500',
                          cmd.badge.variant === 'default' && 'bg-muted text-muted-foreground',
                        )}
                      >
                        {cmd.badge.text}
                      </span>
                    )}
                    {cmd.shortcut && (
                      <kbd className="shrink-0 text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-px rounded-sm border border-border">
                        {cmd.shortcut}
                      </kbd>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-border text-[10px] text-muted-foreground flex gap-3">
          <span>
            <kbd className="font-mono bg-muted px-1 py-px rounded-sm border border-border">
              {'\u2191\u2193'}
            </kbd>{' '}
            Navigate
          </span>
          <span>
            <kbd className="font-mono bg-muted px-1 py-px rounded-sm border border-border">
              {'\u23CE'}
            </kbd>{' '}
            Select
          </span>
          <span>
            <kbd className="font-mono bg-muted px-1 py-px rounded-sm border border-border">Esc</kbd>{' '}
            Close
          </span>
          {filtered.length > 0 && (
            <span className="ml-auto">
              {filtered.length} result{filtered.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
