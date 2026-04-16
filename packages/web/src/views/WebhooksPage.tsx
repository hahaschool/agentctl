'use client';

import { useQuery } from '@tanstack/react-query';
import { Bell, Webhook as WebhookIcon } from 'lucide-react';
import type React from 'react';
import { useCallback, useState } from 'react';

import { EmptyState } from '@/components/EmptyState';
import { ErrorBanner } from '@/components/ErrorBanner';
import { FetchingBar } from '@/components/FetchingBar';
import { RefreshButton } from '@/components/RefreshButton';
import { useToast } from '@/components/Toast';
import { WebhookDeliveriesPanel } from '@/components/webhooks/WebhookDeliveriesPanel';
import {
  type CreateWebhookInput,
  type UpdateWebhookInput,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_PROVIDERS,
  type Webhook,
  type WebhookEventType,
  type WebhookProvider,
} from '@/lib/api';
import {
  useCreateWebhook,
  useDeleteWebhook,
  useTestWebhook,
  useUpdateWebhook,
  webhooksQuery,
} from '@/lib/queries';
import { MAX_WEBHOOK_URL_LENGTH, URL_LENGTH_COUNTER_THRESHOLD } from '@/lib/ui-constants';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return 'unknown';
  const delta = Date.now() - ts;
  if (delta < 0) return 'just now';
  const s = Math.floor(delta / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function isValidHttpUrl(v: string): boolean {
  try {
    const p = new URL(v);
    return p.protocol === 'http:' || p.protocol === 'https:';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Dialog: create / edit webhook
// ---------------------------------------------------------------------------

type WebhookFormState = {
  url: string;
  provider: WebhookProvider;
  secret: string;
  eventTypes: WebhookEventType[];
  active: boolean;
};

function emptyForm(): WebhookFormState {
  return {
    url: '',
    provider: 'generic',
    secret: '',
    eventTypes: [],
    active: true,
  };
}

function formFromWebhook(w: Webhook): WebhookFormState {
  return {
    url: w.url,
    provider: w.provider,
    secret: '',
    eventTypes: [...w.eventTypes],
    active: w.active,
  };
}

type WebhookFormDialogProps = {
  open: boolean;
  webhook: Webhook | null;
  onClose: () => void;
};

export function WebhookFormDialog({
  open,
  webhook,
  onClose,
}: WebhookFormDialogProps): React.JSX.Element | null {
  const toast = useToast();
  const createMut = useCreateWebhook();
  const updateMut = useUpdateWebhook();
  const isEdit = webhook !== null;
  const [state, setState] = useState<WebhookFormState>(() =>
    webhook ? formFromWebhook(webhook) : emptyForm(),
  );
  const [error, setError] = useState<string | null>(null);

  // Reset when dialog opens with a different target.
  const key = `${open ? 'open' : 'closed'}:${webhook?.id ?? 'new'}`;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setState(webhook ? formFromWebhook(webhook) : emptyForm());
    setError(null);
  }

  if (!open) return null;

  const toggleEvent = (e: WebhookEventType): void => {
    setState((prev) => ({
      ...prev,
      eventTypes: prev.eventTypes.includes(e)
        ? prev.eventTypes.filter((x) => x !== e)
        : [...prev.eventTypes, e],
    }));
  };

  const trimmedUrl = state.url.trim();
  const urlLength = trimmedUrl.length;
  const urlTooLong = urlLength > MAX_WEBHOOK_URL_LENGTH;
  const showUrlCounter =
    urlLength > 0 && urlLength >= MAX_WEBHOOK_URL_LENGTH - URL_LENGTH_COUNTER_THRESHOLD;

  const validate = (): string | null => {
    if (!trimmedUrl) return 'URL is required';
    if (urlTooLong) {
      return `URL too long (${urlLength}/${MAX_WEBHOOK_URL_LENGTH})`;
    }
    if (!isValidHttpUrl(trimmedUrl)) return 'URL must be a valid http(s) URL';
    if (state.eventTypes.length === 0) return 'Select at least one event type';
    return null;
  };

  const handleSubmit = (evt: React.FormEvent<HTMLFormElement>): void => {
    evt.preventDefault();
    const msg = validate();
    if (msg) {
      setError(msg);
      return;
    }
    setError(null);

    if (isEdit && webhook) {
      const patch: UpdateWebhookInput = {
        url: state.url.trim(),
        provider: state.provider,
        eventTypes: state.eventTypes,
        active: state.active,
      };
      if (state.secret.trim()) patch.secret = state.secret.trim();
      updateMut.mutate(
        { id: webhook.id, ...patch },
        {
          onSuccess: () => {
            toast.success('Webhook updated');
            onClose();
          },
          onError: (err) => toast.error(err instanceof Error ? err.message : 'Update failed'),
        },
      );
    } else {
      const body: CreateWebhookInput = {
        url: state.url.trim(),
        provider: state.provider,
        eventTypes: state.eventTypes,
      };
      if (state.secret.trim()) body.secret = state.secret.trim();
      createMut.mutate(body, {
        onSuccess: () => {
          toast.success('Webhook created');
          onClose();
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : 'Create failed'),
      });
    }
  };

  const busy = createMut.isPending || updateMut.isPending;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="webhook-form-title"
      data-testid="webhook-form-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-lg rounded-md border border-border bg-card shadow-xl">
        <form onSubmit={handleSubmit} className="flex flex-col" noValidate>
          <div className="px-5 py-3 border-b border-border">
            <h2 id="webhook-form-title" className="text-sm font-semibold text-foreground">
              {isEdit ? 'Edit webhook' : 'Add webhook'}
            </h2>
          </div>

          <div className="px-5 py-4 space-y-3">
            <div>
              <label
                htmlFor="webhook-url"
                className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1"
              >
                URL
              </label>
              <input
                id="webhook-url"
                type="url"
                value={state.url}
                onChange={(e) => setState((p) => ({ ...p, url: e.target.value }))}
                placeholder="https://example.com/hook"
                aria-invalid={urlTooLong || undefined}
                aria-describedby={
                  urlTooLong
                    ? 'webhook-url-error'
                    : showUrlCounter
                      ? 'webhook-url-counter'
                      : undefined
                }
                className={cn(
                  'w-full bg-muted border rounded-md text-xs px-2 py-1.5 font-mono text-foreground',
                  urlTooLong ? 'border-red-500/60' : 'border-border',
                )}
              />
              {urlTooLong ? (
                <p
                  id="webhook-url-error"
                  role="alert"
                  data-testid="webhook-url-length-error"
                  className="mt-1 text-[11px] text-red-400"
                >
                  URL too long ({urlLength}/{MAX_WEBHOOK_URL_LENGTH})
                </p>
              ) : showUrlCounter ? (
                <p
                  id="webhook-url-counter"
                  data-testid="webhook-url-length-counter"
                  className="mt-1 text-[11px] text-muted-foreground"
                >
                  {urlLength}/{MAX_WEBHOOK_URL_LENGTH}
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="webhook-provider"
                  className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1"
                >
                  Provider
                </label>
                <select
                  id="webhook-provider"
                  value={state.provider}
                  onChange={(e) =>
                    setState((p) => ({ ...p, provider: e.target.value as WebhookProvider }))
                  }
                  className="w-full bg-muted border border-border rounded-md text-xs px-2 py-1.5 text-foreground"
                >
                  {WEBHOOK_PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="webhook-secret"
                  className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1"
                >
                  Secret {isEdit && '(leave blank to keep)'}
                </label>
                <input
                  id="webhook-secret"
                  type="password"
                  value={state.secret}
                  onChange={(e) => setState((p) => ({ ...p, secret: e.target.value }))}
                  placeholder="optional HMAC secret"
                  className="w-full bg-muted border border-border rounded-md text-xs px-2 py-1.5 font-mono text-foreground"
                />
              </div>
            </div>

            <fieldset>
              <legend className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                Event types
              </legend>
              <div
                data-testid="webhook-event-types"
                className="grid grid-cols-2 gap-1.5 border border-border rounded-md p-2 bg-muted/30"
              >
                {WEBHOOK_EVENT_TYPES.map((e) => {
                  const checked = state.eventTypes.includes(e);
                  return (
                    <label
                      key={e}
                      className="flex items-center gap-1.5 text-[11px] font-mono text-foreground cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleEvent(e)}
                        data-testid={`event-${e}`}
                      />
                      {e}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {isEdit && (
              <label className="flex items-center gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={state.active}
                  onChange={(e) => setState((p) => ({ ...p, active: e.target.checked }))}
                  data-testid="webhook-active"
                />
                Active
              </label>
            )}

            {error && (
              <p role="alert" className="text-xs text-red-400" data-testid="form-error">
                {error}
              </p>
            )}
          </div>

          <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-3 py-1.5 rounded-md border border-border bg-muted text-xs text-foreground hover:bg-accent/10 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || urlTooLong}
              data-testid="webhook-submit"
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-medium',
                'bg-primary text-white hover:bg-primary/90 disabled:opacity-50',
              )}
            >
              {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create webhook'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

type WebhookRowProps = {
  webhook: Webhook;
  onEdit: (w: Webhook) => void;
  onDelete: (w: Webhook) => void;
  onTest: (w: Webhook) => void;
  onViewDeliveries: (w: Webhook) => void;
  testingId: string | null;
};

export function WebhookRow({
  webhook,
  onEdit,
  onDelete,
  onTest,
  onViewDeliveries,
  testingId,
}: WebhookRowProps): React.JSX.Element {
  const isTesting = testingId === webhook.id;
  return (
    <tr className="border-t border-border hover:bg-accent/5 align-top">
      <td className="px-3 py-2.5 text-xs">
        <div className="font-mono text-foreground truncate max-w-[220px]" title={webhook.provider}>
          {webhook.provider}
        </div>
        <div
          className="font-mono text-[10px] text-muted-foreground mt-0.5 truncate max-w-[220px]"
          title={webhook.id}
        >
          {webhook.id}
        </div>
      </td>
      <td className="px-3 py-2.5 text-[11px] font-mono text-muted-foreground max-w-[320px]">
        <div className="truncate" title={webhook.url}>
          {webhook.url}
        </div>
      </td>
      <td className="px-3 py-2.5 text-[11px] text-muted-foreground max-w-[280px]">
        <div className="flex flex-wrap gap-1">
          {webhook.eventTypes.map((e) => (
            <span
              key={e}
              className="px-1.5 py-px rounded-sm bg-muted text-[10px] font-mono text-foreground border border-border"
            >
              {e}
            </span>
          ))}
        </div>
      </td>
      <td className="px-3 py-2.5 text-xs whitespace-nowrap">
        {webhook.active ? (
          <span className="px-1.5 py-0.5 rounded-sm bg-primary/15 text-primary text-[10px] font-semibold uppercase tracking-wide">
            Active
          </span>
        ) : (
          <span className="px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground text-[10px] font-semibold uppercase tracking-wide">
            Paused
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-[11px] text-muted-foreground whitespace-nowrap">
        {formatRelative(webhook.createdAt)}
      </td>
      <td className="px-3 py-2.5 text-[11px] text-muted-foreground whitespace-nowrap">
        {formatRelative(webhook.updatedAt)}
      </td>
      <td className="px-3 py-2.5 text-right whitespace-nowrap">
        <div className="inline-flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onTest(webhook)}
            disabled={isTesting}
            data-testid={`test-${webhook.id}`}
            className="px-2 py-1 rounded-md text-[11px] border border-border bg-muted text-foreground hover:bg-accent/10 disabled:opacity-50"
          >
            {isTesting ? 'Testing…' : 'Test'}
          </button>
          <button
            type="button"
            onClick={() => onViewDeliveries(webhook)}
            data-testid={`deliveries-${webhook.id}`}
            className="px-2 py-1 rounded-md text-[11px] border border-border bg-muted text-foreground hover:bg-accent/10"
          >
            Deliveries
          </button>
          <button
            type="button"
            onClick={() => onEdit(webhook)}
            data-testid={`edit-${webhook.id}`}
            className="px-2 py-1 rounded-md text-[11px] border border-border bg-muted text-foreground hover:bg-accent/10"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => onDelete(webhook)}
            data-testid={`delete-${webhook.id}`}
            className="px-2 py-1 rounded-md text-[11px] border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function WebhooksPage(): React.JSX.Element {
  const toast = useToast();
  const webhooksQ = useQuery(webhooksQuery());
  const deleteMut = useDeleteWebhook();
  const testMut = useTestWebhook();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Webhook | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Webhook | null>(null);
  const [deliveriesTarget, setDeliveriesTarget] = useState<Webhook | null>(null);

  const webhooks = webhooksQ.data?.subscriptions ?? [];
  const activeCount = webhooks.filter((w) => w.active).length;

  const openCreate = useCallback(() => {
    setEditTarget(null);
    setDialogOpen(true);
  }, []);

  const handleEdit = useCallback((w: Webhook) => {
    setEditTarget(w);
    setDialogOpen(true);
  }, []);

  const handleDelete = useCallback((w: Webhook) => {
    setPendingDelete(w);
  }, []);

  const handleViewDeliveries = useCallback((w: Webhook) => {
    setDeliveriesTarget(w);
  }, []);

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    deleteMut.mutate(target.id, {
      onSuccess: () => {
        toast.success('Webhook deleted');
        setPendingDelete(null);
      },
      onError: (err) => {
        toast.error(err instanceof Error ? err.message : 'Delete failed');
        setPendingDelete(null);
      },
    });
  }, [deleteMut, pendingDelete, toast]);

  const handleTest = useCallback(
    (w: Webhook) => {
      testMut.mutate(w.id, {
        onSuccess: (result) => {
          if (result.ok) {
            toast.success(`Test delivered (${String(result.delivery.statusCode ?? 'ok')})`);
          } else {
            toast.error(
              `Test failed${
                result.delivery.statusCode ? ` (${String(result.delivery.statusCode)})` : ''
              }`,
            );
          }
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : 'Test failed'),
      });
    },
    [testMut, toast],
  );

  const testingId = testMut.isPending ? ((testMut.variables as string | undefined) ?? null) : null;

  return (
    <div className="relative p-4 md:p-6 max-w-[1400px] animate-page-enter">
      <FetchingBar isFetching={webhooksQ.isFetching && !webhooksQ.isLoading} />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <WebhookIcon size={22} className="text-primary" aria-hidden="true" />
          <h1 className="text-[22px] font-semibold tracking-tight">Webhooks</h1>
          {webhooks.length > 0 && (
            <span className="px-2 py-0.5 rounded-sm bg-muted text-muted-foreground text-[10px] font-semibold uppercase tracking-wide">
              {activeCount} / {webhooks.length} active
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <RefreshButton
            onClick={() => void webhooksQ.refetch()}
            isFetching={webhooksQ.isFetching && !webhooksQ.isLoading}
          />
          <button
            type="button"
            onClick={openCreate}
            data-testid="add-webhook"
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-white hover:bg-primary/90"
          >
            + Add Webhook
          </button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-4 max-w-[720px]">
        HTTP webhook subscriptions. Each subscription receives event payloads for the selected event
        types. Use <span className="font-mono text-foreground">Test</span> to send a synthetic
        delivery and verify endpoint connectivity.
      </p>

      {webhooksQ.error && (
        <ErrorBanner
          message={`Failed to load webhooks: ${webhooksQ.error.message}`}
          onRetry={() => void webhooksQ.refetch()}
          className="mb-4"
        />
      )}

      {webhooksQ.isLoading && (
        <div className="space-y-2" data-testid="loading-skeletons">
          {[1, 2, 3].map((k) => (
            <div key={k} className="h-12 bg-muted/30 rounded-md animate-pulse" />
          ))}
        </div>
      )}

      {!webhooksQ.isLoading && !webhooksQ.error && webhooks.length === 0 && (
        <EmptyState
          icon={Bell}
          title="No webhook subscriptions yet"
          description="Create one to receive event payloads at an HTTP endpoint."
          action={
            <button
              type="button"
              onClick={openCreate}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-white hover:bg-primary/90"
            >
              + Add Webhook
            </button>
          }
        />
      )}

      {webhooks.length > 0 && (
        <div className="border border-border rounded-md overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left" aria-label="Webhook subscriptions">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Provider / ID</th>
                  <th className="px-3 py-2 font-medium">URL</th>
                  <th className="px-3 py-2 font-medium">Events</th>
                  <th className="px-3 py-2 font-medium">State</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2 font-medium">Updated</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {webhooks.map((w) => (
                  <WebhookRow
                    key={w.id}
                    webhook={w}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onTest={handleTest}
                    onViewDeliveries={handleViewDeliveries}
                    testingId={testingId}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <WebhookFormDialog
        open={dialogOpen}
        webhook={editTarget}
        onClose={() => setDialogOpen(false)}
      />

      {deliveriesTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="webhook-deliveries-title"
          data-testid="webhook-deliveries-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-2xl rounded-md border border-border bg-card shadow-xl flex flex-col max-h-[85vh]">
            <div className="flex items-start justify-between gap-3 px-5 py-3 border-b border-border">
              <div className="min-w-0">
                <h2 id="webhook-deliveries-title" className="text-sm font-semibold text-foreground">
                  Delivery history
                </h2>
                <p
                  className="mt-0.5 text-[11px] font-mono text-muted-foreground truncate"
                  title={deliveriesTarget.url}
                >
                  {deliveriesTarget.url}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeliveriesTarget(null)}
                data-testid="deliveries-close"
                className="px-2 py-1 rounded-md border border-border bg-muted text-[11px] text-foreground hover:bg-accent/10"
              >
                Close
              </button>
            </div>
            <div className="px-5 py-4 overflow-y-auto">
              <WebhookDeliveriesPanel subscriptionId={deliveriesTarget.id} />
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="webhook-delete-title"
          data-testid="webhook-delete-confirm"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-sm rounded-md border border-border bg-card shadow-xl p-5">
            <h2 id="webhook-delete-title" className="text-sm font-semibold text-foreground">
              Delete webhook?
            </h2>
            <p className="mt-2 text-xs text-muted-foreground break-all">
              This will permanently remove the subscription and all delivery history.
            </p>
            <p className="mt-1.5 text-[11px] font-mono text-foreground break-all">
              {pendingDelete.url}
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                disabled={deleteMut.isPending}
                className="px-3 py-1.5 rounded-md border border-border bg-muted text-xs text-foreground hover:bg-accent/10 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleteMut.isPending}
                data-testid="confirm-delete"
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
              >
                {deleteMut.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
