'use client';

import { useRouter } from 'next/navigation';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

type CommandItem = {
  id: string;
  label: string;
  description?: string;
  icon: string;
  shortcut?: string;
  action: () => void;
  section: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

const NAV_COMMANDS = [
  { href: '/', label: 'Dashboard', icon: '\u25A0', section: 'Navigate' },
  { href: '/machines', label: 'Machines', icon: '\u2302', section: 'Navigate' },
  { href: '/agents', label: 'Agents', icon: '\u2699', section: 'Navigate' },
  { href: '/sessions', label: 'Sessions', icon: '\u25B6', section: 'Navigate' },
  { href: '/discover', label: 'Discover Sessions', icon: '\u2315', section: 'Navigate' },
  { href: '/logs', label: 'Logs & Metrics', icon: '\u2261', section: 'Navigate' },
  { href: '/settings', label: 'Settings', icon: '\u2630', section: 'Navigate' },
] as const;

export function CommandPalette({ open, onClose }: Props): React.JSX.Element | null {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  // Build command list
  const commands: CommandItem[] = useMemo(() => {
    const items: CommandItem[] = [];

    // Navigation commands
    for (const nav of NAV_COMMANDS) {
      items.push({
        id: `nav-${nav.href}`,
        label: nav.label,
        icon: nav.icon,
        section: nav.section,
        action: () => {
          router.push(nav.href);
          onClose();
        },
      });
    }

    // Action commands
    items.push({
      id: 'action-theme',
      label: 'Toggle Dark/Light Mode',
      icon: '\u263D',
      section: 'Actions',
      shortcut: 'Theme',
      action: () => {
        // Dispatch theme toggle event
        document.documentElement.classList.toggle('dark');
        onClose();
      },
    });

    items.push({
      id: 'action-help',
      label: 'Keyboard Shortcuts',
      icon: '?',
      section: 'Actions',
      shortcut: '?',
      action: () => {
        // Close palette, then trigger help
        onClose();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
      },
    });

    return items;
  }, [router, onClose]);

  // Filter commands by query
  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.description?.toLowerCase().includes(q) ||
        cmd.section.toLowerCase().includes(q),
    );
  }, [commands, query]);

  // Group by section
  const sections = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const cmd of filtered) {
      const arr = map.get(cmd.section);
      if (arr) {
        arr.push(cmd);
      } else {
        map.set(cmd.section, [cmd]);
      }
    }
    return map;
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
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden sm:inline px-1.5 py-0.5 text-[10px] font-mono bg-muted text-muted-foreground border border-border rounded-sm">
            Esc
          </kbd>
        </div>

        {/* Command list */}
        <div
          ref={listRef}
          className="max-h-[300px] overflow-auto py-1"
          role="listbox"
          aria-label="Commands"
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
                return (
                  <button
                    key={cmd.id}
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
                    <span className="w-5 text-center text-base shrink-0">{cmd.icon}</span>
                    <span className="flex-1 font-medium">{cmd.label}</span>
                    {cmd.shortcut && (
                      <kbd className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-px rounded-sm border border-border">
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
        </div>
      </div>
    </div>
  );
}
