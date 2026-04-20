import type { MemorySearchResult } from '@agentctl/shared';
import type React from 'react';

import { cn } from '@/lib/utils';

// Hybrid-search result path reported by the control-plane
// `GET /api/memory/facts?mode=semantic` envelope. We alias the shared union so
// consumers don't have to reach into nested types. See docs/plans/2026-04-15-
// mempalace-inspired-memory-evolution-plan.md Phase 7 Step 1/5.
export type FactMatchSourcePath = MemorySearchResult['source_path'];

// Visual style per match-type path. Terminal-geeky aesthetic mirroring the
// drawer badges in MemoryDrawersView, but distinct colors so fact-side badges
// don't visually collide with drawer-side ones.
const SOURCE_PATH_CLASS: Readonly<Record<FactMatchSourcePath, string>> = {
  vector: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300',
  bm25: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  graph: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
};

export function MatchSourceBadge({
  sourcePath,
  className,
}: {
  sourcePath: FactMatchSourcePath;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      data-testid="fact-match-source-badge"
      data-source-path={sourcePath}
      className={cn(
        'inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-mono uppercase tracking-wide',
        SOURCE_PATH_CLASS[sourcePath],
        className,
      )}
      title={`Matched via ${sourcePath}`}
    >
      {sourcePath}
    </span>
  );
}
