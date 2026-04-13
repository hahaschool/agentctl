'use client';

import { useQuery } from '@tanstack/react-query';
import { RadioTower } from 'lucide-react';
import type React from 'react';
import { useCallback } from 'react';

import { ErrorBanner } from '@/components/ErrorBanner';
import { FetchingBar } from '@/components/FetchingBar';
import { RefreshButton } from '@/components/RefreshButton';
import { useToast } from '@/components/Toast';
import type { SyncPeer } from '@/lib/api';
import { syncPeersQuery, usePingSyncPeer } from '@/lib/queries';
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

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

type PeerRowProps = {
  peer: SyncPeer;
  onPing: (machineId: string) => void;
  isPinging: boolean;
  pingingId: string | null;
};

export function MeshPeerRow({
  peer,
  onPing,
  isPinging,
  pingingId,
}: PeerRowProps): React.JSX.Element {
  const thisRowIsPinging = isPinging && pingingId === peer.machineId;
  const canPing = Boolean(peer.syncUrl) && !peer.isSelf;

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

  const pingingId = pingMutation.isPending
    ? ((pingMutation.variables as string | undefined) ?? null)
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
        <RefreshButton
          onClick={() => void peersData.refetch()}
          isFetching={peersData.isFetching && !peersData.isLoading}
        />
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
            Peers are registered when machines join the Tailscale mesh and call{' '}
            <span className="font-mono">POST /api/sync/peers</span>.
          </p>
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
                    isPinging={pingMutation.isPending}
                    pingingId={pingingId}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
