'use client';

import {
  AlertTriangleIcon,
  CopyIcon,
  GitMergeIcon,
  LayersIcon,
  Loader2Icon,
  TimerIcon,
  UnlinkIcon,
} from 'lucide-react';
import Link from 'next/link';
import type React from 'react';
import { type ReactNode, useCallback, useState } from 'react';

import { EmptyState } from '@/components/EmptyState';
import { ScopeSelector } from '@/components/memory/ScopeSelector';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type {
  MemorySynthesisGroup,
  MemorySynthesisNearDuplicate,
  MemorySynthesisOrphanFact,
  MemorySynthesisResult,
  MemorySynthesisStaleFact,
} from '@/lib/api';
import { useRunMemorySynthesis } from '@/lib/queries';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCOPE_OPTIONS = ['all', 'project:agentctl', 'global'] as const;
const FACT_PREVIEW_LIMIT = 200;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(content: string, max = FACT_PREVIEW_LIMIT): string {
  if (content.length <= max) return content;
  return `${content.slice(0, max).trimEnd()}…`;
}

function factBrowserHref(factId: string): string {
  const params = new URLSearchParams({ q: factId });
  return `/memory/browser?${params.toString()}`;
}

function totalLintCount(result: MemorySynthesisResult | null): number {
  if (!result) return 0;
  return (
    result.lint.nearDuplicates.length +
    result.lint.staleFacts.length +
    result.lint.orphanFacts.length
  );
}

// ---------------------------------------------------------------------------
// FactLink — drill-down anchor for a fact id
// ---------------------------------------------------------------------------

