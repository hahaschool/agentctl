'use client';

import { useQuery } from '@tanstack/react-query';
import { RadioTower } from 'lucide-react';
import type React from 'react';
import { useCallback, useState } from 'react';

import { ErrorBanner } from '@/components/ErrorBanner';
import { FetchingBar } from '@/components/FetchingBar';
import { RefreshButton } from '@/components/RefreshButton';
import { useToast } from '@/components/Toast';
import type { SyncPeer, UpsertSyncPeerInput } from '@/lib/api';
import {
  syncPeersQuery,
  useDeleteSyncPeer,
  usePingSyncPeer,
  useUpsertSyncPeer,
} from '@/lib/queries';
import { MAX_SYNC_URL_LENGTH, URL_LENGTH_COUNTER_THRESHOLD } from '@/lib/ui-constants';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return 'unknown';
  const deltaMs = Date.now() - ts;
  if (deltaMs < 0) return 'just now';
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatInterval(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return `${minutes}m`;
}

const UNKNOWN_STATUS_CLASSES = 'bg-muted text-muted-foreground';

const STATUS_STYLES: Record<string, string> = {
  reachable: 'bg-green-500/15 text-green-400',
  unreachable: 'bg-red-500/15 text-red-400',
  unknown: UNKNOWN_STATUS_CLASSES,
};

