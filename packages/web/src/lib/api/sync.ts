// ---------------------------------------------------------------------------
// Mesh sync — peer listing + ping and sync-conflict review/resolution.
// ---------------------------------------------------------------------------

import { ApiError, request } from './core';

export type SyncConflictItem = {
  id: string;
  tableName: string;
  rowId: string;
  localVclock: Record<string, number>;
  localPayload: Record<string, unknown> | null;
  remoteVclock: Record<string, number>;
  remotePayload: Record<string, unknown> | null;
  remoteNodeId: string;
  status: 'pending' | 'resolved';
  resolution: 'local' | 'remote' | 'merged' | null;
  resolvedAt: string | null;
  createdAt: string;
};

export type SyncPeer = {
  machineId: string;
  hostname: string;
  tailscaleIp: string | null;
  syncUrl: string | null;
  role: string;
  syncStatus: string;
  syncIntervalMs: number;
  isSelf: boolean;
  publicKey: string | null;
  lastSeen: string | null;
  createdAt: string | null;
  // §33.7: ping diagnostics — category string (e.g. `timeout`, `http_status`)
  // and optional HTTP status. Both null on a successful probe.
  lastPingError?: string | null;
  lastPingStatusCode?: number | null;
  // §33.8: outbound reverse-registration outcome. Optional for backward
  // compatibility with older backends that pre-date the 0026 migration.
  reverseRegistrationStatus?: 'pending' | 'ok' | 'failed' | null;
  reverseRegistrationError?: string | null;
  reverseRegistrationAt?: string | null;
  // §33.12 Phase 3.1: structured error code + HTTP status for actionable
  // frontend guidance. Both null on success or when the peer's response was
  // not JSON.
  reverseRegistrationErrorCode?: string | null;
  reverseRegistrationHttpStatus?: number | null;
  // §33.10: schema-ahead envelope rejection tracking. When `schemaAheadCount`
  // is > 0, the apply-side compat gate has rejected one or more envelopes from
  // this peer because their `schemaVersion` exceeded the local CP by more than
  // one. `/mesh-peers` surfaces this as a red "Peer ahead — update this CP"
  // badge on the offending peer row.
  lastSchemaAheadVersion?: number | null;
  lastSchemaAheadAt?: string | null;
  schemaAheadCount?: number | null;
  // §33.8: mesh health panel. `lastPullAt`/`lastAckAt` come from the LEFT
  // JOIN on `sync_peer_cursors` — both fields track the shared `updated_at`
  // timestamp. Null when this control plane has never pulled or acked with
  // the peer yet, which the panel renders as "stale".
  lastPullAt?: string | null;
  lastAckAt?: string | null;
};

/**
 * §33.8 — Response from `GET /api/sync/peers/:peerId/cursors`. Used by the
 * mesh health panel to drill into raw pull / ack cursor state on row expansion.
 */
export type SyncPeerCursors = {
  machineId: string;
  localNodeId: string;
  remoteNodeId: string;
  pulledCursor: number;
  ackedCursor: number;
  lastPullAt: string | null;
  lastAckAt: string | null;
  updatedAt: string | null;
};

/**
 * §33.7 — Enriched Tailscale peer discovery candidate. Returned by
 * `GET /api/sync/peers/discover`. Each entry includes the result of probing
 * the candidate's `/health` endpoint so the UI can show reachability and
 * identity metadata inline.
 */
export type DiscoverCandidate = {
  hostname: string;
  tailscaleIp: string;
  syncUrl: string;
  reachable: boolean;
  machineId: string | null;
  nodePublicKey: string | null;
  appVersion: string | null;
  schemaVersion: number | null;
  error: string | null;
};

export type DiscoverSyncPeersResponse = {
  peers: DiscoverCandidate[];
  source: 'tailscale' | 'none';
};

/**
 * §33.7 — Response from `GET /api/sync/peers/probe?target=...`. A lightweight
 * pre-flight probe used by the add-peer dialog to validate a sync URL before
 * persisting. SSRF-validated on the backend side.
 */
export type ProbeSyncUrlResponse = {
  reachable: boolean;
  syncUrl: string;
  statusCode?: number;
  machineId?: string;
  nodePublicKey?: string;
  appVersion?: string;
  gitSha?: string;
  schemaVersion?: number;
  error?: string;
};

export type SyncPeersResponse = {
  peers: SyncPeer[];
};

