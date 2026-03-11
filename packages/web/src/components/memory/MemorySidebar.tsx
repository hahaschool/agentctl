'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type React from 'react';

import { memoryStatsQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';

import { Badge } from '../ui/badge';

const MEMORY_NAV_ITEMS = [
  { href: '/memory/browser', label: 'Browser', description: 'Inspect facts and filters' },
  { href: '/memory/graph', label: 'Graph', description: 'Explore relationships' },
  { href: '/memory/dashboard', label: 'Dashboard', description: 'Track memory health' },
  { href: '/memory/consolidation', label: 'Consolidation', description: 'Review cleanup candidates' },
  { href: '/memory/reports', label: 'Reports', description: 'Generated summaries and exports' },
  { href: '/memory/import', label: 'Import', description: 'Bring in external memory sources' },
  { href: '/memory/scopes', label: 'Scopes', description: 'Inspect scope boundaries' },
] as const;

export function MemorySidebar(): React.JSX.Element {
  const pathname = usePathname();
  const { data } = useQuery(memoryStatsQuery());
  const stats = data?.stats;

  return (
    <aside className="w-full border-b border-border bg-card/40 md:w-72 md:border-r md:border-b-0">
      <div className="space-y-2 px-4 py-4">
        <div>
          <h2 className="text-sm font-semibold tracking-wide">Memory</h2>
          <p className="text-xs text-muted-foreground">
            Foundation shell for the unified memory workspace.
          </p>
        </div>
        <nav className="space-y-1" aria-label="Memory navigation">
          {MEMORY_NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            const count =
              item.href === '/memory/browser'
                ? stats?.totalFacts
                : item.href === '/memory/consolidation'
                  ? stats?.pendingConsolidation
                  : undefined;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-lg border px-3 py-2 no-underline transition-colors',
                  isActive
                    ? 'border-primary/40 bg-accent/15 text-foreground'
                    : 'border-transparent text-muted-foreground hover:border-border hover:bg-accent/5',
                )}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className="block text-xs">{item.description}</span>
                </span>
                {count !== undefined ? (
                  <Badge variant="outline" className="shrink-0">
                    {count}
                  </Badge>
                ) : null}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