function statusClasses(status: string): string {
  return STATUS_STYLES[status] ?? UNKNOWN_STATUS_CLASSES;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

// ---------------------------------------------------------------------------
// Dialog: add peer
// ---------------------------------------------------------------------------

type PeerFormState = {
  machineId: string;
  hostname: string;
  tailscaleIp: string;
  syncUrl: string;
  syncIntervalSeconds: string;
  publicKey: string;
};

function emptyPeerForm(): PeerFormState {
  return {
    machineId: '',
    hostname: '',
    tailscaleIp: '',
    syncUrl: '',
    syncIntervalSeconds: '30',
    publicKey: '',
  };
}

type PeerFormDialogProps = {
  open: boolean;
  onClose: () => void;
};

function PeerFormDialog({ open, onClose }: PeerFormDialogProps): React.JSX.Element | null {
  const toast = useToast();
  const upsertPeer = useUpsertSyncPeer();
  const [state, setState] = useState<PeerFormState>(() => emptyPeerForm());
  const [error, setError] = useState<string | null>(null);

  const key = open ? 'open' : 'closed';
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setState(emptyPeerForm());
    setError(null);
  }

  if (!open) return null;

  const trimmedSyncUrl = state.syncUrl.trim();
  const syncUrlLength = trimmedSyncUrl.length;
  const syncUrlTooLong = syncUrlLength > MAX_SYNC_URL_LENGTH;
  const showSyncUrlCounter =
    syncUrlLength > 0 && syncUrlLength >= MAX_SYNC_URL_LENGTH - URL_LENGTH_COUNTER_THRESHOLD;

  const validate = (): { body: UpsertSyncPeerInput } | { error: string } => {
    const machineId = state.machineId.trim();
    const hostname = state.hostname.trim();
    const syncUrl = trimmedSyncUrl;
    const intervalSeconds = Number(state.syncIntervalSeconds);

    if (!machineId) return { error: 'Machine ID is required' };
    if (!hostname) return { error: 'Hostname is required' };
    if (!syncUrl) return { error: 'Sync URL is required' };
    if (syncUrlTooLong) {
      return { error: `Sync URL too long (${syncUrlLength}/${MAX_SYNC_URL_LENGTH})` };
    }
    if (!isValidHttpUrl(syncUrl)) {
      return { error: 'Sync URL must be a valid http(s) URL without credentials' };
    }
    if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 300) {
      return { error: 'Sync interval must be an integer between 1 and 300 seconds' };
    }

    return {
      body: {
        machineId,
        hostname,
        syncUrl,
        tailscaleIp: state.tailscaleIp.trim() || null,
        role: 'full',
        syncStatus: 'unknown',
        syncIntervalMs: intervalSeconds * 1000,
        isSelf: false,
        publicKey: state.publicKey.trim() || null,
      },
    };
  };

  const handleSubmit = (evt: React.FormEvent<HTMLFormElement>): void => {
    evt.preventDefault();
    const result = validate();
    if ('error' in result) {
      setError(result.error);
      return;
    }

    setError(null);
    upsertPeer.mutate(result.body, {
      onSuccess: (res) => {
        toast.success(`Peer ${res.peer?.machineId ?? result.body.machineId} saved`);
        onClose();
      },
      onError: (err) => {
        setError(errorMessage(err, 'Failed to save peer'));
      },
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mesh-peer-form-title"
      data-testid="mesh-peer-form-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-xl rounded-md border border-border bg-card shadow-xl">
        <form onSubmit={handleSubmit} className="flex flex-col" noValidate>
          <div className="px-5 py-3 border-b border-border">
            <h2 id="mesh-peer-form-title" className="text-sm font-semibold text-foreground">
              Add mesh peer
            </h2>
          </div>

          <div className="px-5 py-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label
                  htmlFor="mesh-peer-machine-id"
                  className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1"
                >
                  Machine ID
                </label>
                <input
                  id="mesh-peer-machine-id"
                  value={state.machineId}
                  onChange={(e) => setState((p) => ({ ...p, machineId: e.target.value }))}
                  className="w-full bg-muted border border-border rounded-md text-xs px-2 py-1.5 font-mono text-foreground"
                  placeholder="machine-beta"
                />
              </div>

              <div>
                <label
                  htmlFor="mesh-peer-hostname"
                  className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1"
                >
                  Hostname
                </label>
                <input
                  id="mesh-peer-hostname"
                  value={state.hostname}
                  onChange={(e) => setState((p) => ({ ...p, hostname: e.target.value }))}
                  className="w-full bg-muted border border-border rounded-md text-xs px-2 py-1.5 font-mono text-foreground"
                  placeholder="beta.tail.ts.net"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="mesh-peer-sync-url"
                className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1"
              >
                Sync URL
              </label>
              <input
                id="mesh-peer-sync-url"
                type="url"
                value={state.syncUrl}
                onChange={(e) => setState((p) => ({ ...p, syncUrl: e.target.value }))}
                aria-invalid={syncUrlTooLong || undefined}
                aria-describedby={
                  syncUrlTooLong
                    ? 'mesh-peer-sync-url-error'
                    : showSyncUrlCounter
                      ? 'mesh-peer-sync-url-counter'
                      : undefined
                }
                className={cn(
                  'w-full bg-muted border rounded-md text-xs px-2 py-1.5 font-mono text-foreground',
                  syncUrlTooLong ? 'border-red-500/60' : 'border-border',
                )}
                placeholder="http://100.64.0.11:8080"
              />
              {syncUrlTooLong ? (
                <p
                  id="mesh-peer-sync-url-error"
                  role="alert"
                  data-testid="mesh-peer-sync-url-length-error"
                  className="mt-1 text-[11px] text-red-400"
                >
                  URL too long ({syncUrlLength}/{MAX_SYNC_URL_LENGTH})
                </p>
              ) : showSyncUrlCounter ? (
                <p
                  id="mesh-peer-sync-url-counter"
                  data-testid="mesh-peer-sync-url-length-counter"
                  className="mt-1 text-[11px] text-muted-foreground"
                >
                  {syncUrlLength}/{MAX_SYNC_URL_LENGTH}
                </p>
              ) : null}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label
                  htmlFor="mesh-peer-tailscale-ip"
                  className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1"
                >
                  Tailscale IP
                </label>
                <input
                  id="mesh-peer-tailscale-ip"
                  value={state.tailscaleIp}
                  onChange={(e) => setState((p) => ({ ...p, tailscaleIp: e.target.value }))}
                  className="w-full bg-muted border border-border rounded-md text-xs px-2 py-1.5 font-mono text-foreground"
                  placeholder="100.64.0.11"
                />
              </div>

              <div>
                <label
                  htmlFor="mesh-peer-sync-interval"
                  className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1"
                >
                  Sync interval seconds
                </label>
                <input
                  id="mesh-peer-sync-interval"
                  inputMode="numeric"
                  value={state.syncIntervalSeconds}
                  onChange={(e) => setState((p) => ({ ...p, syncIntervalSeconds: e.target.value }))}
                  className="w-full bg-muted border border-border rounded-md text-xs px-2 py-1.5 font-mono text-foreground"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="mesh-peer-public-key"
                className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1"
              >
                Public key
              </label>
              <input
                id="mesh-peer-public-key"
                value={state.publicKey}
                onChange={(e) => setState((p) => ({ ...p, publicKey: e.target.value }))}
                className="w-full bg-muted border border-border rounded-md text-xs px-2 py-1.5 font-mono text-foreground"
                placeholder="optional"
              />
            </div>

            <p className="text-[11px] text-muted-foreground">
              Role is fixed to <span className="font-mono text-foreground">full</span>. The backend
              still enforces URL and SSRF safety on save.
            </p>

            {error && (
              <p role="alert" className="text-xs text-red-400" data-testid="mesh-peer-form-error">
                {error}
              </p>
            )}
          </div>

          <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={upsertPeer.isPending}
              className="px-3 py-1.5 rounded-md border border-border bg-muted text-xs text-foreground hover:bg-accent/10 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={upsertPeer.isPending || syncUrlTooLong}
              data-testid="mesh-peer-submit"
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-[#3b82f6] text-white hover:bg-[#2563eb] disabled:opacity-50"
            >
              {upsertPeer.isPending ? 'Saving…' : 'Save peer'}
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

type PeerRowProps = {
  peer: SyncPeer;
  onPing: (machineId: string) => void;
  onDelete: (peer: SyncPeer) => void;
  isPinging: boolean;
  pingingId: string | null;
  deletingId: string | null;
};

export function MeshPeerRow({
  peer,
  onPing,
  onDelete,
  isPinging,
  pingingId,
  deletingId,
}: PeerRowProps): React.JSX.Element {
  const thisRowIsPinging = isPinging && pingingId === peer.machineId;
  const canPing = Boolean(peer.syncUrl) && !peer.isSelf;
  const thisRowIsDeleting = deletingId === peer.machineId;

  return (
    <tr className="border-t border-border hover:bg-accent/5">
      <td className="px-4 py-3 align-top">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-foreground">{peer.hostname}</span>
          {peer.isSelf && (
            <span className="px-1.5 py-px rounded-sm bg-primary/15 text-primary text-[10px] font-semibold">
              SELF
            </span>
          )}
        </div>
        <div className="font-mono text-[10px] text-muted-foreground mt-0.5 truncate max-w-[240px]">
          {peer.machineId}
        </div>
      </td>
      <td className="px-4 py-3 align-top">
        <span
          className={cn(
            'px-2 py-0.5 rounded-sm text-[10px] font-semibold tracking-wide uppercase',
            statusClasses(peer.syncStatus),
          )}
        >
          {peer.syncStatus}
        </span>
      </td>
      <td className="px-4 py-3 align-top font-mono text-xs text-muted-foreground">
        {peer.tailscaleIp ?? '—'}
      </td>
      <td className="px-4 py-3 align-top font-mono text-[11px] text-muted-foreground break-all max-w-[280px]">
        {peer.syncUrl ?? <span className="italic text-muted-foreground/60">not set</span>}
      </td>
      <td className="px-4 py-3 align-top text-xs text-muted-foreground whitespace-nowrap">
        {peer.role}
      </td>
      <td className="px-4 py-3 align-top text-xs text-muted-foreground whitespace-nowrap">
        {formatInterval(peer.syncIntervalMs)}
      </td>
      <td className="px-4 py-3 align-top text-xs text-muted-foreground whitespace-nowrap">
        {formatRelative(peer.lastSeen)}
      </td>
      <td className="px-4 py-3 align-top text-right whitespace-nowrap">
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onPing(peer.machineId)}
            disabled={!canPing || thisRowIsPinging}
            className={cn(
              'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
              'border-border bg-muted hover:bg-accent/10 text-foreground',
              'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-muted',
            )}
            title={
              peer.isSelf
                ? 'Cannot ping self'
                : !peer.syncUrl
                  ? 'Peer has no syncUrl configured'
                  : 'Ping via /health'
            }
            data-testid={`ping-${peer.machineId}`}
          >
            {thisRowIsPinging ? 'Pinging…' : 'Ping'}
          </button>
          <button
            type="button"
            onClick={() => onDelete(peer)}
            disabled={peer.isSelf || thisRowIsDeleting}
            data-testid={`delete-${peer.machineId}`}
            title={peer.isSelf ? 'Cannot delete self' : 'Delete peer'}
            className={cn(
              'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
              'border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20',
              'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-500/10',
            )}
          >
            {thisRowIsDeleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function MeshPeersPage(): React.JSX.Element {
  const toast = useToast();
  const peersData = useQuery(syncPeersQuery());
  const pingMutation = usePingSyncPeer();
  const deleteMutation = useDeleteSyncPeer();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SyncPeer | null>(null);

  const peers = peersData.data?.peers ?? [];
  const reachableCount = peers.filter((p) => p.syncStatus === 'reachable').length;
  const unreachableCount = peers.filter((p) => p.syncStatus === 'unreachable').length;

  const handlePing = useCallback(
    (machineId: string) => {
      pingMutation.mutate(machineId, {
        onSuccess: (result) => {
          if (result.status === 'reachable') {
            toast.success(`Peer ${machineId} is reachable`);
          } else {
            toast.error(`Peer ${machineId} is unreachable`);
          }
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : 'Failed to ping peer');
        },
      });
    },
    [pingMutation, toast],
  );

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    deleteMutation.mutate(target.machineId, {
      onSuccess: () => {
        toast.success(`Peer ${target.machineId} deleted`);
        setPendingDelete(null);
      },
      onError: (err) => {
        toast.error(errorMessage(err, 'Failed to delete peer'));
        setPendingDelete(null);
      },
    });
  }, [deleteMutation, pendingDelete, toast]);

  const pingingId = pingMutation.isPending
    ? ((pingMutation.variables as string | undefined) ?? null)
    : null;
  const deletingId = deleteMutation.isPending
    ? ((deleteMutation.variables as string | undefined) ?? null)
    : null;

  return (
    <div className="relative p-4 md:p-6 max-w-[1400px] animate-page-enter">
      <FetchingBar isFetching={peersData.isFetching && !peersData.isLoading} />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <RadioTower size={22} className="text-primary" aria-hidden="true" />
          <h1 className="text-[22px] font-semibold tracking-tight">Mesh Peers</h1>
          {reachableCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 text-xs font-semibold">
              {reachableCount} reachable
            </span>
          )}
          {unreachableCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 text-xs font-semibold">
              {unreachableCount} unreachable
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <RefreshButton
            onClick={() => void peersData.refetch()}
            isFetching={peersData.isFetching && !peersData.isLoading}
          />
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            data-testid="add-mesh-peer"
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-[#3b82f6] text-white hover:bg-[#2563eb]"
          >
            + Add peer
          </button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-4 max-w-[720px]">
        Tailscale mesh peers that this control plane syncs with. Each peer runs its own control
        plane and exchanges replicated state over an authenticated sync channel. Press{' '}
        <span className="font-mono text-foreground">Ping</span> to probe a peer&apos;s{' '}
        <span className="font-mono">/health</span> endpoint and refresh its status.
      </p>

      {peersData.error && (
        <ErrorBanner
          message={`Failed to load peers: ${peersData.error.message}`}
          onRetry={() => void peersData.refetch()}
          className="mb-4"
        />
      )}

      {peersData.isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((k) => (
            <div key={k} className="h-14 bg-muted/30 rounded-md animate-pulse" />
          ))}
        </div>
      )}

      {!peersData.isLoading && !peersData.error && peers.length === 0 && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          <p>No mesh peers registered.</p>
          <p className="mt-1 text-xs">
            Add a known mesh node or let a machine register through{' '}
            <span className="font-mono">POST /api/sync/peers</span>.
          </p>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            data-testid="empty-add-mesh-peer"
            className="mt-4 px-3 py-1.5 rounded-md text-xs font-medium bg-[#3b82f6] text-white hover:bg-[#2563eb]"
          >
            Add peer
          </button>
        </div>
      )}

      {peers.length > 0 && (
        <div className="border border-border rounded-md overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left" aria-label="Mesh sync peers">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Peer</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Tailscale IP</th>
                  <th className="px-4 py-2 font-medium">Sync URL</th>
                  <th className="px-4 py-2 font-medium">Role</th>
                  <th className="px-4 py-2 font-medium">Interval</th>
                  <th className="px-4 py-2 font-medium">Last Seen</th>
                  <th className="px-4 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {peers.map((peer) => (
                  <MeshPeerRow
                    key={peer.machineId}
                    peer={peer}
                    onPing={handlePing}
                    onDelete={setPendingDelete}
                    isPinging={pingMutation.isPending}
                    pingingId={pingingId}
                    deletingId={deletingId}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <PeerFormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />

      {pendingDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="mesh-peer-delete-title"
          data-testid="mesh-peer-delete-confirm"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-sm rounded-md border border-border bg-card shadow-xl p-5">
            <h2 id="mesh-peer-delete-title" className="text-sm font-semibold text-foreground">
              Delete mesh peer?
            </h2>
            <p className="mt-2 text-xs text-muted-foreground">
              This removes the peer registry entry and its sync cursor state from this control
              plane.
            </p>
            <p className="mt-1.5 text-[11px] font-mono text-foreground break-all">
              {pendingDelete.machineId}
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                disabled={deleteMutation.isPending}
                className="px-3 py-1.5 rounded-md border border-border bg-muted text-xs text-foreground hover:bg-accent/10 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleteMutation.isPending}
                data-testid="confirm-delete-mesh-peer"
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
