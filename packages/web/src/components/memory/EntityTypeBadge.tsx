import type { EntityType } from '@agentctl/shared';
import type React from 'react';

import { cn } from '@/lib/utils';

import { Badge } from '../ui/badge';

const ENTITY_TYPE_CLASSES: Record<EntityType, string> = {
  pattern: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  decision: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  error: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  concept: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  code_artifact: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300',
  preference: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300',
  person: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
  skill: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  experience: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  principle: 'border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300',
  question: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300',
};

export function EntityTypeBadge({
  entityType,
  className,
}: {
  entityType: EntityType;
  className?: string;
}): React.JSX.Element {
  return (
    <Badge
      variant="outline"
      className={cn('capitalize tracking-wide', ENTITY_TYPE_CLASSES[entityType], className)}
    >
      {entityType.replace(/_/g, ' ')}
    </Badge>
  );
}
