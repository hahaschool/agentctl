'use client';

import type { Space } from '@agentctl/shared';
import { Globe, Lock, Users } from 'lucide-react';
import Link from 'next/link';
import type React from 'react';

import { LiveTimeAgo } from '@/components/LiveTimeAgo';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// SpaceTypeBadge
// ---------------------------------------------------------------------------

const SPACE_TYPE_STYLES: Record<string, string> = {
  collaboration: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
  solo: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30',
  'fleet-overview': 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
};

function SpaceTypeBadge({ type }: { type: string }): React.JSX.Element {
  return (
    <span
      className={cn(
        'text-[10px] font-mono px-1.5 py-0.5 rounded-sm border',
        SPACE_TYPE_STYLES[type] ?? 'bg-muted text-muted-foreground border-border',
      )}
    >
      {type}
    </span>
  );
}

// ---------------------------------------------------------------------------
// VisibilityIcon
// ---------------------------------------------------------------------------

function VisibilityIcon({ visibility }: { visibility: string }): React.JSX.Element {
  const props = { size: 12, className: 'text-muted-foreground' } as const;
  switch (visibility) {
    case 'public':
      return <Globe {...props} aria-label="Public" />;
    case 'team':
      return <Users {...props} aria-label="Team" />;
    default:
      return <Lock {...props} aria-label="Private" />;
  }
}

// ---------------------------------------------------------------------------
// SpaceCard
// ---------------------------------------------------------------------------

export type SpaceCardProps = {
  space: Space;
  memberCount?: number;
};

export function SpaceCard({ space, memberCount }: SpaceCardProps): React.JSX.Element {
  return (
    <Link
      href={`/spaces/${space.id}`}
      className="block rounded-lg border border-border bg-card p-4 hover:bg-accent/5 transition-colors no-underline"
    >
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-semibold text-foreground truncate flex-1">{space.name}</h3>
        <VisibilityIcon visibility={space.visibility} />
        <SpaceTypeBadge type={space.type} />
      </div>

      {space.description && (
        <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{space.description}</p>
      )}

      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        {memberCount !== undefined && (
          <span className="flex items-center gap-1">
            <Users size={11} />
            {memberCount}
          </span>
        )}
        <span>
          Created <LiveTimeAgo date={space.createdAt} />
        </span>
      </div>
    </Link>
  );
}
