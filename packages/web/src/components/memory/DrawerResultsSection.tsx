'use client';

// ---------------------------------------------------------------------------
// DrawerResultsSection — compact secondary section rendered under the facts
// list in the Memory Browser when the CP returns `drawerResults` on
// `/api/memory/facts` (MEMORY_DRAWER_FUSION=true + embedding client wired).
//
// Parents MUST guard on `drawerResults.length > 0` before rendering — this
// component assumes a non-empty array and will otherwise still render a bare
// header. No click handlers or pagination here: navigation into full drawer
// detail is a later Phase 7 slice. See docs/plans/2026-04-15-mempalace-
// inspired-memory-evolution-plan.md Phase 7 Step 1.
// ---------------------------------------------------------------------------

import type { MemoryDrawerSearchResult } from '@agentctl/shared';
import type React from 'react';

import { Badge } from '@/components/ui/badge';

import { matchTypeClass, matchTypeLabel } from './drawerMatchType';

const MAX_VISIBLE_ROWS = 5;
const CONTENT_PREVIEW_MAX_LENGTH = 120;

function formatScore(score: number | null): string {
  if (score === null || !Number.isFinite(score)) return '—';
  return score.toFixed(2);
}

function truncatePreview(preview: string): string {
  if (preview.length <= CONTENT_PREVIEW_MAX_LENGTH) return preview;
  return `${preview.slice(0, CONTENT_PREVIEW_MAX_LENGTH)}…`;
}

function DrawerResultRow({ result }: { result: MemoryDrawerSearchResult }): React.JSX.Element {
  return (
    <li
      className="flex flex-col gap-1 py-1.5"
      data-testid="drawer-result-row"
      data-drawer-id={result.id}
    >
      <div className="flex items-center gap-2 text-xs">
        <Badge
          variant="outline"
          className={matchTypeClass(result.match_type)}
          data-testid="drawer-match-badge"
        >
          {matchTypeLabel(result.match_type)}
        </Badge>
        <span className="truncate font-mono text-xs text-foreground" title={result.topic}>
          {result.topic}
        </span>
        <span
          className="ml-auto font-mono text-[11px] text-muted-foreground"
          title={result.score === null ? 'no score' : `score ${result.score}`}
        >
          {formatScore(result.score)}
        </span>
      </div>
      <p className="line-clamp-1 font-mono text-[11px] text-muted-foreground">
        {truncatePreview(result.content_preview)}
      </p>
    </li>
  );
}

export function DrawerResultsSection({
  drawerResults,
}: {
  drawerResults: readonly MemoryDrawerSearchResult[];
}): React.JSX.Element {
  const visibleRows = drawerResults.slice(0, MAX_VISIBLE_ROWS);
  const overflowCount = drawerResults.length - visibleRows.length;

  return (
    <section
      aria-label="Raw drawer results"
      data-testid="drawer-results-section"
      className="border-t border-slate-700/40 px-4 py-3"
    >
      <h3 className="mb-2 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
        Raw Drawers ({drawerResults.length})
      </h3>
      <ul className="flex flex-col divide-y divide-border/40">
        {visibleRows.map((result) => (
          <DrawerResultRow key={result.id} result={result} />
        ))}
      </ul>
      {overflowCount > 0 ? (
        <p
          className="mt-2 font-mono text-[11px] text-muted-foreground"
          data-testid="drawer-results-overflow"
        >
          +{overflowCount} more
        </p>
      ) : null}
    </section>
  );
}
