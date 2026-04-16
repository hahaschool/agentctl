// ---------------------------------------------------------------------------
// Mesh version helpers — roadmap 33.9
//
// Surfaces peer `appVersion` on the `/mesh-peers` UI and the sidebar footer.
// The shared `SyncPeer` type will gain `peerVersion` / `peerGitSha` /
// `peerSchemaVersion` via PR #555. Until that lands, we model those optional
// fields locally so rendering degrades gracefully when the backend hasn't
// reported them yet.
// ---------------------------------------------------------------------------

import { useQuery } from '@tanstack/react-query';

import type { SyncPeer } from './api';
import { versionCompatQuery } from './queries';

/**
 * Hardcoded fallback used only while the `/api/version-compat` fetch is
 * in-flight. All runtime consumers should prefer `useLocalVersion()` which
 * fetches the live value from the control-plane's `/api/version-compat`
 * endpoint — this eliminates the stale-constant problem that caused version
 * display mismatches across mesh nodes (each node built its own web bundle
 * with a potentially outdated constant).
 *
 * @deprecated Prefer `useLocalVersion()` in React components.
 */
export const LOCAL_APP_VERSION = 'v0.6.0';

/**
 * React hook that returns the live `appVersion` from the local control-plane
 * via `/api/version-compat`. Falls back to `LOCAL_APP_VERSION` while loading
 * or on error so the UI never shows a blank version.
 */
export function useLocalVersion(): string {
  const compat = useQuery(versionCompatQuery());
  return compat.data?.appVersion
    ? `v${compat.data.appVersion.replace(/^v/i, '')}`
    : LOCAL_APP_VERSION;
}

/**
 * The local control-plane's schema version — the highest migration number
 * shipped with this build (see `packages/control-plane/src/build-info.ts`).
 * Kept in lockstep with `packages/control-plane/drizzle/<NNNN>_*.sql` by
 * convention. When a runtime `/api/version` endpoint lands we can switch
 * this to a fetched value; helpers below already accept it as a parameter.
 */
export const LOCAL_SCHEMA_VERSION = 27;

/** Extension of `SyncPeer` with the upcoming version fields (PR #555). */
export type SyncPeerWithVersion = SyncPeer & {
  peerVersion?: string | null;
  peerGitSha?: string | null;
  peerSchemaVersion?: number | null;
};

export type DriftRelation = 'match' | 'ahead' | 'behind' | 'unknown';

/**
 * Normalise a semver-ish string to a comparable tuple. Strips the optional
 * leading `v`, drops pre-release/build metadata, and coerces each numeric
 * segment independently. Non-numeric segments become `NaN` which downgrades
 * the comparison to `unknown`.
 */
function parseSemver(value: string | null | undefined): [number, number, number] | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^v/i, '');
  const core = trimmed.split(/[-+]/)[0] ?? '';
  const parts = core.split('.');
  if (parts.length === 0) return null;
  const [majorRaw, minorRaw = '0', patchRaw = '0'] = parts;
  const major = Number(majorRaw);
  const minor = Number(minorRaw);
  const patch = Number(patchRaw);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
    return null;
  }
  return [major, minor, patch];
}

/** Compare two semver strings. Returns `null` if either side is unparseable. */
export function compareSemver(
  a: string | null | undefined,
  b: string | null | undefined,
): number | null {
  const parsedA = parseSemver(a);
  const parsedB = parseSemver(b);
  if (!parsedA || !parsedB) return null;
  for (let i = 0; i < 3; i += 1) {
    const diff = (parsedA[i] ?? 0) - (parsedB[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Classify a peer's version relative to the local node's version.
 *
 * - `match`  — identical or compares as equal
 * - `ahead`  — peer > local (needs a local upgrade)
 * - `behind` — peer < local (peer needs to roll forward)
 * - `unknown` — peer hasn't reported a version yet, or the value is unparseable
 */
export function classifyDrift(
  peerVersion: string | null | undefined,
  localVersion: string,
): DriftRelation {
  if (!peerVersion) return 'unknown';
  const cmp = compareSemver(peerVersion, localVersion);
  if (cmp === null) return 'unknown';
  if (cmp === 0) return 'match';
  return cmp > 0 ? 'ahead' : 'behind';
}

/**
 * Classify a peer's `peerSchemaVersion` relative to the local schema version.
 *
 * Schema drift is the signal that matters for mesh envelope compatibility —
 * `apply-change.ts` rejects envelopes from peers with `schemaVersion > local + 1`
 * with `MESH_ENVELOPE_SCHEMA_AHEAD`. When a peer is even one version ahead
 * the operator should update this node to close the window.
 *
 * - `match`  — equal numeric schema versions
 * - `ahead`  — peer schema > local schema (update this node)
 * - `behind` — peer schema < local schema
 * - `unknown` — peer has not reported `peerSchemaVersion` yet, or it is not
 *              a finite number
 */
export function classifySchemaDrift(
  peerSchemaVersion: number | null | undefined,
  localSchemaVersion: number,
): DriftRelation {
  if (peerSchemaVersion === null || peerSchemaVersion === undefined) return 'unknown';
  if (!Number.isFinite(peerSchemaVersion) || !Number.isFinite(localSchemaVersion)) {
    return 'unknown';
  }
  if (peerSchemaVersion === localSchemaVersion) return 'match';
  return peerSchemaVersion > localSchemaVersion ? 'ahead' : 'behind';
}

export type VersionGroup = {
  version: string;
  count: number;
};

/**
 * Group peers by their reported `peerVersion`. Peers without a version are
 * omitted. The result is sorted by descending count, then descending semver
 * (so the newest, most common version bubbles to the top).
 */
export function groupPeerVersions(peers: ReadonlyArray<SyncPeerWithVersion>): VersionGroup[] {
  const counts = new Map<string, number>();
  for (const peer of peers) {
    const raw = peer.peerVersion;
    if (!raw) continue;
    const normalised = raw.trim();
    if (!normalised) continue;
    counts.set(normalised, (counts.get(normalised) ?? 0) + 1);
  }
  return Array.from(counts, ([version, count]) => ({ version, count })).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const cmp = compareSemver(b.version, a.version);
    if (cmp !== null && cmp !== 0) return cmp;
    return a.version.localeCompare(b.version);
  });
}

/**
 * Returns true when the mesh spans at least two distinct `appVersion` values.
 * The local node's version counts as one; this matches the roadmap example
 * "Mesh on mixed versions: v0.4.0 (2), v0.3.1 (1)" where the local node is
 * one of the `v0.4.0` entries.
 */
export function hasMeshDrift(
  peers: ReadonlyArray<SyncPeerWithVersion>,
  localVersion: string,
): boolean {
  const seen = new Set<string>();
  if (localVersion) seen.add(localVersion);
  for (const peer of peers) {
    const raw = peer.peerVersion;
    if (!raw) continue;
    const normalised = raw.trim();
    if (normalised) seen.add(normalised);
    if (seen.size >= 2) return true;
  }
  return false;
}

/**
 * Compact, human-readable summary like `v0.4.0 (2), v0.3.1 (1)`.
 * Caps at `limit` entries and appends `+N more` when additional versions
 * exist. Used both for the mesh-peers banner and the sidebar tooltip.
 */
export function formatVersionGroups(groups: ReadonlyArray<VersionGroup>, limit = 5): string {
  if (groups.length === 0) return '';
  const shown = groups.slice(0, limit);
  const extra = groups.length - shown.length;
  const base = shown.map((g) => `${g.version} (${g.count})`).join(', ');
  return extra > 0 ? `${base}, +${extra} more` : base;
}
