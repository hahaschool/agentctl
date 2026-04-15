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
  classifyDrift,
  classifySchemaDrift,
  type DriftRelation,
  formatVersionGroups,
  groupPeerVersions,
  hasMeshDrift,
  LOCAL_APP_VERSION,
  LOCAL_SCHEMA_VERSION,
  type SyncPeerWithVersion,
} from '@/lib/mesh-version';
import {
  syncPeersQuery,
  useDeleteSyncPeer,
  usePingSyncPeer,
  useProbeSyncUrl,
  useRegisterReverseSyncPeer,
  useUpdateSyncPeer,
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
// Ping diagnostics — roadmap §33.7
// ---------------------------------------------------------------------------

const PING_DIAGNOSTIC_MAX_CHARS = 120;

/**
 * Compose the compact diagnostic reason shown beneath the status badge.
 * Returns null when there is no useful signal (peer is reachable or no error
 * has been recorded yet).
 */
export function formatPingDiagnostic(
  peer: Pick<SyncPeer, 'syncStatus' | 'lastPingError' | 'lastPingStatusCode'>,
): { reason: string; truncated: boolean; full: string } | null {
  if (peer.syncStatus === 'reachable') return null;
  const rawError = peer.lastPingError;
  if (!rawError || rawError.length === 0) return null;

  const status = peer.lastPingStatusCode;
  const prefix = typeof status === 'number' && status > 0 ? `HTTP ${status} — ` : '';
  const full = `${prefix}${rawError}`;
  const truncated = full.length > PING_DIAGNOSTIC_MAX_CHARS;
  const reason = truncated ? `${full.slice(0, PING_DIAGNOSTIC_MAX_CHARS - 1)}…` : full;
  return { reason, truncated, full };
}

type PingDiagnosticLineProps = {
  peer: SyncPeer;
};

/**
 * §33.7 — Render the truncated ping-failure reason below the status badge.
 * Self-rows and reachable peers render nothing.
 */
function PingDiagnosticLine({ peer }: PingDiagnosticLineProps): React.JSX.Element | null {
  const diagnostic = formatPingDiagnostic(peer);
  if (!diagnostic) return null;

  const handleCopy = (): void => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(diagnostic.full);
  };

  return (
    <div
      data-testid={`peer-ping-diagnostic-${peer.machineId}`}
      className="mt-1 flex items-center gap-1.5"
    >
      <span
        title={diagnostic.full}
        className="text-[11px] font-mono text-muted-foreground truncate max-w-[240px]"
      >
        {diagnostic.reason}
      </span>
      {diagnostic.truncated && (
        <button
          type="button"
          onClick={handleCopy}
          data-testid={`peer-ping-diagnostic-copy-${peer.machineId}`}
          title="Copy full error"
          className="px-1.5 py-px rounded-sm text-[10px] font-medium border border-border bg-muted text-muted-foreground hover:bg-accent/10"
        >
          Copy
        </button>
      )}
    </div>
  );
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

function peerFormFromPeer(peer: SyncPeer): PeerFormState {
  return {
    machineId: peer.machineId,
    hostname: peer.hostname,
    tailscaleIp: peer.tailscaleIp ?? '',
    syncUrl: peer.syncUrl ?? '',
    syncIntervalSeconds: String(Math.max(1, Math.round(peer.syncIntervalMs / 1000))),
    publicKey: peer.publicKey ?? '',
  };
}

type PeerFormDialogProps = {
  open: boolean;
  peer: SyncPeer | null;
  onClose: () => void;
};

type ProbeState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | {
      kind: 'success';
      syncUrl: string;
      appVersion: string | null;
      statusCode: number | null;
    }
  | {
      kind: 'failure';
      syncUrl: string;
      reason: string;
      statusCode: number | null;
    };

function PeerFormDialog({ open, peer, onClose }: PeerFormDialogProps): React.JSX.Element | null {
  const toast = useToast();
  const upsertPeer = useUpsertSyncPeer();
  const probeMutation = useProbeSyncUrl();
  const [state, setState] = useState<PeerFormState>(() => emptyPeerForm());
  const [error, setError] = useState<string | null>(null);
  const [probeState, setProbeState] = useState<ProbeState>({ kind: 'idle' });
  const [probeOverridden, setProbeOverridden] = useState(false);

  const isUpdate = Boolean(peer);
  const key = open ? `open:${peer?.machineId ?? 'new'}` : 'closed';
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setState(peer ? peerFormFromPeer(peer) : emptyPeerForm());
    setError(null);
    setProbeState({ kind: 'idle' });
    setProbeOverridden(false);
  }

  if (!open) return null;

  const trimmedSyncUrl = state.syncUrl.trim();
  const syncUrlLength = trimmedSyncUrl.length;
  const syncUrlTooLong = syncUrlLength > MAX_SYNC_URL_LENGTH;
  const showSyncUrlCounter =
    syncUrlLength > 0 && syncUrlLength >= MAX_SYNC_URL_LENGTH - URL_LENGTH_COUNTER_THRESHOLD;

  // §33.7 — When the probe has succeeded for the current URL, Save is
  // unblocked. Otherwise the operator can either run the probe or override.
  const syncUrlLooksValid =
    trimmedSyncUrl.length > 0 && !syncUrlTooLong && isValidHttpUrl(trimmedSyncUrl);
  const probeMatchesCurrentUrl =
    (probeState.kind === 'success' || probeState.kind === 'failure') &&
    probeState.syncUrl === trimmedSyncUrl;
  const probePassed = probeState.kind === 'success' && probeMatchesCurrentUrl;
  const canProbe = syncUrlLooksValid && probeState.kind !== 'pending';
  // Gate Save ONLY when the URL is locally valid — invalid URLs should fall
  // through to the form validator so the operator sees the proper error.
  // Updates (existing peers) aren't blocked — preserves the "edit without
  // reprobing" UX from §33.5.
  const saveBlockedByProbe = !isUpdate && syncUrlLooksValid && !probePassed && !probeOverridden;

  const handleProbe = (): void => {
    if (!canProbe) return;
    setProbeState({ kind: 'pending' });
    probeMutation.mutate(trimmedSyncUrl, {
      onSuccess: (result) => {
        if (result.reachable) {
          setProbeState({
            kind: 'success',
            syncUrl: trimmedSyncUrl,
            appVersion: result.appVersion ?? null,
            statusCode: result.statusCode ?? null,
          });
        } else {
          setProbeState({
            kind: 'failure',
            syncUrl: trimmedSyncUrl,
            reason: result.error ?? 'Peer unreachable',
            statusCode: result.statusCode ?? null,
          });
        }
      },
      onError: (err) => {
        setProbeState({
          kind: 'failure',
          syncUrl: trimmedSyncUrl,
          reason: errorMessage(err, 'Probe failed'),
          statusCode: null,
        });
      },
    });
  };

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
        syncStatus: peer?.syncStatus ?? 'unknown',
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
        const machineId = res.peer?.machineId ?? result.body.machineId;
        toast.success(`Peer ${machineId} ${isUpdate ? 'updated' : 'saved'}`);
        // §33.8: surface reverse-registration outcome inline so the operator
        // learns about one-way meshes without hunting the row badge.
        const reverse = res.peer?.reverseRegistrationStatus ?? null;
        if (!isUpdate && reverse === 'ok') {
          toast.success(`Peer ${machineId} also registered this node in reverse`);
        } else if (!isUpdate && reverse === 'failed') {
          toast.error(
            `Peer ${machineId} saved but reverse registration failed — retry from the peer row`,
          );
        }
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
              {isUpdate ? 'Update mesh peer' : 'Add mesh peer'}
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
                  disabled={isUpdate}
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
              <div className="flex items-center gap-2">
                <input
                  id="mesh-peer-sync-url"
                  type="url"
                  value={state.syncUrl}
                  onChange={(e) => {
                    setState((p) => ({ ...p, syncUrl: e.target.value }));
                    // Invalidate previous probe when the URL changes.
                    setProbeState({ kind: 'idle' });
                    setProbeOverridden(false);
                  }}
                  aria-invalid={syncUrlTooLong || undefined}
                  aria-describedby={
                    syncUrlTooLong
                      ? 'mesh-peer-sync-url-error'
                      : showSyncUrlCounter
                        ? 'mesh-peer-sync-url-counter'
                        : undefined
                  }
                  className={cn(
                    'flex-1 bg-muted border rounded-md text-xs px-2 py-1.5 font-mono text-foreground',
                    syncUrlTooLong ? 'border-red-500/60' : 'border-border',
                  )}
                  placeholder="http://100.64.0.11:8080"
                />
                <button
                  type="button"
                  onClick={handleProbe}
                  disabled={!canProbe}
                  data-testid="mesh-peer-probe"
                  title="Probe the peer's /health endpoint"
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors whitespace-nowrap',
                    'border-border bg-muted hover:bg-accent/10 text-foreground',
                    'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-muted',
                  )}
                >
                  {probeState.kind === 'pending' ? 'Probing…' : 'Probe URL'}
                </button>
              </div>
              {probeMatchesCurrentUrl && probeState.kind === 'success' && (
                <p
                  data-testid="mesh-peer-probe-success"
                  className="mt-1 text-[11px] text-green-400"
                >
                  Reachable{probeState.statusCode ? ` (HTTP ${probeState.statusCode})` : ''}
                  {probeState.appVersion ? ` — peer v${probeState.appVersion}` : ''}
                </p>
              )}
              {probeMatchesCurrentUrl && probeState.kind === 'failure' && (
                <div
                  data-testid="mesh-peer-probe-failure"
                  className="mt-1 flex items-center gap-2 text-[11px] text-red-400"
                >
                  <span className="font-mono">
                    {probeState.statusCode ? `HTTP ${probeState.statusCode} — ` : ''}
                    {probeState.reason}
                  </span>
                  {!isUpdate && (
                    <button
                      type="button"
                      onClick={() => setProbeOverridden(true)}
                      data-testid="mesh-peer-probe-override"
                      className="px-1.5 py-px rounded-sm text-[10px] font-medium border border-red-500/40 bg-red-500/5 text-red-300 hover:bg-red-500/10"
                    >
                      Save anyway
                    </button>
                  )}
                </div>
              )}
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
              {isUpdate
                ? 'This updates the existing peer through the same idempotent save path. '
                : 'Role is fixed to '}
              {!isUpdate && <span className="font-mono text-foreground">full</span>}
              {!isUpdate && '. '}
              The backend still enforces URL and SSRF safety on save.
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
              disabled={upsertPeer.isPending || syncUrlTooLong || saveBlockedByProbe}
              data-testid="mesh-peer-submit"
              title={
                saveBlockedByProbe ? 'Probe the sync URL first, or choose Save anyway' : undefined
              }
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-[#3b82f6] text-white hover:bg-[#2563eb] disabled:opacity-50"
            >
              {upsertPeer.isPending ? 'Saving…' : isUpdate ? 'Update peer' : 'Save peer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Version cell — renders the peer's reported appVersion with a drift dot.
// ---------------------------------------------------------------------------

const DRIFT_DOT_CLASS: Record<DriftRelation, string> = {
  match: 'bg-green-500',
  ahead: 'bg-blue-500',
  behind: 'bg-yellow-500',
  unknown: 'bg-muted-foreground/30',
};

const DRIFT_LABEL: Record<DriftRelation, string> = {
  match: 'Peer version matches local',
  ahead: 'Peer is ahead of local — consider upgrading this node',
  behind: 'Peer is behind local',
  unknown: 'Peer version unknown',
};

type VersionCellProps = {
  peerVersion?: string | null;
  localVersion: string;
  isSelf: boolean;
};

function VersionCell({ peerVersion, localVersion, isSelf }: VersionCellProps): React.JSX.Element {
  // The self-row always matches itself; skip drift computation.
  const displayVersion = isSelf ? (peerVersion ?? localVersion) : (peerVersion ?? null);
  const relation: DriftRelation = isSelf ? 'match' : classifyDrift(peerVersion, localVersion);

  if (!displayVersion) {
    return (
      <span
        className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground/70"
        title="Peer has not reported version yet"
        data-testid="peer-version-missing"
      >
        <span className={cn('inline-block size-1.5 rounded-full', DRIFT_DOT_CLASS.unknown)} />—
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-xs text-foreground"
      title={DRIFT_LABEL[relation]}
      data-testid={`peer-version-${relation}`}
    >
      <span
        className={cn('inline-block size-1.5 rounded-full', DRIFT_DOT_CLASS[relation])}
        aria-hidden="true"
      />
      {displayVersion}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

type PeerRowProps = {
  peer: SyncPeerWithVersion;
  localVersion: string;
  onPing: (machineId: string) => void;
  onEdit: (peer: SyncPeer) => void;
  onDelete: (peer: SyncPeer) => void;
  onUpdate: (peer: SyncPeerWithVersion) => void;
  onRetryReverse: (peer: SyncPeer) => void;
  isPinging: boolean;
  pingingId: string | null;
  deletingId: string | null;
  updatingId: string | null;
  reverseRetryingId: string | null;
};

/**
 * A peer is "updatable" only when both versions are known and differ. We
 * intentionally do NOT enable the button when `peerVersion` is missing —
 * §33.11 slice 1 is opt-in per operator action, not a fleet-wide rollout.
 */
function canUpdatePeer(peer: SyncPeerWithVersion, localVersion: string): boolean {
  if (peer.isSelf) return false;
  if (!peer.syncUrl) return false;
  const peerVersion = peer.peerVersion ?? null;
  if (!peerVersion || !localVersion) return false;
  return peerVersion !== localVersion;
}

type ReverseBadgeProps = {
  peer: SyncPeer;
  onRetry: (peer: SyncPeer) => void;
  isRetrying: boolean;
};

/**
 * §33.8 — Show a compact "One-way" warning badge when reverse registration
 * failed. Self rows never render this (reverse registration is skipped).
 */
export function ReverseRegistrationBadge({
  peer,
  onRetry,
  isRetrying,
}: ReverseBadgeProps): React.JSX.Element | null {
  if (peer.isSelf) return null;
  const status = peer.reverseRegistrationStatus;
  if (status !== 'failed') return null;
  const tooltip = peer.reverseRegistrationError
    ? `Reverse registration failed: ${peer.reverseRegistrationError}`
    : 'Reverse registration failed';

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        data-testid={`reverse-badge-${peer.machineId}`}
        title={tooltip}
        className="px-1.5 py-px rounded-sm bg-yellow-500/15 text-yellow-400 text-[10px] font-semibold tracking-wide uppercase"
      >
        One-way
      </span>
      <button
        type="button"
        onClick={() => onRetry(peer)}
        disabled={isRetrying}
        data-testid={`reverse-retry-${peer.machineId}`}
        title="Retry reverse registration"
        className={cn(
          'px-1.5 py-px rounded-sm text-[10px] font-medium border border-yellow-500/40 bg-yellow-500/5 text-yellow-300 hover:bg-yellow-500/10',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        {isRetrying ? 'Retrying…' : 'Retry'}
      </button>
    </span>
  );
}

type PeerAheadBadgeProps = {
  peer: SyncPeerWithVersion;
  localSchemaVersion: number;
  updateAvailable: boolean;
};

/**
 * §33.10 — Per-row "Peer ahead" badge surfaced when a specific peer's
 * `peerSchemaVersion` is greater than the local node's schema version.
 *
 * Complements the aggregate drift banner (which shows app-version mix across
 * the mesh) by flagging the compatibility-relevant drift axis: schema. The
 * mesh envelope compat gate (`MESH_ENVELOPE_SCHEMA_AHEAD`) kicks in when a
 * peer is more than one schema ahead, so an inline nudge toward the existing
 * per-row Update button (33.11 slice 1) lets the operator close the window.
 *
 * Self-rows never render this badge. Behind/match/unknown also return null —
 * those cases are handled by the global drift banner or are non-actionable.
 *
 * When `updateAvailable` is false (e.g. the peer has no syncUrl), the badge
 * downgrades to a tooltip-only affordance with manual-update instructions.
 */
export function PeerAheadBadge({
  peer,
  localSchemaVersion,
  updateAvailable,
}: PeerAheadBadgeProps): React.JSX.Element | null {
  if (peer.isSelf) return null;
  const relation = classifySchemaDrift(peer.peerSchemaVersion, localSchemaVersion);
  if (relation !== 'ahead') return null;

  const peerSchema = peer.peerSchemaVersion ?? '?';
  const ariaLabel = `Peer ${peer.machineId} is ahead on schema version ${peerSchema}; update this node`;
  const tooltip = updateAvailable
    ? `Peer schema ${peerSchema} > local ${localSchemaVersion}. Click to jump to the Update button for this peer.`
    : `Peer schema ${peerSchema} > local ${localSchemaVersion}. This peer is not directly updatable from this node — pull the latest release on this control plane, or update the peer manually.`;

  const handleClick = (): void => {
    if (!updateAvailable) return;
    if (typeof document === 'undefined') return;
    const target = document.querySelector<HTMLButtonElement>(
      `[data-testid="update-${CSS.escape(peer.machineId)}"]`,
    );
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.focus();
  };

  const className = cn(
    'inline-flex items-center gap-1 px-1.5 py-px rounded-sm text-[10px] font-semibold tracking-wide uppercase',
    'bg-yellow-500/15 text-yellow-400',
    updateAvailable &&
      'hover:bg-yellow-500/25 focus:outline-none focus:ring-1 focus:ring-yellow-500/60',
  );

  if (!updateAvailable) {
    return (
      <output
        data-testid={`peer-ahead-badge-${peer.machineId}`}
        title={tooltip}
        aria-label={ariaLabel}
        className={className}
      >
        Peer ahead — update this node
      </output>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid={`peer-ahead-badge-${peer.machineId}`}
      title={tooltip}
      aria-label={ariaLabel}
      className={className}
    >
      Peer ahead — update this node
    </button>
  );
}

export function MeshPeerRow({
  peer,
  localVersion,
  onPing,
  onEdit,
  onDelete,
  onUpdate,
  onRetryReverse,
  isPinging,
  pingingId,
  deletingId,
  updatingId,
  reverseRetryingId,
}: PeerRowProps): React.JSX.Element {
  const thisRowIsPinging = isPinging && pingingId === peer.machineId;
  const canPing = Boolean(peer.syncUrl) && !peer.isSelf;
  const thisRowIsDeleting = deletingId === peer.machineId;
  const thisRowIsUpdating = updatingId === peer.machineId;
  const updatable = canUpdatePeer(peer, localVersion);
  const thisRowIsRetryingReverse = reverseRetryingId === peer.machineId;

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
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              'px-2 py-0.5 rounded-sm text-[10px] font-semibold tracking-wide uppercase',
              statusClasses(peer.syncStatus),
            )}
          >
            {peer.syncStatus}
          </span>
          <ReverseRegistrationBadge
            peer={peer}
            onRetry={onRetryReverse}
            isRetrying={thisRowIsRetryingReverse}
          />
          <PeerAheadBadge
            peer={peer}
            localSchemaVersion={LOCAL_SCHEMA_VERSION}
            updateAvailable={updatable}
          />
        </div>
        <PingDiagnosticLine peer={peer} />
      </td>
      <td className="px-4 py-3 align-top whitespace-nowrap">
        <VersionCell
          peerVersion={peer.peerVersion}
          localVersion={localVersion}
          isSelf={peer.isSelf}
        />
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
            onClick={() => onEdit(peer)}
            disabled={peer.isSelf}
            data-testid={`edit-${peer.machineId}`}
            title={peer.isSelf ? 'Cannot edit self' : 'Edit peer'}
            className={cn(
              'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
              'border-border bg-muted hover:bg-accent/10 text-foreground',
              'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-muted',
            )}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => onUpdate(peer)}
            disabled={!updatable || thisRowIsUpdating}
            data-testid={`update-${peer.machineId}`}
            title={
              peer.isSelf
                ? 'Cannot update self from this page'
                : !peer.syncUrl
                  ? 'Peer has no syncUrl configured'
                  : !peer.peerVersion
                    ? 'Peer has not reported a version yet'
                    : peer.peerVersion === localVersion
                      ? 'Peer already matches local version'
                      : `Update peer from ${peer.peerVersion} to ${localVersion}`
            }
            className={cn(
              'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
              'border-border bg-muted hover:bg-accent/10 text-foreground',
              'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-muted',
            )}
          >
            {thisRowIsUpdating ? 'Updating…' : 'Update'}
          </button>
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
  const updateMutation = useUpdateSyncPeer();
  const reverseRetryMutation = useRegisterReverseSyncPeer();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogPeer, setDialogPeer] = useState<SyncPeer | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SyncPeer | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<SyncPeerWithVersion | null>(null);

  const [driftBannerOpen, setDriftBannerOpen] = useState(false);
  const [driftBannerDismissed, setDriftBannerDismissed] = useState(false);

  const peers = (peersData.data?.peers ?? []) as SyncPeerWithVersion[];
  const reachableCount = peers.filter((p) => p.syncStatus === 'reachable').length;
  const unreachableCount = peers.filter((p) => p.syncStatus === 'unreachable').length;
  const versionGroups = groupPeerVersions(peers);
  const meshHasDrift = hasMeshDrift(peers, LOCAL_APP_VERSION);
  const showDriftBanner = meshHasDrift && !driftBannerDismissed;
  const driftSummary = formatVersionGroups(versionGroups);

  const openAddDialog = useCallback(() => {
    setDialogPeer(null);
    setDialogOpen(true);
  }, []);

  const openEditDialog = useCallback((peer: SyncPeer) => {
    if (peer.isSelf) return;
    setDialogPeer(peer);
    setDialogOpen(true);
  }, []);

  const closePeerDialog = useCallback(() => {
    setDialogOpen(false);
    setDialogPeer(null);
  }, []);

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

  const confirmUpdate = useCallback(() => {
    if (!pendingUpdate) return;
    const target = pendingUpdate;
    updateMutation.mutate(target.machineId, {
      onSuccess: (res) => {
        toast.success(
          `Peer ${target.machineId} updated: ${res.previousVersion} -> ${res.newVersion}`,
        );
        setPendingUpdate(null);
      },
      onError: (err) => {
        toast.error(errorMessage(err, 'Failed to update peer'));
        setPendingUpdate(null);
      },
    });
  }, [pendingUpdate, toast, updateMutation]);

  const pingingId = pingMutation.isPending
    ? ((pingMutation.variables as string | undefined) ?? null)
    : null;
  const deletingId = deleteMutation.isPending
    ? ((deleteMutation.variables as string | undefined) ?? null)
    : null;
  const updatingId = updateMutation.isPending
    ? ((updateMutation.variables as string | undefined) ?? null)
    : null;
  const reverseRetryingId = reverseRetryMutation.isPending
    ? ((reverseRetryMutation.variables as string | undefined) ?? null)
    : null;

  const handleRetryReverse = useCallback(
    (peer: SyncPeer) => {
      reverseRetryMutation.mutate(peer.machineId, {
        onSuccess: (res) => {
          if (res.ok) {
            toast.success(`Reverse registration for ${peer.machineId} succeeded`);
          } else {
            toast.error(
              res.message
                ? `Reverse registration still failing: ${res.message}`
                : `Reverse registration for ${peer.machineId} still failing`,
            );
          }
        },
        onError: (err) => {
          toast.error(errorMessage(err, 'Failed to retry reverse registration'));
        },
      });
    },
    [reverseRetryMutation, toast],
  );

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
            onClick={openAddDialog}
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

      {showDriftBanner && (
        <section
          data-testid="mesh-drift-banner"
          aria-label="Mesh version drift"
          className="mb-4 rounded-md border border-yellow-500/30 bg-yellow-500/5 text-foreground"
        >
          <div className="flex items-start gap-3 px-3 py-2">
            <button
              type="button"
              onClick={() => setDriftBannerOpen((prev) => !prev)}
              aria-expanded={driftBannerOpen}
              data-testid="mesh-drift-banner-toggle"
              className="flex-1 text-left text-xs font-mono text-foreground hover:text-yellow-300 focus:outline-none"
            >
              <span className="mr-2 inline-block size-1.5 rounded-full bg-yellow-500 align-middle" />
              Mesh on mixed versions: {driftSummary}
            </button>
            <button
              type="button"
              onClick={() => setDriftBannerDismissed(true)}
              data-testid="mesh-drift-banner-dismiss"
              className="text-[11px] text-muted-foreground hover:text-foreground"
              aria-label="Dismiss drift banner"
            >
              Dismiss
            </button>
          </div>
          {driftBannerOpen && (
            <ul
              data-testid="mesh-drift-banner-breakdown"
              className="border-t border-yellow-500/20 px-3 py-2 space-y-1"
            >
              {versionGroups.map((group) => (
                <li
                  key={group.version}
                  className="flex items-center justify-between text-[11px] font-mono text-muted-foreground"
                >
                  <span className="text-foreground">{group.version}</span>
                  <span>
                    {group.count} {group.count === 1 ? 'peer' : 'peers'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

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
            onClick={openAddDialog}
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
                  <th className="px-4 py-2 font-medium">Version</th>
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
                    localVersion={LOCAL_APP_VERSION}
                    onPing={handlePing}
                    onEdit={openEditDialog}
                    onDelete={setPendingDelete}
                    onUpdate={setPendingUpdate}
                    onRetryReverse={handleRetryReverse}
                    isPinging={pingMutation.isPending}
                    pingingId={pingingId}
                    deletingId={deletingId}
                    updatingId={updatingId}
                    reverseRetryingId={reverseRetryingId}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <PeerFormDialog open={dialogOpen} peer={dialogPeer} onClose={closePeerDialog} />

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

      {pendingUpdate && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="mesh-peer-update-title"
          data-testid="mesh-peer-update-confirm"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-sm rounded-md border border-border bg-card shadow-xl p-5">
            <h2 id="mesh-peer-update-title" className="text-sm font-semibold text-foreground">
              Update mesh peer?
            </h2>
            <p className="mt-2 text-xs text-muted-foreground">
              This triggers <span className="font-mono">scripts/peer-update.sh</span> on the peer.
              The peer will fetch <span className="font-mono">origin/main</span>, rebuild, and
              reload its PM2 ecosystem. Expect a brief outage on that node.
            </p>
            <p className="mt-1.5 text-[11px] font-mono text-foreground break-all">
              {pendingUpdate.machineId}
              {' · '}
              <span className="text-muted-foreground">
                {pendingUpdate.peerVersion ?? '?'} → {LOCAL_APP_VERSION}
              </span>
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingUpdate(null)}
                disabled={updateMutation.isPending}
                className="px-3 py-1.5 rounded-md border border-border bg-muted text-xs text-foreground hover:bg-accent/10 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmUpdate}
                disabled={updateMutation.isPending}
                data-testid="confirm-update-mesh-peer"
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-[#3b82f6] text-white hover:bg-[#2563eb] disabled:opacity-50"
              >
                {updateMutation.isPending ? 'Updating…' : 'Update'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
