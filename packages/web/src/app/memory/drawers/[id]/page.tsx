'use client';

// ---------------------------------------------------------------------------
// Memory drawer detail — read-only metadata view for a single drawer.
//
// Mirrors `/api/memory/drawers/:drawerId` (PR #704). Intentionally minimal:
// surfaces the metadata humans need to verify provenance and renders the
// sanitized verbatim content. Richer editing lives on the fact layer, not the
// drawer layer.
// ---------------------------------------------------------------------------

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type React from 'react';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { memoryDrawerQuery } from '@/lib/queries';

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}

function DrawerDetail({ id }: { id: string }): React.JSX.Element {
  const { data, isLoading, isError, error } = useQuery(memoryDrawerQuery(id));

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3" aria-busy>
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive"
        role="alert"
      >
        <p className="font-semibold">Failed to load drawer.</p>
        <p className="mt-2 text-destructive/90">
          {error instanceof Error ? error.message : 'Unexpected error'}
        </p>
      </div>
    );
  }

  const drawer = data?.drawer;
  if (!drawer) {
    return <p className="text-sm text-muted-foreground">Drawer not found.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-mono text-[11px]">
          {drawer.scope}
        </Badge>
        <Badge variant="outline" className="text-[11px]">
          {drawer.sourceType}
        </Badge>
        <Badge variant="outline" className="text-[11px]">
          {drawer.redactionStatus}
        </Badge>
      </div>

      <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Drawer ID</dt>
          <dd className="mt-1 font-mono text-xs break-all text-foreground">{drawer.id}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Topic</dt>
          <dd className="mt-1 text-foreground">{drawer.topic}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Source</dt>
          <dd className="mt-1 font-mono text-xs text-foreground break-all">
            {drawer.sourceId}
            {drawer.sourceUri ? (
              <span className="ml-2 text-muted-foreground">({drawer.sourceUri})</span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Embedding</dt>
          <dd className="mt-1 font-mono text-xs text-foreground">
            {drawer.embeddingModel} · v{drawer.embeddingVersion} · {drawer.tokenCount} tokens
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Created</dt>
          <dd className="mt-1 font-mono text-xs text-muted-foreground">
            {formatDate(drawer.createdAt)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Updated</dt>
          <dd className="mt-1 font-mono text-xs text-muted-foreground">
            {formatDate(drawer.updatedAt)}
          </dd>
        </div>
      </dl>

      <div>
        <h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Content</h2>
        <pre className="whitespace-pre-wrap rounded-md border border-border bg-background/60 p-4 font-mono text-xs leading-relaxed text-foreground">
          {drawer.content}
        </pre>
      </div>
    </div>
  );
}

export default function Page(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const drawerId = typeof params.id === 'string' ? decodeURIComponent(params.id) : '';

  return (
    <ErrorBoundary>
      <div className="flex flex-col gap-6 p-6 md:p-8">
        <div>
          <Link
            href="/memory/drawers"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={14} />
            All drawers
          </Link>
          <h1 className="mt-3 text-lg font-semibold">Memory drawer</h1>
        </div>
        <DrawerDetail id={drawerId} />
      </div>
    </ErrorBoundary>
  );
}