export type UpsertSyncPeerInput = {
  machineId: string;
  hostname: string;
  tailscaleIp?: string | null;
  syncUrl: string;
  role?: string;
  syncStatus?: string;
  syncIntervalMs?: number;
  isSelf?: boolean;
  publicKey?: string | null;
};

export type UpsertSyncPeerResponse = {
  ok: boolean;
  peer: SyncPeer | null;
};

export type DeleteSyncPeerResponse = {
  ok: boolean;
  peer: SyncPeer;
};

export type PingSyncPeerResponse = {
  ok: boolean;
  status: 'reachable' | 'unreachable';
  peer: SyncPeer | null;
};

/**
 * Response from `POST /api/sync/peers/:peerId/update` — now returns
 * immediately with a jobId. The actual update runs asynchronously and
 * logs are streamed via SSE on `GET /:peerId/update/:jobId/log`.
 */
export type UpdateSyncPeerResponse = {
  jobId: string;
  status: 'started';
  previousVersion: string;
  /** Present when proxied through local CP to a remote peer. */
  remoteSyncUrl?: string;
};

/**
 * Error body returned by peers running the pre-async (pre-#697) peer-update
 * route. These peers finish the script synchronously and surface `exitCode`
 * + `stdoutTail` + `stderrTail` in the body of a non-2xx response. The
 * generic `ApiError` path would discard those fields; `UpdateSyncPeerFailedError`
 * preserves them so the UI can render the real failure reason instead of a
 * terse "exited with code N" toast.
 */
export type UpdateSyncPeerLegacyFailure = {
  error: string;
  message: string;
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
  remoteSyncUrl?: string;
};

export class UpdateSyncPeerFailedError extends Error {
  public readonly status: number;
  public readonly payload: UpdateSyncPeerLegacyFailure;
  constructor(status: number, payload: UpdateSyncPeerLegacyFailure) {
    super(payload.message);
    this.name = 'UpdateSyncPeerFailedError';
    this.status = status;
    this.payload = payload;
  }
}

function isLegacyFailurePayload(
  body: Record<string, unknown>,
): body is UpdateSyncPeerLegacyFailure {
  return (
    typeof body.message === 'string' &&
    typeof body.exitCode === 'number' &&
    typeof body.stdoutTail === 'string' &&
    typeof body.stderrTail === 'string'
  );
}

export type PeerUpdateLogLine = {
  stream: 'stdout' | 'stderr';
  text: string;
  ts: number;
};

export type PeerUpdateJobResult = {
  exitCode: number;
  durationMs: number;
  previousVersion: string;
  newVersion: string;
};

export type PeerUpdateStatusEvent = {
  status: 'running' | 'success' | 'failed';
  result?: PeerUpdateJobResult;
  error?: string;
};

export type ReverseRegisterSyncPeerResponse = {
  ok: boolean;
  status?: 'ok';
  error?: string;
  message?: string;
  peer: SyncPeer | null;
};

