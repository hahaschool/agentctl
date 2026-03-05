'use client';

import { useQuery } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { ALL_SHORTCUTS } from '@/lib/keyboard-shortcuts';
import { cn } from '@/lib/utils';
import { healthQuery } from '../lib/queries';
import { AccountsSection } from './AccountsSection';
import { FailoverSection } from './FailoverSection';
import { PreferencesSection } from './PreferencesSection';
import { ProjectAccountsSection } from './ProjectAccountsSection';

// ---------------------------------------------------------------------------
// Group wrapper — visual grouping without heavy card borders
// ---------------------------------------------------------------------------

function SettingsGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section>
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {description && <p className="text-[12px] text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Settings view
// ---------------------------------------------------------------------------

export function SettingsView(): React.JSX.Element {
  return (
    <div className="p-4 md:p-6 max-w-3xl animate-fade-in">
      <div className="mb-8">
        <h1 className="text-[22px] font-bold tracking-tight">Settings</h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          Configure accounts, preferences, and system connections.
        </p>
      </div>

      <div className="space-y-10">
        {/* --- API & Accounts group --- */}
        <SettingsGroup
          title="API Accounts"
          description="Manage provider credentials and configure how requests are routed between accounts."
        >
          <AccountsSection />
          <FailoverSection />
          <ProjectAccountsSection />
        </SettingsGroup>

        <hr className="border-border" />

        {/* --- Appearance & Preferences group --- */}
        <SettingsGroup title="Appearance & Preferences">
          <ThemeSection />
          <PreferencesSection />
        </SettingsGroup>

        <hr className="border-border" />

        {/* --- System group --- */}
        <SettingsGroup title="System">
          <ConnectionSection />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <KeyboardShortcutsSection />
            <AboutSection />
          </div>
        </SettingsGroup>
      </div>
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
    { key: 'light', label: 'Light' },
    { key: 'dark', label: 'Dark' },
    { key: 'system', label: 'System' },
  ];

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-medium">Theme</h3>
          <p className="text-[11px] text-muted-foreground">Choose your preferred color scheme.</p>
        </div>
        <div className="flex rounded-md border border-border overflow-hidden">
          {themes.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTheme(t.key)}
              className={cn(
                'px-3 py-1.5 text-[12px] font-medium transition-colors border-r border-border last:border-r-0',
                mounted && theme === t.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connection section
// ---------------------------------------------------------------------------

function ConnectionSection(): React.JSX.Element {
  const health = useQuery(healthQuery());
  const h = health.data;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-medium">Control Plane</h3>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-block w-2 h-2 rounded-full',
              health.error ? 'bg-red-500' : h?.status === 'ok' ? 'bg-green-500' : 'bg-yellow-500',
            )}
          />
          <span
            className={cn(
              'text-[12px] font-medium',
              health.error
                ? 'text-red-500'
                : h?.status === 'ok'
                  ? 'text-green-500'
                  : 'text-yellow-500',
            )}
          >
            {health.isLoading ? (
              <Skeleton className="h-3.5 w-14 inline-block" />
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
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors ml-1"
            aria-label="Retry health check"
          >
            {'\u21BB'}
          </button>
        </div>
      </div>

      {h?.dependencies && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {Object.entries(h.dependencies).map(([name, dep]) => (
            <div
              key={name}
              className={cn(
                'rounded-md border px-3 py-2 text-center',
                dep.status === 'ok'
                  ? 'border-green-500/20 bg-green-500/5'
                  : 'border-red-500/20 bg-red-500/5',
              )}
            >
              <div className="text-[11px] text-muted-foreground capitalize">{name}</div>
              <div
                className={cn(
                  'text-[12px] font-medium mt-0.5',
                  dep.status === 'ok' ? 'text-green-500' : 'text-red-400',
                )}
              >
                {dep.status === 'ok' ? `${dep.latencyMs}ms` : 'Error'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

function KeyboardShortcutsSection(): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-[13px] font-medium mb-3">Keyboard Shortcuts</h3>
      <div className="space-y-1">
        {ALL_SHORTCUTS.map((s) => (
          <div key={s.desc} className="flex justify-between items-center py-0.5">
            <span className="text-[12px] text-muted-foreground">{s.desc}</span>
            <div className="flex gap-0.5">
              {s.keys.map((k) => (
                <kbd
                  key={k}
                  className="inline-block px-1.5 py-0.5 text-[10px] font-mono bg-muted border border-border rounded min-w-[20px] text-center"
                >
                  {k}
                </kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// About section
// ---------------------------------------------------------------------------

function AboutSection(): React.JSX.Element {
  const items = [
    { label: 'Version', value: '0.1.0' },
    { label: 'Framework', value: 'Next.js + React 19' },
    { label: 'UI', value: 'Tailwind v4 + shadcn' },
    { label: 'Data', value: 'TanStack Query v5' },
  ];

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-[13px] font-medium mb-3">About AgentCTL</h3>
      <div className="space-y-1.5">
        {items.map((item) => (
          <div key={item.label} className="flex justify-between items-center">
            <span className="text-[12px] text-muted-foreground">{item.label}</span>
            <span className="text-[12px] font-mono">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
