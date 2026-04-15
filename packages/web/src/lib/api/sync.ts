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
  // §33.8: outbound reverse-registration outcome. Optional for backward
  // compatibility with older backends that pre-date the 0026 migration.
  reverseRegistrationStatus?: 'pending' | 'ok' | 'failed' | null;
  reverseRegistrationError?: string | null;
  reverseRegistrationAt?: string | null;
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
};