export const syncApi = {
  // Sync Conflicts
  listSyncConflicts: (params?: { status?: string; table?: string; remoteNodeId?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.table) searchParams.set('table', params.table);
    if (params?.remoteNodeId) searchParams.set('remoteNodeId', params.remoteNodeId);
    const qs = searchParams.toString();
    return request<{ conflicts: SyncConflictItem[]; total: number }>(
      `/api/sync/conflicts${qs ? `?${qs}` : ''}`,
    );
  },

  getSyncConflict: (id: string) =>
    request<SyncConflictItem>(`/api/sync/conflicts/${encodeURIComponent(id)}`),

  resolveSyncConflict: (
    id: string,
    body: { resolution: 'local' | 'remote' | 'merged'; payload?: Record<string, unknown> | null },
  ) =>
    request<{ ok: boolean; resolution: string }>(
      `/api/sync/conflicts/${encodeURIComponent(id)}/resolve`,
      {
        method: 'PUT',
        body: JSON.stringify(body),
      },
    ),

  getSyncConflictCount: () => request<{ count: number }>('/api/sync/conflicts/count'),

  // Mesh sync peers
  listSyncPeers: () => request<SyncPeersResponse>('/api/sync/peers'),

  upsertSyncPeer: (input: UpsertSyncPeerInput) =>
    request<UpsertSyncPeerResponse>('/api/sync/peers', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  deleteSyncPeer: (machineId: string) =>
    request<DeleteSyncPeerResponse>(`/api/sync/peers/${encodeURIComponent(machineId)}`, {
      method: 'DELETE',
    }),

  pingSyncPeer: (machineId: string) =>
    request<PingSyncPeerResponse>(`/api/sync/peers/${encodeURIComponent(machineId)}/ping`, {
      method: 'POST',
    }),

  /**
   * Custom fetch path (not the generic `request` helper) so we can surface the
   * full `stdoutTail`/`stderrTail` body that pre-async peers return on failure.
   * Callers should catch `UpdateSyncPeerFailedError` to render the real tail;
   * other non-2xx responses still throw the usual `ApiError`.
   */
  updateSyncPeer: async (machineId: string): Promise<UpdateSyncPeerResponse> => {
    const res = await fetch(`/api/sync/peers/${encodeURIComponent(machineId)}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }

    if (res.ok) {
      return body as UpdateSyncPeerResponse;
    }

    if (
      body &&
      typeof body === 'object' &&
      isLegacyFailurePayload(body as Record<string, unknown>)
    ) {
      throw new UpdateSyncPeerFailedError(res.status, body as UpdateSyncPeerLegacyFailure);
    }

    const fallback = body as { error?: string; message?: string; hint?: string };
    throw new ApiError(
      res.status,
      fallback.error ?? 'UNKNOWN',
      fallback.message ?? res.statusText,
      fallback.hint,
    );
  },

  /**
   * §33.8 — Retry reverse registration against an existing peer. Returns the
   * updated peer row regardless of outcome so the UI can refresh the inline
   * badge immediately.
   */
  registerReverseSyncPeer: (machineId: string) =>
    request<ReverseRegisterSyncPeerResponse>(
      `/api/sync/peers/${encodeURIComponent(machineId)}/register-reverse`,
      { method: 'POST' },
    ),

  /**
   * §33.8 — Fetch the `sync_peer_cursors` row for a peer. The mesh health
   * panel calls this on row expansion to reveal last-pull / last-ack state.
   */
  getSyncPeerCursors: (machineId: string) =>
    request<SyncPeerCursors>(`/api/sync/peers/${encodeURIComponent(machineId)}/cursors`),

  /**
   * §33.7 — Return a list of candidate Tailscale peers the operator could add.
   * Read-only; no DB writes. Empty when the Tailscale CLI is not available.
   */
  discoverSyncPeers: () => request<DiscoverSyncPeersResponse>('/api/sync/peers/discover'),

  /**
   * §33.7 — Probe a single candidate target (hostname, IP, or URL) and return
   * `/health` identity + version metadata. Used by the add-peer dialog's Probe
   * button to auto-fill `machineId`/`publicKey`/`syncUrl` before saving.
   */
  probeSyncUrl: (target: string) =>
    request<ProbeSyncUrlResponse>(`/api/sync/peers/probe?target=${encodeURIComponent(target)}`),
};

// ---------------------------------------------------------------------------
// SSE helpers for peer update log streaming
// ---------------------------------------------------------------------------

export type PeerUpdateSSECallbacks = {
  onLog: (line: PeerUpdateLogLine) => void;
  onStatus: (status: PeerUpdateStatusEvent) => void;
  onError: (error: string) => void;
  /** Called when SSE disconnects (expected during pm2 reload). */
  onDisconnect: () => void;
};

/**
 * Connect to the update log SSE stream. Returns an abort function.
 * The SSE connection will drop when pm2 reloads the remote process,
 * which is the expected happy-path completion signal.
 */
export function connectUpdateLogStream(
  machineId: string,
  jobId: string,
  callbacks: PeerUpdateSSECallbacks,
): () => void {
  const url = `/api/sync/peers/${encodeURIComponent(machineId)}/update/${encodeURIComponent(jobId)}/log`;
  const es = new EventSource(url);

  es.addEventListener('log', (e) => {
    try {
      callbacks.onLog(JSON.parse(e.data) as PeerUpdateLogLine);
    } catch {
      // ignore malformed events
    }
  });

  es.addEventListener('status', (e) => {
    try {
      callbacks.onStatus(JSON.parse(e.data) as PeerUpdateStatusEvent);
    } catch {
      // ignore malformed events
    }
  });

  es.onerror = () => {
    // EventSource fires 'error' on disconnect — this is expected when pm2
    // reload kills the remote process after a successful update.
    es.close();
    callbacks.onDisconnect();
  };

  return () => {
    es.close();
  };
}
