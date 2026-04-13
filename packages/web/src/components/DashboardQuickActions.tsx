'use client';

import { ExternalLink, Play, Plus, ScrollText } from 'lucide-react';
import Link from 'next/link';
import type React from 'react';

import { Button } from '@/components/ui/button';

// ---------------------------------------------------------------------------
// DashboardQuickActions
// ---------------------------------------------------------------------------
// Compact row of action buttons surfaced prominently on the dashboard.
// Keeps the user one click away from the most common tasks.

export function DashboardQuickActions(): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild size="sm" variant="outline" className="gap-1.5">
        <Link href="/agents?new=1" title="Create a new agent" aria-label="Create a new agent">
          <Play className="w-3.5 h-3.5" aria-hidden="true" />
          Start Agent
        </Link>
      </Button>
      <Button asChild size="sm" variant="outline" className="gap-1.5">
        <Link href="/sessions?new=1" title="Start a new session" aria-label="Start a new session">
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          New Session
        </Link>
      </Button>
      <Button asChild size="sm" variant="ghost" className="gap-1.5 text-muted-foreground">
        <Link href="/logs" title="Open the logs page" aria-label="Open the logs page">
          <ScrollText className="w-3.5 h-3.5" aria-hidden="true" />
          View Logs
        </Link>
      </Button>
      <Button asChild size="sm" variant="ghost" className="gap-1.5 text-muted-foreground">
        <Link
          href="/discover"
          title="Discover existing sessions"
          aria-label="Discover existing sessions"
        >
          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          Discover Sessions
        </Link>
      </Button>
    </div>
  );
}
