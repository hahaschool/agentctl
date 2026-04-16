import type { VectorClock } from '../vector-clock.js';

/** Which sync strategy applies to a table. */
export type TableSyncType = 'append-only' | 'mutable' | 'local-only';

/**
 * Mesh envelope metadata stamped on every outbound change by the producer.
 *
 * - `schemaVersion` — highest applied migration sequence number on the producer
 *   (see roadmap 33.9 definition).
 * - `protocolVersion` — mesh wire-format version. Starts at 1; widening policy
 *   is documented in `docs/MESH_COMPAT.md`.
 * - `producerVersion` — producer's `appVersion` from `package.json` (e.g. `0.4.0`).
 *
 * REQUIRED on new envelopes; the apply-side compat gate treats the whole `meta`
 * field as optional for backward compatibility with legacy producers.
 */
export type MeshEnvelopeMeta = {
  schemaVersion: number;
  protocolVersion: number;
  producerVersion: string;
};

/** Current mesh protocol version. Bump when the wire format changes. */
export const MESH_PROTOCOL_VERSION = 1;
/** Minimum accepted mesh protocol version (inclusive). */
export const MESH_PROTOCOL_MIN = 1;
/** Maximum accepted mesh protocol version (inclusive). */
export const MESH_PROTOCOL_MAX = 1;

/** A single change log entry as stored in sync_change_log. */
export type ChangeLogEntry = {
  id: number;
  nodeId: string;
  tableName: string;
  rowId: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  payload: Record<string, unknown> | null;
  vclock: VectorClock;
  createdAt: Date;
  synced: boolean;
  /**
   * Mesh envelope metadata stamped by the producer at serialize time.
   * Optional to keep backward compatibility with legacy producers that
   * pre-date roadmap 33.10. New producers MUST set this field.
   */
  meta?: MeshEnvelopeMeta;
};

/** A detected conflict between local and remote changes. */
export type SyncConflict = {
  id: string;
  tableName: string;
  rowId: string;
  localVclock: VectorClock;
  localPayload: Record<string, unknown> | null;
  remoteVclock: VectorClock;
  remotePayload: Record<string, unknown> | null;
  remoteNodeId: string;
  status: 'pending' | 'resolved';
  resolution: 'local' | 'remote' | 'merged' | null;
  resolvedAt: Date | null;
  createdAt: Date;
};

/** A node in the mesh network. */
export type SyncNode = {
  id: string;
  hostname: string;
  tailscaleIp: string | null;
  role: 'full' | 'worker-only';
  lastSeen: Date | null;
  createdAt: Date;
  /**
   * Peer version observability (roadmap §33.9).
   *
   * All three fields are optional/nullable until every peer in the mesh has
   * shipped the /health change that advertises them. Older peers will simply
   * leave these as `null`, which downstream UIs should render as "unknown".
   */
  peerVersion?: string | null;
  peerGitSha?: string | null;
  peerSchemaVersion?: number | null;
  /**
   * Ping diagnostics (roadmap §33.4 + §33.7).
   *
   * Populated by the control plane health-check loop and the manual `/ping`
   * endpoint. `lastPingError` is a short category string (e.g. `timeout`,
   * `connect_refused`, `http_status`) and `lastPingStatusCode` is the HTTP
   * status code when the peer responded with a non-OK status. Both are null
   * on a successful probe.
   */
  lastPingError?: string | null;
  lastPingStatusCode?: number | null;
  /**
   * Outbound reverse registration outcome (roadmap §33.8).
   *
   * When an operator adds a peer locally, the control plane calls the peer's
   * `POST /api/sync/peers/register` endpoint so the mesh becomes symmetric
   * without manual ceremony. These fields expose that outcome so UIs can
   * render a "one-way" badge + retry button when it failed.
   */
  reverseRegistrationStatus?: 'pending' | 'ok' | 'failed' | null;
  reverseRegistrationError?: string | null;
  reverseRegistrationAt?: string | null;
  /**
   * Structured error details for reverse registration (roadmap §33.12 Phase 3.1).
   *
   * `reverseRegistrationErrorCode` is a machine-readable code extracted from the
   * peer's JSON response (e.g. `TOKEN_MISMATCH`, `SIGNATURE_INVALID`,
   * `NETWORK_ERROR`). `reverseRegistrationHttpStatus` is the HTTP status when the
   * peer responded with a non-OK status. Both are null on success or when the peer
   * returned a non-JSON error body.
   */
  reverseRegistrationErrorCode?: string | null;
  reverseRegistrationHttpStatus?: number | null;
  /**
   * Mesh envelope schema-ahead rejection tracking (roadmap §33.10).
   *
   * When the apply-side compat gate (`MESH_ENVELOPE_SCHEMA_AHEAD`) rejects a
   * change-log envelope from this peer because its `schemaVersion` exceeds the
   * local control plane's schema by more than 1, we persist the event here so
   * `/mesh-peers` can surface a red "Peer ahead — update this CP" badge on the
   * offending peer row.
   *
   * - `lastSchemaAheadVersion` — `schemaVersion` from the most recently
   *   rejected envelope, or `null` when no rejection has been recorded.
   * - `lastSchemaAheadAt` — ISO-8601 timestamp of the most recent rejection,
   *   or `null` when no rejection has been recorded.
   * - `schemaAheadCount` — rolling count of rejected envelopes. `0` (or
   *   nullish) indicates no rejections recorded. UIs should render the badge
   *   whenever this is > 0.
   */
  lastSchemaAheadVersion?: number | null;
  lastSchemaAheadAt?: string | null;
  schemaAheadCount?: number | null;
  /**
   * Cursor timestamps derived from `sync_peer_cursors` (roadmap §33.8).
   *
   * Used by the mesh health panel to classify a peer as "stale" when
   * `lastPullAt` has not advanced in the last 10 minutes, and by the row
   * drill-down to surface the exact pull/ack cursor state.
   *
   * Both fields are optional for backward compatibility with responses from
   * older control planes that pre-date the mesh health panel.
   */
  lastPullAt?: string | null;
  lastAckAt?: string | null;
};

