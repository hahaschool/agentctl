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
