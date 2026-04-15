/**
 * Mesh health summary helpers (roadmap §33.8).
 *
 * Computes the one-line summary shown above the `/mesh-peers` table:
 *
 *   "N peers · bidirectional · M one-way · K stale (no sync in >10 min)"
 *
 * The helper is a pure function — both the control plane and the web client
 * can call it on the same peer payload to derive identical counts.
 */

/**
 * A peer is considered "stale" when its `lastPullAt` cursor has not updated in
 * the last 10 minutes (or has never updated at all).
 */
export const MESH_STALE_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * Minimal shape required to derive a health summary. Accepts both the control
 * plane row shape (with `isSelf`) and richer shapes with extra fields.
 *
 * Self rows are excluded from the summary counts — the panel describes the
 * surrounding mesh, not this node itself.
 */
export type MeshPeerForHealth = {
  isSelf?: boolean | null;
  reverseRegistrationStatus?: 'pending' | 'ok' | 'failed' | null;
  lastPullAt?: string | null;
};

/**
 * Aggregated counts rendered as a single line above the peers table.
 *
 * - `total` — number of non-self peers.
 * - `bidirectional` — peers whose reverse registration succeeded (`'ok'`).
 * - `oneWay` — peers whose reverse registration has not succeeded (null,
 *   `'pending'`, or `'failed'`). Complement of `bidirectional`.
 * - `stale` — peers whose `lastPullAt` is null or older than the threshold.
 *   A peer can be both bidirectional and stale (orthogonal axes).
 */
export type MeshHealthSummary = {
  total: number;
  bidirectional: number;
  oneWay: number;
  stale: number;
};

function isStale(peer: MeshPeerForHealth, nowMs: number): boolean {
  const raw = peer.lastPullAt;
  if (!raw) return true;
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return true;
  return nowMs - ts > MESH_STALE_THRESHOLD_MS;
}

/**
 * Compute the mesh health summary for a peer list.
 *
 * `now` defaults to the current wall clock but tests should pass an explicit
 * epoch so the "stale" boundary is deterministic.
 */
export function summarizeMeshHealth(
  peers: readonly MeshPeerForHealth[],
  now: Date | number = Date.now(),
): MeshHealthSummary {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const summary: MeshHealthSummary = {
    total: 0,
    bidirectional: 0,
    oneWay: 0,
    stale: 0,
  };

  for (const peer of peers) {
    if (peer.isSelf) continue;
    summary.total += 1;
    if (peer.reverseRegistrationStatus === 'ok') {
      summary.bidirectional += 1;
    } else {
      summary.oneWay += 1;
    }
    if (isStale(peer, nowMs)) {
      summary.stale += 1;
    }
  }

  return summary;
}
