'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BellOff,
  Bot,
  Brain,
  Compass,
  Database,
  Gauge,
  HelpCircle,
  ListTree,
  MessageSquare,
  Moon,
  Network,
  Play,
  Plus,
  RefreshCw,
  Rocket,
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
import type { Session } from '@/lib/api';
import { fuzzyScore } from '@/lib/fuzzy-search';
import { agentsQuery, machinesQuery, sessionsQuery, useDeleteSession } from '@/lib/queries';

import {
  type CommandPaletteResultItem,
  type CommandPaletteResultSection,
  CommandPaletteSearchResults,
} from './CommandPaletteSearchResults';

type CommandItem = CommandPaletteResultItem & {
  section: string;
  keywords?: string[];
};

type Props = {
  open: boolean;
  onClose: () => void;
};

const NAV_COMMANDS = [
  { href: '/', label: 'Dashboard', icon: Gauge, shortcut: '1', section: 'Navigation' },
  { href: '/machines', label: 'Machines', icon: Server, shortcut: '2', section: 'Navigation' },
  { href: '/agents', label: 'Agents', icon: Bot, shortcut: '3', section: 'Navigation' },
  {
    href: '/sessions',
    label: 'Sessions',
    icon: MessageSquare,
    shortcut: '4',
    section: 'Navigation',
  },
  { href: '/discover', label: 'Discover', icon: Compass, shortcut: '5', section: 'Navigation' },
  { href: '/logs', label: 'Logs', icon: ScrollText, shortcut: '6', section: 'Navigation' },
  { href: '/settings', label: 'Settings', icon: Settings, shortcut: '7', section: 'Navigation' },
  { href: '/memory', label: 'Memory', icon: Database, shortcut: '8', section: 'Navigation' },
  { href: '/spaces', label: 'Spaces', icon: Network, shortcut: '9', section: 'Navigation' },
  { href: '/tasks', label: 'Tasks', icon: ListTree, section: 'Navigation' },
  {
    href: '/deployment',
    label: 'Deployment',
    icon: Rocket,
    shortcut: '0',
    section: 'Navigation',
  },
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

/** Truncate long paths to a readable suffix. */
function shortPath(path: string | null, maxLen = 30): string {
  if (!path) return '';
  if (path.length <= maxLen) return path;
  return `...${path.slice(path.length - maxLen + 3)}`;
}

/** Session summary for search and recent-session labels. */
function sessionSummary(session: Session): string {
  if (typeof session.metadata.summary === 'string' && session.metadata.summary.trim()) {
    return session.metadata.summary.trim();
  }
  if (typeof session.metadata.title === 'string' && session.metadata.title.trim()) {
    return session.metadata.title.trim();
  }
  if (session.agentName?.trim()) {
    return session.agentName.trim();
  }
  return `Session ${session.id.slice(0, 8)}`;
}

function shortSessionId(id: string, maxLen = 12): string {
  if (id.length <= maxLen) return id;
  return `${id.slice(0, 8)}...`;
}

function scoreFields(query: string, fields: Array<string | null | undefined>): number | null {
  let best: number | null = null;

  for (const field of fields) {
    if (!field) continue;
    const score = fuzzyScore(query, field);
    if (score !== null && (best === null || score > best)) {
      best = score;
    }
  }

  return best;
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

  // Build command list for default (empty query) mode.
  const commands: CommandItem[] = useMemo(() => {
    const items: CommandItem[] = [];

    // ----- Navigation -----
    for (const nav of NAV_COMMANDS) {
      items.push({
        id: `nav-${nav.href}`,
        label: nav.label,
        icon: nav.icon,
        shortcut: 'shortcut' in nav ? nav.shortcut : undefined,
        section: nav.section,
        keywords: [nav.label, nav.href, 'navigation'],
        action: () => {
          router.push(nav.href);
          onClose();
        },
      });
    }

    // ----- Agent actions (all agents) -----
    if (agents && agents.length > 0) {
      const sorted = [...agents].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
      for (const agent of sorted) {
        const name = agent.name || agent.id;
        const description = agent.projectPath ? shortPath(agent.projectPath, 40) : agent.type;
        const sharedTerms = [name, agent.id, agent.projectPath ?? '', agent.type, agent.status];

        items.push({
          id: `agent-start-${agent.id}`,
          label: `Start ${name}`,
          description,
          icon: Play,
          badge: { text: agent.status, variant: badgeVariant(agent.status) },
          section: 'Agent Actions',
          keywords: [...sharedTerms, 'start'],
          action: () => {
            router.push(`/agents/${agent.id}`);
            onClose();
          },
        });

        items.push({
          id: `agent-settings-${agent.id}`,
          label: `Settings ${name}`,
          description,
          icon: Settings,
          badge: { text: agent.status, variant: badgeVariant(agent.status) },
          section: 'Agent Actions',
          keywords: [...sharedTerms, 'settings'],
          action: () => {
            router.push(`/agents/${agent.id}/settings`);
            onClose();
          },
        });

        items.push({
          id: `agent-view-${agent.id}`,
          label: `View ${name}`,
          description,
          icon: Bot,
          badge: { text: agent.status, variant: badgeVariant(agent.status) },
          section: 'Agent Actions',
          keywords: [...sharedTerms, 'view'],
          action: () => {
            router.push(`/agents/${agent.id}`);
            onClose();
          },
        });
      }
    }

    // ----- Machines -----
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
          description: `${machine.os}/${machine.arch} - ${machine.tailscaleIp}`,
          icon: Server,
          badge: { text: machine.status, variant: badgeVariant(machine.status) },
          section: 'Machines',
          keywords: [machine.hostname, machine.id, machine.tailscaleIp, machine.os, machine.arch],
          action: () => {
            router.push(`/machines/${machine.id}`);
            onClose();
          },
        });
      }
    }

    // ----- Recent sessions (last 5) -----
    const sessionList = sessions?.sessions ?? [];
    if (sessionList.length > 0) {
      const sorted = [...sessionList].sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      );

      for (const session of sorted.slice(0, 5)) {
        const summary = sessionSummary(session);
        const desc = [shortSessionId(session.id)];
        if (session.projectPath) {
          desc.push(shortPath(session.projectPath, 28));
        }

        items.push({
          id: `recent-session-view-${session.id}`,
          label: `View ${summary}`,
          description: desc.join(' • '),
          icon: MessageSquare,
          badge: { text: session.status, variant: badgeVariant(session.status) },
          section: 'Recent Sessions',
          keywords: [summary, session.id, session.agentName ?? '', session.projectPath ?? ''],
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
        const shortId = shortSessionId(session.id);
        const label = session.agentName
          ? `Stop: ${session.agentName} - ${shortId}`
          : `Stop: ${shortId}`;
        items.push({
          id: `stop-${session.id}`,
          label,
          description: session.projectPath ? shortPath(session.projectPath) : undefined,
          icon: StopCircle,
          badge: { text: session.status, variant: badgeVariant(session.status) },
          section: 'Actions',
          keywords: ['stop', session.id, session.agentName ?? '', session.projectPath ?? ''],
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

    // ----- Memory commands -----
    items.push({
      id: 'memory-search',
      label: 'memory:search',
      description: 'Search memory facts',
      icon: Brain,
      section: 'Memory',
      keywords: ['memory', 'search', 'facts'],
      action: () => {
        router.push('/memory/browser');
        onClose();
      },
    });
    items.push({
      id: 'memory-create',
      label: 'memory:create',
      description: 'Create a new memory fact',
      icon: Brain,
      section: 'Memory',
      keywords: ['memory', 'create', 'fact'],
      action: () => {
        router.push('/memory/browser?create=true');
        onClose();
      },
    });
    items.push({
      id: 'memory-graph',
      label: 'memory:graph',
      description: 'View the memory knowledge graph',
      icon: Database,
      section: 'Memory',
      keywords: ['memory', 'graph', 'knowledge'],
      action: () => {
        router.push('/memory/graph');
        onClose();
      },
    });

    // ----- Actions -----
    items.push({
      id: 'action-new-session',
      label: 'New Session',
      description: 'Create a new agent session',
      icon: Plus,
      section: 'Actions',
      keywords: ['session', 'new', 'create'],
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
          keywords: [machine.hostname, machine.id, 'terminal'],
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
      keywords: ['refresh', 'cache', 'reload'],
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
      keywords: ['theme', 'dark', 'light'],
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
      keywords: ['notifications', 'clear', 'toast'],
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
      keywords: ['keyboard', 'shortcuts', 'help'],
      action: () => {
        onClose();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
      },
    });

    return items;
  }, [router, onClose, theme, setTheme, agents, machines, sessions, queryClient, deleteSession]);

  const commandSections = useMemo<CommandPaletteResultSection[]>(() => {
    const sectionOrder = [
      'Navigation',
      'Memory',
      'Agent Actions',
      'Machines',
      'Recent Sessions',
      'Actions',
    ];

    const map = new Map<string, CommandItem[]>();
    for (const command of commands) {
      const bucket = map.get(command.section);
      if (bucket) {
        bucket.push(command);
      } else {
        map.set(command.section, [command]);
      }
    }

    const ordered: CommandPaletteResultSection[] = [];

    for (const section of sectionOrder) {
      const items = map.get(section);
      if (items && items.length > 0) {
        ordered.push({ key: section, title: section, items });
      }
    }

    for (const [section, items] of map) {
      if (!sectionOrder.includes(section)) {
        ordered.push({ key: section, title: section, items });
      }
    }

    return ordered;
  }, [commands]);

  const searchSections = useMemo<CommandPaletteResultSection[]>(() => {
    const q = query.trim();
    if (!q) return [];

    const pages = NAV_COMMANDS.map((page) => {
      const score = scoreFields(q, [page.label, page.href]);
      if (score === null) return null;
      return {
        score,
        item: {
          id: `search-page-${page.href}`,
          label: page.label,
          description: page.href,
          icon: page.icon,
          shortcut: 'shortcut' in page ? page.shortcut : undefined,
          action: () => {
            router.push(page.href);
            onClose();
          },
        } as CommandPaletteResultItem,
      };
    })
      .filter((entry): entry is { score: number; item: CommandPaletteResultItem } => entry !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((entry) => entry.item);

    const agentResults = (agents ?? [])
      .map((agent) => {
        const name = agent.name || agent.id;
        const score = scoreFields(q, [name, agent.projectPath, agent.id, agent.type]);
        if (score === null) return null;
        return {
          score,
          item: {
            id: `search-agent-${agent.id}`,
            label: name,
            description: agent.projectPath ? shortPath(agent.projectPath, 40) : agent.id,
            icon: Bot,
            badge: { text: agent.status, variant: badgeVariant(agent.status) },
            action: () => {
              router.push(`/agents/${agent.id}`);
              onClose();
            },
          } as CommandPaletteResultItem,
        };
      })
      .filter((entry): entry is { score: number; item: CommandPaletteResultItem } => entry !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((entry) => entry.item);

    const sessionResults = (sessions?.sessions ?? [])
      .map((session) => {
        const summary = sessionSummary(session);
        const score = scoreFields(q, [summary, session.id, session.projectPath, session.agentName]);
        if (score === null) return null;
        return {
          score,
          item: {
            id: `search-session-${session.id}`,
            label: summary,
            description: `${session.id}${session.projectPath ? ` • ${shortPath(session.projectPath, 24)}` : ''}`,
            icon: MessageSquare,
            badge: { text: session.status, variant: badgeVariant(session.status) },
            action: () => {
              router.push(`/sessions/${session.id}`);
              onClose();
            },
          } as CommandPaletteResultItem,
        };
      })
      .filter((entry): entry is { score: number; item: CommandPaletteResultItem } => entry !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((entry) => entry.item);

    return [
      { key: 'agents', title: 'Agents', items: agentResults },
      { key: 'sessions', title: 'Sessions', items: sessionResults },
      { key: 'pages', title: 'Pages', items: pages },
    ].filter((section) => section.items.length > 0);
  }, [query, agents, sessions, router, onClose]);

  const isSearchMode = query.trim().length > 0;
  const visibleSections = isSearchMode ? searchSections : commandSections;

  const visibleItems = useMemo(
    () => visibleSections.flatMap((section) => section.items),
    [visibleSections],
  );

  // Reset active index when result count changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset index when result count changes
  useEffect(() => {
    setActiveIndex(0);
  }, [visibleItems.length]);

  // Focus input when opened.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (visibleItems.length === 0) return;
        setActiveIndex((prev) => (prev < visibleItems.length - 1 ? prev + 1 : 0));
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (visibleItems.length === 0) return;
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : visibleItems.length - 1));
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        const command = visibleItems[activeIndex];
        if (command) command.action();
      }
    },
    [visibleItems, activeIndex, onClose],
  );

  // Scroll active item into view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when active index changes
  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.querySelector('[data-active="true"]');
    if (active) {
      active.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  if (!open) return null;

  const activeOptionId =
    visibleItems.length > 0 ? `${optionIdPrefix}-command-option-${activeIndex}` : undefined;

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm border-none"
        onClick={onClose}
        aria-label="Close command palette"
      />

      <div
        className="relative w-full max-w-[520px] mx-4 bg-card border border-border rounded-lg shadow-xl overflow-hidden animate-fade-in"
        role="dialog"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <span className="text-muted-foreground text-sm">{'\u2315'}</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search agents, sessions, pages, or run a command..."
            aria-label="Search commands"
            className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden sm:inline px-1.5 py-0.5 text-[10px] font-mono bg-muted text-muted-foreground border border-border rounded-sm">
            Esc
          </kbd>
        </div>

        <div
          ref={listRef}
          className="max-h-[360px] overflow-auto py-1"
          role="listbox"
          aria-label="Commands"
          aria-activedescendant={activeOptionId}
          tabIndex={-1}
        >
          <CommandPaletteSearchResults
            sections={visibleSections}
            activeIndex={activeIndex}
            optionIdPrefix={optionIdPrefix}
            emptyText={
              isSearchMode ? 'No matching agents, sessions, or pages' : 'No matching commands'
            }
            onItemHover={setActiveIndex}
          />
        </div>

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
          {visibleItems.length > 0 && (
            <span className="ml-auto">
              {visibleItems.length} result{visibleItems.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
