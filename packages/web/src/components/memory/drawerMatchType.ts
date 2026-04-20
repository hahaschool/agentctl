// ---------------------------------------------------------------------------
// Drawer match-type visual helpers.
//
// Extracted verbatim from `MemoryDrawersView` so the drawers page and the
// memory-browser drawer-results section share a single source of truth for
// match-type pills. Keep the returned strings and CSS classes byte-identical
// to the original — this file is a pure dedup move. See docs/plans/
// 2026-04-15-mempalace-inspired-memory-evolution-plan.md Phase 7 Step 1.
// ---------------------------------------------------------------------------

import type { MemoryDrawerSearchResultMatchType } from '@agentctl/shared';

export function matchTypeClass(matchType: MemoryDrawerSearchResultMatchType | null): string {
  // Semantic tokens only — no hardcoded hex. Each match-type path gets a
  // distinct accent color so users can tell keyword vs. vector matches apart.
  switch (matchType) {
    case 'keyword':
      return 'border-sky-500/40 bg-sky-500/10 text-sky-300';
    case 'vector':
      return 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300';
    case 'grep':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
    default:
      return 'border-border bg-muted/40 text-muted-foreground';
  }
}

export function matchTypeLabel(matchType: MemoryDrawerSearchResultMatchType | null): string {
  return matchType ?? 'unknown';
}
