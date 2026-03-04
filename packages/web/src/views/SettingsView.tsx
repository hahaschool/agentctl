'use client';

import { useQuery } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { healthQuery } from '../lib/queries';

// ---------------------------------------------------------------------------
// Settings view
// ---------------------------------------------------------------------------

export function SettingsView(): React.JSX.Element {
  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-6 animate-fade-in">
      <div>
        <h1 className="text-[22px] font-bold">Settings</h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          Application preferences and system information.
        </p>
      </div>

      <ThemeSection />
      <ConnectionSection />
      <KeyboardShortcutsSection />
      <AboutSection />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Theme section
// ---------------------------------------------------------------------------

function ThemeSection(): React.JSX.Element {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const themes = [
    { key: 'light', label: 'Light', icon: '\u2600' },
    { key: 'dark', label: 'Dark', icon: '\u263D' },
    { key: 'system', label: 'System', icon: '\u2699' },
  ];

  return (
    <Card>
      <CardContent className="p-5">
        <h2 className="text-sm font-semibold mb-3">Theme</h2>
        <div className="flex gap-2">
          {themes.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTheme(t.key)}
              className={cn(
                'px-4 py-2 rounded-sm text-sm border transition-colors',
                mounted && theme === t.key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted text-muted-foreground border-border hover:bg-accent/10',
              )}
            >
              <span className="mr-1.5">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Connection section
// ---------------------------------------------------------------------------

function ConnectionSection(): React.JSX.Element {
  const health = useQuery(healthQuery());
  const h = health.data;

  return (
    <Card>
      <CardContent className="p-5">
        <h2 className="text-sm font-semibold mb-3">Control Plane Connection</h2>

        <div className="space-y-2 text-[13px]">
          <div className="flex justify-between">
            <span className="text-muted-foreground">API Endpoint</span>
            <span className="font-mono text-xs">localhost:8080</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status</span>
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  'font-medium',
                  health.error
                    ? 'text-red-500'
                    : h?.status === 'ok'
                      ? 'text-green-500'
                      : 'text-yellow-500',
                )}
              >
                {health.isLoading ? (
                  <Skeleton className="h-4 w-16 inline-block" />
                ) : health.error ? (
                  'Unreachable'
                ) : h?.status === 'ok' ? (
                  'Connected'
                ) : (
                  'Degraded'
                )}
              </span>
              <button
                type="button"
                onClick={() => void health.refetch()}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Retry health check"
              >
                {'\u21BB'}
              </button>
            </span>
          </div>

          {h?.dependencies && (
            <div className="border-t border-border mt-3 pt-3">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">
                Dependencies
              </div>
              {Object.entries(h.dependencies).map(([name, dep]) => (
                <div key={name} className="flex justify-between py-1">
                  <span className="text-muted-foreground capitalize">{name}</span>
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        'text-xs',
                        dep.status === 'ok' ? 'text-green-500' : 'text-red-400',
                      )}
                    >
                      {dep.status}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{dep.latencyMs}ms</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

const SHORTCUTS = [
  { keys: ['1'], desc: 'Dashboard' },
  { keys: ['2'], desc: 'Machines' },
  { keys: ['3'], desc: 'Agents' },
  { keys: ['4'], desc: 'Sessions' },
  { keys: ['5'], desc: 'Discover' },
  { keys: ['6'], desc: 'Logs & Metrics' },
  { keys: ['7'], desc: 'Settings' },
  { keys: ['\u2318K'], desc: 'Command palette' },
  { keys: ['r'], desc: 'Refresh current page' },
  { keys: ['/'], desc: 'Focus search (Discover)' },
  { keys: ['Esc'], desc: 'Close panels / Cancel' },
  { keys: ['?'], desc: 'Toggle keyboard help' },
];

function KeyboardShortcutsSection(): React.JSX.Element {
  return (
    <Card>
      <CardContent className="p-5">
        <h2 className="text-sm font-semibold mb-3">Keyboard Shortcuts</h2>
        <div className="space-y-1.5">
          {SHORTCUTS.map((s) => (
            <div key={s.desc} className="flex justify-between items-center py-0.5">
              <span className="text-[13px] text-muted-foreground">{s.desc}</span>
              <div className="flex gap-1">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="inline-block px-1.5 py-0.5 text-[10px] font-mono bg-muted border border-border rounded-sm min-w-[20px] text-center"
                  >
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// About section
// ---------------------------------------------------------------------------

function AboutSection(): React.JSX.Element {
  return (
    <Card>
      <CardContent className="p-5">
        <h2 className="text-sm font-semibold mb-3">About</h2>
        <div className="space-y-2 text-[13px]">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Version</span>
            <span className="font-mono text-xs">0.1.0</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Framework</span>
            <span className="font-mono text-xs">Next.js 15 + React 19</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">UI</span>
            <span className="font-mono text-xs">Tailwind CSS v4 + shadcn/ui</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Data</span>
            <span className="font-mono text-xs">TanStack Query v5</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
