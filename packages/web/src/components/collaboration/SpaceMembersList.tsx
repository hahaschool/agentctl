'use client';

import type { SpaceMember } from '@agentctl/shared';
import { Bot, Crown, Eye, User, X } from 'lucide-react';
import type React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Member icon
// ---------------------------------------------------------------------------

function MemberIcon({ memberType }: { memberType: string }): React.JSX.Element {
  const base = 'size-7 shrink-0 rounded-full flex items-center justify-center';
  return memberType === 'agent' ? (
    <span className={cn(base, 'bg-blue-500/10 text-blue-500')}>
      <Bot size={14} />
    </span>
  ) : (
    <span className={cn(base, 'bg-green-500/10 text-green-500')}>
      <User size={14} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Role badge
// ---------------------------------------------------------------------------

function RoleBadge({ role }: { role: string }): React.JSX.Element {
  switch (role) {
    case 'owner':
      return (
        <span className="flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400">
          <Crown size={10} />
          owner
        </span>
      );
    case 'observer':
      return (
        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
          <Eye size={10} />
          observer
        </span>
      );
    default:
      return <span className="text-[10px] text-muted-foreground">member</span>;
  }
}

// ---------------------------------------------------------------------------
// SpaceMembersList
// ---------------------------------------------------------------------------

export type SpaceMembersListProps = {
  members: SpaceMember[];
  onRemove?: (memberId: string) => void;
  isRemoving?: boolean;
};

export function SpaceMembersList({
  members,
  onRemove,
  isRemoving,
}: SpaceMembersListProps): React.JSX.Element {
  if (members.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
        No members in this space.
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {members.map((member) => (
        <div
          key={`${member.memberType}-${member.memberId}`}
          className="flex items-center gap-2.5 px-3 py-2"
        >
          <MemberIcon memberType={member.memberType} />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-foreground truncate">{member.memberId}</div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-muted-foreground">
                {member.memberType}
              </span>
              <RoleBadge role={member.role} />
            </div>
          </div>
          {onRemove && member.role !== 'owner' && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onRemove(member.memberId)}
              disabled={isRemoving}
              aria-label={`Remove ${member.memberId}`}
            >
              <X size={12} />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