/**
 * Classification of all tables for sync purposes.
 *
 * - append-only: Records are created once, never updated across nodes.
 *   PK must be globally unique (UUID). Auto-merge by deduplication.
 * - mutable: Records can be updated. Uses vector clocks for conflict detection.
 * - local-only: Not synced between nodes.
 *
 * NOTE: agent_actions has bigserial PK (not globally unique). The trigger uses
 * its sync_id UUID column instead. See drizzle/0021 migration.
 */
export const TABLE_SYNC_CONFIG: Record<string, TableSyncType> = {
  // Append-only (4 tables) — truly insert-only, never updated
  agent_actions: 'append-only', // trigger uses sync_id UUID, not bigserial id
  session_handoffs: 'append-only',
  native_import_attempts: 'append-only',
  run_handoff_decisions: 'append-only',
  // Mutable (11 tables) — receive status updates, need vector clock conflict detection
  agents: 'mutable',
  machines: 'mutable',
  agent_runs: 'mutable', // status updates: running→success/failure
  rc_sessions: 'mutable', // status updates: active→ended
  managed_sessions: 'mutable', // status updates during lifecycle
  project_account_mappings: 'mutable',
  settings: 'mutable', // PK = 'key' (not 'id')
  runtime_config_revisions: 'mutable',
  memory_scopes: 'mutable', // PK = 'scope' (not 'id')
  memory_facts: 'mutable',
  memory_edges: 'mutable',
  // Local-only (not synced)
  machine_runtime_state: 'local-only',
  api_accounts: 'local-only', // encrypted credentials must not auto-replicate
  sync_change_log: 'local-only',
  sync_nodes: 'local-only',
  sync_conflicts: 'local-only',
  sync_peer_cursors: 'local-only',
} as const;

/** List of table names that have sync triggers attached (15 tables). */
export const SYNCED_TABLES = Object.entries(TABLE_SYNC_CONFIG)
  .filter(([, type]) => type !== 'local-only')
  .map(([name]) => name);

/**
 * Map of table name → PK column used by the sync trigger.
 * Most tables use 'id', but settings uses 'key', memory_scopes uses 'scope',
 * and agent_actions uses 'sync_id' (UUID, globally unique).
 */
export const TABLE_PK_COLUMN: Record<string, string> = {
  settings: 'key',
  memory_scopes: 'scope',
  agent_actions: 'sync_id',
};

/** Get the PK column name for a synced table. Defaults to 'id'. */
export function getTablePkColumn(tableName: string): string {
  return TABLE_PK_COLUMN[tableName] ?? 'id';
}
