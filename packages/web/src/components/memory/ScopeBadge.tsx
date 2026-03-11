import type { MemoryScope } from '@agentctl/shared';
import type React from 'react';

import { cn } from '@/lib/utils';

import { Badge } from '../ui/badge';

function scopeClasses(scope: MemoryScope): string {
  if (scope === 'global') {
    return 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300';
  }
  if (scope.startsWith('project:')) {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  }
  if (scope.startsWith('agent:')) {
    return 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300';
  }
  return 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300';
}

export function ScopeBadge({
  scope,
  className,
}: {
  scope: MemoryScope;
  className?: string;
}): React.JSX.Element {
  return (
    <Badge variant="outline" className={cn(scopeClasses(scope), className)}>
      {scope}
    </Badge>
  );
}
