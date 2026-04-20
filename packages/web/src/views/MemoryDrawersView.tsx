'use client';

// ---------------------------------------------------------------------------
// Memory Drawers — search surface over the MemPalace drawer layer.
//
// Queries `GET /api/memory/drawers/search` (PR #704) via `memoryDrawersApi`
// and renders sanitized verbatim snippets with match-type badges + evidence
// links to `/memory/drawers/[id]`. This is the first human-facing window into
// the drawer layer — see §4.16 Memory Evolution Plan, PR F.
// ---------------------------------------------------------------------------

import type { MemoryDrawerSearchResult } from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type React from 'react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { matchTypeClass, matchTypeLabel } from '@/components/memory/drawerMatchType';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { memoryDrawersSearchQuery } from '@/lib/queries';

const DEBOUNCE_MS = 300;
const LIMIT_OPTIONS = [10, 25, 50] as const;
const SCOPE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '', label: 'All scopes' },
  { value: 'session', label: 'Session' },
  { value: 'user', label: 'User' },
  { value: 'team', label: 'Team' },
] as const;
const SNIPPET_PREVIEW_LINES = 6;

type DrawerLimit = (typeof LIMIT_OPTIONS)[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatScore(score: number | null): string {
  if (score === null || !Number.isFinite(score)) return '—';
  return score.toFixed(3);
}

function truncateId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard is best-effort; swallow — the copy button is a convenience.
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DrawerSearchControls({
  queryValue,
  onQueryChange,
  scope,
  onScopeChange,
  limit,
  onLimitChange,
}: {
  queryValue: string;
  onQueryChange: (value: string) => void;
  scope: string;
  onScopeChange: (value: string) => void;
  limit: DrawerLimit;
  onLimitChange: (value: DrawerLimit) => void;
}): React.JSX.Element {
  const queryInputId = useId();
  const scopeSelectId = useId();
  const limitSelectId = useId();

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end">
      <label htmlFor={queryInputId} className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
        <span className="font-medium text-foreground">Search drawers</span>
        <input
          id={queryInputId}
          type="search"
          value={queryValue}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="e.g. rate limiter, vector fallback, decision"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring"
          aria-label="Search drawers"
        />
      </label>
      <label htmlFor={scopeSelectId} className="flex flex-col gap-2 text-sm">
        <span className="font-medium text-foreground">Scope</span>
        <select
          id={scopeSelectId}
          value={scope}
          onChange={(e) => onScopeChange(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring"
          aria-label="Drawer scope filter"
        >
          {SCOPE_OPTIONS.map((opt) => (
            <option key={opt.value || 'all'} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={limitSelectId} className="flex flex-col gap-2 text-sm">
        <span className="font-medium text-foreground">Limit</span>
        <select
          id={limitSelectId}
          value={limit}
          onChange={(e) => onLimitChange(Number(e.target.value) as DrawerLimit)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring"
          aria-label="Result limit"
        >
          {LIMIT_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function DrawerResultRow({ result }: { result: MemoryDrawerSearchResult }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const lineCount = result.content_preview.split('\n').length;
  const canTruncate = lineCount > SNIPPET_PREVIEW_LINES;
  const snippetClass = canTruncate && !expanded ? 'line-clamp-6' : '';

  const handleCopyId = useCallback(async () => {
    await copyToClipboard(result.id);
    setCopied(true);
    const handle = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(handle);
  }, [result.id]);

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-card/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={matchTypeClass(result.match_type)}
          data-testid="drawer-match-badge"
        >
          {matchTypeLabel(result.match_type)}
        </Badge>
        <Badge variant="outline" className="font-mono text-[11px]">
          {result.scope}
        </Badge>
        <Badge variant="outline" className="text-[11px]">
          {result.source_type}
        </Badge>
        <span
          className="ml-auto font-mono text-xs text-muted-foreground"
          title={`score ${formatScore(result.score)}`}
        >
          score {formatScore(result.score)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-muted-foreground">Drawer</span>
        <code
          className="truncate rounded border border-border bg-muted/30 px-2 py-0.5 font-mono text-[11px] text-foreground"
          title={result.id}
        >
          {truncateId(result.id)}
        </code>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={handleCopyId}
          aria-label="Copy drawer ID"
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <span className="text-muted-foreground">topic: {result.topic}</span>
      </div>

      <pre
        className={`whitespace-pre-wrap rounded-md border border-border bg-background/60 p-3 font-mono text-xs leading-relaxed text-foreground ${snippetClass}`}
      >
        {result.content_preview}
      </pre>

      <div className="flex flex-wrap items-center gap-3">
        {canTruncate ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpanded((prev) => !prev)}
            aria-label={expanded ? 'Collapse drawer snippet' : 'Expand drawer snippet'}
          >
            {expanded ? 'Collapse' : 'Expand'}
          </Button>
        ) : null}
        <Link
          href={`/memory/drawers/${encodeURIComponent(result.id)}`}
          className="text-xs font-medium text-primary underline-offset-4 hover:underline"
          aria-label={`View drawer ${result.id}`}
        >
          View details →
        </Link>
      </div>
    </li>
  );
}

function LoadingSkeleton(): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-3" aria-label="Loading drawer results" aria-busy>
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex flex-col gap-3 rounded-lg border border-border bg-card/40 p-4">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="ml-auto h-4 w-16" />
          </div>
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-24 w-full" />
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ hasQuery }: { hasQuery: boolean }): React.JSX.Element {
  if (!hasQuery) {
    return (
      <output className="block rounded-lg border border-dashed border-border bg-card/20 p-8 text-center text-sm text-muted-foreground">
        <p>Type a query above to search the MemPalace drawer layer.</p>
      </output>
    );
  }

  return (
    <output className="block rounded-lg border border-dashed border-border bg-card/20 p-8 text-center text-sm text-muted-foreground">
      <p className="font-medium text-foreground">No drawers indexed yet.</p>
      <p className="mt-2">
        Run{' '}
        <code className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-xs">
          pnpm memory:backfill-drawers
        </code>{' '}
        on your control-plane host to ingest session transcripts and claude-mem observations.
      </p>
    </output>
  );
}

function ErrorState({ message }: { message: string }): React.JSX.Element {
  return (
    <div
      className="rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive"
      role="alert"
    >
      <p className="font-semibold">Failed to load drawers.</p>
      <p className="mt-2 text-destructive/90">{message}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function MemoryDrawersView(): React.JSX.Element {
  const [queryInput, setQueryInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [scope, setScope] = useState<string>('');
  const [limit, setLimit] = useState<DrawerLimit>(10);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce the search query — 300ms matches MemoryBrowserView precedent.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(queryInput.trim());
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [queryInput]);

  const trimmedQuery = debouncedQuery;
  const hasQuery = trimmedQuery.length > 0;

  const searchParams = useMemo(
    () => ({
      query: trimmedQuery,
      scope: scope || undefined,
      limit,
    }),
    [trimmedQuery, scope, limit],
  );

  const { data, isLoading, isFetching, isError, error } = useQuery(
    memoryDrawersSearchQuery(searchParams, { enabled: hasQuery }),
  );

  const results = data?.results ?? [];
  const showLoading = hasQuery && (isLoading || (isFetching && results.length === 0));
  const showEmpty = hasQuery && !showLoading && !isError && results.length === 0;
  const showResults = hasQuery && !showLoading && !isError && results.length > 0;
  const errorMessage = error instanceof Error ? error.message : 'Unexpected error';

  return (
    <div className="flex flex-col gap-6 p-6 md:p-8">
      <div>
        <h1 className="text-lg font-semibold">Memory Drawers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Hybrid keyword + vector search over sanitized verbatim drawer snippets. Use this to trace
          the original evidence behind a fact or audit what the MemPalace layer has indexed.
        </p>
      </div>

      <DrawerSearchControls
        queryValue={queryInput}
        onQueryChange={setQueryInput}
        scope={scope}
        onScopeChange={setScope}
        limit={limit}
        onLimitChange={setLimit}
      />

      <section aria-label="Drawer search results" className="flex min-h-[8rem] flex-col gap-3">
        {!hasQuery ? <EmptyState hasQuery={false} /> : null}
        {showLoading ? <LoadingSkeleton /> : null}
        {isError ? <ErrorState message={errorMessage} /> : null}
        {showEmpty ? <EmptyState hasQuery /> : null}
        {showResults ? (
          <ul className="flex flex-col gap-3" data-testid="drawer-results">
            {results.map((result) => (
              <DrawerResultRow key={result.id} result={result} />
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
