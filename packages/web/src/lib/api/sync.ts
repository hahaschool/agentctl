// ---------------------------------------------------------------------------
// Mesh sync — peer listing + ping and sync-conflict review/resolution.
// ---------------------------------------------------------------------------

import { request } from './core';

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
 * Response from `POST /api/sync/peers/:peerId/update` (roadmap §33.11 slice 1).
 * Only returned when `:peerId` matches the receiving node's local machine id —
 * otherwise the backend responds with a `PEER_UPDATE_NOT_LOCAL` 404 envelope.
 */
export type UpdateSyncPeerResponse = {
  status: 'success' | 'failed';
  durationMs: number;
  previousVersion: string;
  newVersion: string;
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
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

  updateSyncPeer: (machineId: string) =>
    request<UpdateSyncPeerResponse>(`/api/sync/peers/${encodeURIComponent(machineId)}/update`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

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
