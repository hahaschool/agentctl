'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Inbox, RefreshCw } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import type { WebhookDelivery } from '@/lib/api';
import { formatDateTime, timeAgo } from '@/lib/format-utils';
import { webhookDeliveriesQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Status badges
// ---------------------------------------------------------------------------

const STATUS_BADGE: Record<string, { className: string; label: string }> = {
  delivered: {
    className: 'bg-green-500/15 text-green-400 border-green-500/30',
    label: 'delivered',
  },
  pending: {
    className: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30 animate-pulse',
    label: 'pending',
  },
  failed: {
    className: 'bg-red-500/15 text-red-400 border-red-500/30',
    label: 'failed',
  },
};

function StatusBadge({ status }: { readonly status: string }): React.JSX.Element {
  const badge = STATUS_BADGE[status] ?? {
    className: 'bg-muted text-muted-foreground border-border',
    label: status,
  };
  return (
    <span
      className={cn(
        'inline-block px-1.5 py-0.5 rounded-sm text-[10px] font-semibold uppercase tracking-wide border',
        badge.className,
      )}
    >
      {badge.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// JSON preview helpers
// ---------------------------------------------------------------------------

function stringifyPayload(payload: unknown): string {
  if (payload == null) return '(no payload)';
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function stringifyResponseBody(body: string | null | undefined): string {
  if (!body) return '(no response body)';
  // Attempt to pretty-print JSON if it parses, otherwise show as-is.
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

// ---------------------------------------------------------------------------
// Delivery row
// ---------------------------------------------------------------------------

type DeliveryRowProps = {
  readonly delivery: WebhookDelivery;
};

function DeliveryRow({ delivery }: DeliveryRowProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const payloadJson = stringifyPayload(delivery.payload ?? null);
  const responseJson = stringifyResponseBody(delivery.responseBody);

  return (
    <div
      className="border-b border-border/40 last:border-b-0"
      data-testid={`delivery-row-${delivery.id}`}
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="w-full text-left py-2 px-3 hover:bg-accent/10 transition-colors flex items-center gap-2"
      >
        {expanded ? (
          <ChevronDown size={12} className="text-muted-foreground shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight size={12} className="text-muted-foreground shrink-0" aria-hidden="true" />
        )}

        <div
          className="text-[11px] font-mono text-muted-foreground shrink-0 w-[140px] truncate"
          title={formatDateTime(delivery.createdAt)}
        >
          {timeAgo(delivery.createdAt)}
        </div>

        <div
          className="text-[11px] font-mono text-foreground flex-1 truncate"
          title={delivery.eventType}
        >
          {delivery.eventType}
        </div>

        <StatusBadge status={delivery.status} />

        <div className="text-[11px] font-mono text-muted-foreground shrink-0 w-[48px] text-right tabular-nums">
          {delivery.statusCode ?? '—'}
        </div>

        <div
          className="text-[11px] font-mono text-muted-foreground shrink-0 w-[56px] text-right tabular-nums"
          title="Attempts"
        >
          {typeof delivery.attempts === 'number' ? `×${delivery.attempts}` : '—'}
        </div>
      </button>

      {expanded && (
        <div className="px-6 pb-3 pt-1 space-y-2 bg-muted/20">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              Delivery id
            </div>
            <div className="text-[11px] font-mono text-foreground break-all">{delivery.id}</div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              Payload
            </div>
            <pre
              data-testid={`delivery-payload-${delivery.id}`}
              className="text-[11px] font-mono text-foreground bg-background/60 border border-border rounded-md p-2 max-h-[240px] overflow-auto whitespace-pre-wrap break-words"
            >
              {payloadJson}
            </pre>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              Response body
            </div>
            <pre
              data-testid={`delivery-response-${delivery.id}`}
              className="text-[11px] font-mono text-foreground bg-background/60 border border-border rounded-md p-2 max-h-[200px] overflow-auto whitespace-pre-wrap break-words"
            >
              {responseJson}
            </pre>
          </div>

          {delivery.deliveredAt && (
            <div className="text-[10px] text-muted-foreground">
              Delivered {formatDateTime(delivery.deliveredAt)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export type WebhookDeliveriesPanelProps = {
  readonly subscriptionId: string;
};

export function WebhookDeliveriesPanel({
  subscriptionId,
}: WebhookDeliveriesPanelProps): React.JSX.Element {
  const q = useQuery(webhookDeliveriesQuery(subscriptionId));
  const deliveries = q.data?.deliveries ?? [];

  return (
    <div className="border border-border rounded-md bg-card" data-testid="webhook-deliveries-panel">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-muted/40">
        <div className="flex items-center gap-2">
          <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Recent deliveries
          </h3>
          {deliveries.length > 0 && (
            <span className="text-[10px] text-muted-foreground font-mono">{deliveries.length}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void q.refetch()}
          disabled={q.isFetching}
          data-testid="deliveries-refresh"
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border border-border bg-muted text-foreground hover:bg-accent/10 disabled:opacity-50"
          aria-label="Refresh deliveries"
        >
          <RefreshCw size={11} className={cn(q.isFetching && 'animate-spin')} aria-hidden="true" />
          {q.isFetching ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      {q.isLoading && (
        <div className="p-3 space-y-2" data-testid="deliveries-loading">
          {[1, 2, 3].map((k) => (
            <div key={k} className="h-8 rounded-md bg-muted/40 animate-pulse" />
          ))}
        </div>
      )}

      {!q.isLoading && q.error && (
        <div
          role="alert"
          data-testid="deliveries-error"
          className="p-3 text-xs text-red-400 flex items-center justify-between gap-2"
        >
          <span>
            Failed to load deliveries:{' '}
            {q.error instanceof Error ? q.error.message : String(q.error)}
          </span>
          <button
            type="button"
            onClick={() => void q.refetch()}
            className="px-2 py-1 rounded-md border border-red-500/30 bg-red-500/10 text-red-400 text-[11px] hover:bg-red-500/20"
          >
            Retry
          </button>
        </div>
      )}

      {!q.isLoading && !q.error && deliveries.length === 0 && (
        <div
          className="p-6 text-center text-xs text-muted-foreground"
          data-testid="deliveries-empty"
        >
          <Inbox size={18} className="mx-auto mb-2 text-muted-foreground/60" aria-hidden="true" />
          <p>No deliveries yet.</p>
          <p className="mt-1 text-[11px] text-muted-foreground/70">
            Use <span className="font-mono text-foreground">Test</span> to send a synthetic delivery
            or wait for a matching event.
          </p>
        </div>
      )}

      {!q.isLoading && !q.error && deliveries.length > 0 && (
        <div className="max-h-[420px] overflow-y-auto">
          {deliveries.map((d) => (
            <DeliveryRow key={d.id} delivery={d} />
          ))}
        </div>
      )}
    </div>
  );
}
