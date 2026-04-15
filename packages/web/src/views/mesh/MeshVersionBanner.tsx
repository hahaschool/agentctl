'use client';

import { useQuery } from '@tanstack/react-query';
import type React from 'react';

import type { SyncPeer } from '@/lib/api';
import { compareSemver, type SyncPeerWithVersion } from '@/lib/mesh-version';
import { versionCompatQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';

type MeshVersionBannerProps = {
  peers: readonly SyncPeer[];
  className?: string;
};

/**
 * Pick the peer with the highest `peerVersion` that is strictly greater than
 * `localVersion` via `compareSemver`. Returns null when no peer outranks local.
 * Self-rows are excluded so a stale self-reported version can't trigger the
 * banner against itself.
 */
export function pickMaxPeerVersion(
  peers: readonly SyncPeer[],
  localVersion: string | null,
): string | null {
  if (!localVersion) return null;
  let best: string | null = null;
  for (const peer of peers as readonly SyncPeerWithVersion[]) {
    if (peer.isSelf) continue;
    const peerVersion = peer.peerVersion ?? null;
    if (!peerVersion) continue;
    // Must be strictly newer than local.
    const vsLocal = compareSemver(peerVersion, localVersion);
    if (vsLocal === null || vsLocal <= 0) continue;
    if (best === null) {
      best = peerVersion;
      continue;
    }
    const vsBest = compareSemver(peerVersion, best);
    if (vsBest !== null && vsBest > 0) {
      best = peerVersion;
    }
  }
  return best;
}

/**
 * §33.11 — "Update available" banner rendered at the top of `/mesh-peers`.
 *
 * Reads the local control plane's `appVersion` from the same
 * `/api/version-compat` endpoint that powers the global compatibility banner
 * (PR #570). If any registered peer is on a strictly higher semver version,
 * surfaces a one-line banner nudging the operator toward the local
 * `./scripts/peer-update.sh --dry-run` preview.
 *
 * Hidden when:
 *   - the `/api/version-compat` query hasn't resolved yet (loading or error),
 *   - no peers are ahead of local (i.e. max peer version <= local),
 *   - no peer has reported an `appVersion` at all.
 */
export function MeshVersionBanner({
  peers,
  className,
}: MeshVersionBannerProps): React.JSX.Element | null {
  const compat = useQuery(versionCompatQuery());
  const localVersion = compat.data?.appVersion ?? null;
  const maxPeerVersion = pickMaxPeerVersion(peers, localVersion);
  if (!localVersion || !maxPeerVersion) return null;

  return (
    <section
      aria-label="Update available"
      data-testid="mesh-version-update-banner"
      className={cn(
        'mb-4 rounded-md border border-blue-500/30 bg-blue-500/5 text-foreground',
        'flex flex-wrap items-start gap-3 px-3 py-2 text-xs',
        className,
      )}
    >
      <span aria-hidden="true" className="mt-1 inline-block size-1.5 rounded-full bg-blue-400" />
      <div className="flex-1 min-w-0 font-mono leading-5">
        <span className="text-blue-300 font-semibold" data-testid="mesh-version-update-headline">
          Update available (v{stripLeadingV(localVersion)} → v{stripLeadingV(maxPeerVersion)})
        </span>
        <span className="text-muted-foreground"> — run </span>
        <code className="text-foreground" data-testid="mesh-version-update-command">
          ./scripts/peer-update.sh --dry-run
        </code>
        <span className="text-muted-foreground"> to preview, or toggle Mesh auto-update in </span>
        <a
          href="/settings"
          className="text-blue-300 hover:text-blue-200 underline underline-offset-2"
          data-testid="mesh-version-update-settings-link"
        >
          /settings
        </a>
        <span className="text-muted-foreground">.</span>
      </div>
    </section>
  );
}

function stripLeadingV(version: string): string {
  return version.replace(/^v/i, '');
}