function FactLink({ factId, label }: { factId: string; label?: string }): React.JSX.Element {
  return (
    <Link
      href={factBrowserHref(factId)}
      className="font-mono text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
    >
      {label ?? 'Open fact'}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// CollapsibleSection — native <details>, keyed on section id
// ---------------------------------------------------------------------------

function CollapsibleSection({
  id,
  title,
  description,
  count,
  icon,
  tone,
  defaultOpen,
  children,
}: {
  id: string;
  title: string;
  description: string;
  count: number;
  icon: React.JSX.Element;
  tone: 'duplicate' | 'stale' | 'orphan' | 'group';
  defaultOpen?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const toneClass =
    tone === 'duplicate'
      ? 'border-amber-500/40'
      : tone === 'stale'
        ? 'border-sky-500/40'
        : tone === 'orphan'
          ? 'border-zinc-500/40'
          : 'border-primary/40';

  return (
    <details
      id={`synthesis-${id}`}
      open={defaultOpen}
      className={cn('group overflow-hidden rounded-lg border bg-card transition-colors', toneClass)}
    >
      <summary
        className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 outline-none hover:bg-accent/10 focus-visible:ring-1 focus-visible:ring-ring"
        aria-label={`${title} — ${count} items`}
      >
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground',
            'group-open:text-foreground',
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{title}</span>
            <Badge variant="outline" className="tabular-nums">
              {count}
            </Badge>
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{description}</span>
        </span>
        <span
          aria-hidden="true"
          className="text-xs text-muted-foreground transition-transform group-open:rotate-90"
        >
          ▸
        </span>
      </summary>
      <div className="border-t border-border px-4 py-3">{children}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Result sections
// ---------------------------------------------------------------------------

function NearDuplicatesSection({
  items,
}: {
  items: readonly MemorySynthesisNearDuplicate[];
}): React.JSX.Element {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">No near-duplicate pairs detected.</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((pair) => (
        <li
          key={`${pair.factIdA}-${pair.factIdB}`}
          className="rounded-md border border-border bg-background/40 px-3 py-2 text-xs"
        >
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
            <FactLink factId={pair.factIdA} />
            <span aria-hidden="true">↔</span>
            <FactLink factId={pair.factIdB} />
            <span className="ml-auto tabular-nums text-[11px]">
              similarity {(pair.similarity * 100).toFixed(1)}%
            </span>
          </div>
          <div className="mt-1.5 space-y-1 font-mono text-[11px] leading-snug text-foreground">
            <p>A: {truncate(pair.contentA)}</p>
            <p>B: {truncate(pair.contentB)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function StaleFactsSection({
  items,
}: {
  items: readonly MemorySynthesisStaleFact[];
}): React.JSX.Element {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">No stale facts.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((fact) => (
        <li
          key={fact.factId}
          className="flex items-start gap-3 rounded-md border border-border bg-background/40 px-3 py-2 text-xs"
        >
          <FactLink factId={fact.factId} />
          <p className="min-w-0 flex-1 font-mono text-[11px] leading-snug text-foreground">
            {truncate(fact.content)}
          </p>
          <span className="shrink-0 whitespace-nowrap tabular-nums text-[11px] text-muted-foreground">
            {fact.lastAccessedDaysAgo}d stale
          </span>
        </li>
      ))}
    </ul>
  );
}

function OrphanFactsSection({
  items,
}: {
  items: readonly MemorySynthesisOrphanFact[];
}): React.JSX.Element {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">No orphan facts.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((fact) => (
        <li
          key={fact.factId}
          className="flex items-start gap-3 rounded-md border border-border bg-background/40 px-3 py-2 text-xs"
        >
          <FactLink factId={fact.factId} />
          <p className="min-w-0 flex-1 font-mono text-[11px] leading-snug text-foreground">
            {truncate(fact.content)}
          </p>
          <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
            {fact.entityType}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function SynthesisGroupsSection({
  groups,
}: {
  groups: readonly MemorySynthesisGroup[];
}): React.JSX.Element {
  if (groups.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No entity-type clusters large enough to propose higher-level principles.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {groups.map((group) => (
        <li
          key={group.entityType}
          className="rounded-md border border-border bg-background/40 px-3 py-2"
        >
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="outline" className="font-mono">
              {group.entityType}
            </Badge>
            <span className="text-muted-foreground">
              {group.factIds.length} fact{group.factIds.length === 1 ? '' : 's'}
            </span>
          </div>
          <p className="mt-1.5 text-xs leading-snug text-foreground">{group.proposalHint}</p>
          {group.factIds.length > 0 ? (
            <ol className="mt-2 space-y-1.5">
              {group.factIds.map((factId, index) => (
                <li key={factId} className="flex items-start gap-2 text-xs">
                  <FactLink factId={factId} label={`Fact ${index + 1}`} />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {truncate(group.factContents[index] ?? 'No preview available', 120)}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Summary strip
// ---------------------------------------------------------------------------

function ResultSummary({ result }: { result: MemorySynthesisResult }): React.JSX.Element {
  const stats: Array<{ label: string; value: number; tone: string }> = [
    {
      label: 'near-duplicates',
      value: result.lint.nearDuplicates.length,
      tone: 'text-amber-600 dark:text-amber-400',
    },
    {
      label: 'stale',
      value: result.lint.staleFacts.length,
      tone: 'text-sky-600 dark:text-sky-400',
    },
    {
      label: 'orphans',
      value: result.lint.orphanFacts.length,
      tone: 'text-muted-foreground',
    },
    {
      label: 'principle candidates',
      value: result.synthesisGroups.length,
      tone: 'text-primary',
    },
  ];
  return (
    <div
      aria-live="polite"
      className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-card px-4 py-2 text-xs"
    >
      {stats.map((stat) => (
        <span key={stat.label} className="flex items-center gap-1.5">
          <span className={cn('font-medium tabular-nums', stat.tone)}>{stat.value}</span>
          <span className="text-muted-foreground">{stat.label}</span>
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function MemorySynthesisPage(): React.JSX.Element {
  const [scope, setScope] = useState<string>('all');
  const [result, setResult] = useState<MemorySynthesisResult | null>(null);

  const runSynthesis = useRunMemorySynthesis();

  const handleRun = useCallback(() => {
    const scopeParam = scope === 'all' ? undefined : scope;
    runSynthesis.mutate(
      { scope: scopeParam },
      {
        onSuccess: (data) => {
          setResult(data.result);
        },
      },
    );
  }, [runSynthesis, scope]);

  const lintTotal = totalLintCount(result);
  const hasResult = result !== null;

  return (
    <div className="flex flex-col gap-6 p-6 md:p-8">
      {/* Page header */}
      <div>
        <h1 className="text-lg font-semibold">Knowledge Synthesis</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Preview the structural shape of memory: near-duplicate pairs, stale facts, orphan nodes,
          and entity-type clusters that are candidates for higher-level principles. Synthesis is a
          preview — it doesn&rsquo;t modify memory.
        </p>
      </div>

      {/* Controls */}
      <section aria-label="Synthesis parameters" className="flex flex-wrap items-end gap-4">
        <ScopeSelector value={scope} options={SCOPE_OPTIONS} onValueChange={setScope} />
        <Button
          onClick={handleRun}
          disabled={runSynthesis.isPending}
          aria-label="Run knowledge synthesis"
        >
          {runSynthesis.isPending ? (
            <>
              <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
              Running synthesis…
            </>
          ) : (
            'Run synthesis'
          )}
        </Button>
        {runSynthesis.isError ? (
          <p className="text-sm text-destructive" role="alert">
            Failed to run synthesis. Try again in a moment.
          </p>
        ) : null}
      </section>

      {/* Summary */}
      {hasResult ? <ResultSummary result={result} /> : null}

      {/* Result sections */}
      {hasResult ? (
        <div className="flex flex-col gap-3">
          <CollapsibleSection
            id="near-duplicates"
            title="Near-duplicates"
            description="Fact pairs with 0.85 ≤ similarity < 0.90"
            count={result.lint.nearDuplicates.length}
            icon={<CopyIcon className="size-4" aria-hidden="true" />}
            tone="duplicate"
            defaultOpen
          >
            <NearDuplicatesSection items={result.lint.nearDuplicates} />
          </CollapsibleSection>

          <CollapsibleSection
            id="stale-facts"
            title="Stale facts"
            description="Active facts not accessed in 30+ days"
            count={result.lint.staleFacts.length}
            icon={<TimerIcon className="size-4" aria-hidden="true" />}
            tone="stale"
          >
            <StaleFactsSection items={result.lint.staleFacts} />
          </CollapsibleSection>

          <CollapsibleSection
            id="orphan-facts"
            title="Orphan facts"
            description="Facts with no edges to any other fact"
            count={result.lint.orphanFacts.length}
            icon={<UnlinkIcon className="size-4" aria-hidden="true" />}
            tone="orphan"
          >
            <OrphanFactsSection items={result.lint.orphanFacts} />
          </CollapsibleSection>

          <CollapsibleSection
            id="principle-candidates"
            title="Principle candidates"
            description="Entity-type clusters suggesting higher-level synthesis"
            count={result.synthesisGroups.length}
            icon={<LayersIcon className="size-4" aria-hidden="true" />}
            tone="group"
            defaultOpen={result.synthesisGroups.length > 0}
          >
            <SynthesisGroupsSection groups={result.synthesisGroups} />
          </CollapsibleSection>

          {lintTotal === 0 && result.synthesisGroups.length === 0 ? (
            <EmptyState
              icon={GitMergeIcon}
              title="Knowledge graph looks clean"
              description="No structural issues or synthesis opportunities detected in this scope."
            />
          ) : null}
        </div>
      ) : runSynthesis.isPending ? null : (
        <EmptyState
          icon={AlertTriangleIcon}
          title="No synthesis results yet"
          description="Run synthesis to scan memory for near-duplicates, stale facts, orphan nodes, and entity-type clusters that could be synthesised into higher-level principles. The scan is read-only and rate-limited at 20 requests per minute."
        />
      )}
    </div>
  );
}
