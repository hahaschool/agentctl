'use client';

// ---------------------------------------------------------------------------
// VersionCompatBanner — roadmap §33.11
//
// Reads the `/api/version-compat` payload via `versionCompatQuery()` and shows
// one of two banners:
//   - HARD update required: the client's build is below
//     `minSupportedWebBuild` — the user must update before continuing.
//   - SOFT update hint: the server's appVersion is ahead of the client's
//     baked-in `LOCAL_APP_VERSION` but the client is still within the
//     supported floor. Rendered as a subtle notice so the user isn't blocked.
//
// Rendering is deferred via `useQuery` so a pre-login fetch failure simply
// hides the banner — we never want the compatibility check itself to prevent
// the app from rendering.
// ---------------------------------------------------------------------------

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpCircle } from 'lucide-react';

import { WEB_BUILD_NUMBER } from '../lib/app-build';
import { classifyDrift, LOCAL_APP_VERSION } from '../lib/mesh-version';
import { versionCompatQuery } from '../lib/queries';

export type VersionCompatBannerProps = {
  /** Override the local client's integer build number. Defaults to `WEB_BUILD_NUMBER`. */
  clientBuild?: number;
  /** Override the local client's semver. Defaults to `LOCAL_APP_VERSION`. */
  clientVersion?: string;
};

export function VersionCompatBanner({
  clientBuild = WEB_BUILD_NUMBER,
  clientVersion = LOCAL_APP_VERSION,
}: VersionCompatBannerProps): React.JSX.Element | null {
  const { data } = useQuery(versionCompatQuery());
  if (!data) return null;

  const { appVersion, minSupportedWebBuild } = data;

  // Hard gate: client is below the server-enforced floor.
  if (minSupportedWebBuild > 0 && clientBuild < minSupportedWebBuild) {
    return (
      <div
        role="alert"
        data-testid="version-compat-banner-blocked"
        className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 text-[12px] text-red-600 dark:text-red-400 flex items-center gap-2"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          Please update your web client (build {minSupportedWebBuild} expected, build {clientBuild}{' '}
          running). Some features may not work until you reload after an update.
        </span>
      </div>
    );
  }

  // Soft hint: server appVersion is ahead of the baked-in client semver.
  // `classifyDrift` returns `'ahead'` when the first arg is > the second —
  // here we want to know if the SERVER is ahead of the CLIENT, so we pass
  // (server, client) and check for 'ahead'.
  const drift = classifyDrift(appVersion, clientVersion);
  if (drift === 'ahead') {
    return (
      <output
        data-testid="version-compat-banner-hint"
        className="bg-blue-500/5 border-b border-blue-500/20 px-4 py-1.5 text-[11px] text-blue-600 dark:text-blue-400 flex items-center gap-2"
      >
        <ArrowUpCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>
          Update available — server is running {appVersion}, this client is {clientVersion}.
        </span>
      </output>
    );
  }

  return null;
}
