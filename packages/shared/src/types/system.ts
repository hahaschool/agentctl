// ---------------------------------------------------------------------------
// System-level types surfaced pre-login so clients can detect when they need
// to update before attempting the rest of the API handshake.
//
// Consumers: iOS + web bootstrap flow for roadmap §33.11
//   GET /api/version-compat  →  VersionCompatResponse
// ---------------------------------------------------------------------------

/**
 * Payload returned by `GET /api/version-compat`.
 *
 * `minSupportedMobileBuild` / `minSupportedWebBuild` use monotonically
 * increasing integer build numbers rather than semver so the mobile store
 * gating story stays trivial: any client whose integer build is below the
 * floor is forced to update. A value of `0` means "no floor enforced".
 */
export type VersionCompatResponse = {
  /** Control-plane semver (matches /health `appVersion`). */
  readonly appVersion: string;
  /** Short git SHA stamped at build time (matches /health `gitSha`). */
  readonly gitSha: string;
  /** Highest drizzle migration number shipped with this build. */
  readonly schemaVersion: number;
  /** Minimum mobile build integer considered compatible; 0 disables the gate. */
  readonly minSupportedMobileBuild: number;
  /** Minimum web build integer considered compatible; 0 disables the gate. */
  readonly minSupportedWebBuild: number;
};
