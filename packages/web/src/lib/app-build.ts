// ---------------------------------------------------------------------------
// Web build number — the monotonically increasing integer that gates client
// compatibility with the control plane (roadmap §33.11).
//
// Sourced from `NEXT_PUBLIC_WEB_BUILD` at build time so CI can stamp the
// correct value without code changes. Defaults to `0` — meaning "no build
// gate" — which allows the banner to still render an "update available" hint
// when the server semver moves ahead while leaving the hard gate disabled.
// ---------------------------------------------------------------------------

function parseBuildEnv(raw: string | undefined): number {
  if (!raw || raw.trim().length === 0) return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

export const WEB_BUILD_NUMBER: number = parseBuildEnv(
  typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_WEB_BUILD : undefined,
);
