/**
 * Shared URL security guards for mesh peer communication.
 *
 * - `stripTrailingSlashes` — safe alternative to `/\/+$/` regex (avoids ReDoS)
 * - `isAllowedPeerTarget`  — SSRF guard restricting targets to Tailscale CGNAT or localhost
 */

/**
 * Remove trailing slashes from a URL string without using regex.
 *
 * The naive `/\/+$/` regex is vulnerable to polynomial backtracking on
 * crafted input (ReDoS). This iterative approach is O(n) in the worst case.
 */
export function stripTrailingSlashes(url: string): string {
  let cleaned = url;
  while (cleaned.endsWith('/')) {
    cleaned = cleaned.slice(0, -1);
  }
  return cleaned;
}

/**
 * SSRF guard: only allow requests to Tailscale mesh peers or localhost.
 *
 * Tailscale CGNAT range: 100.64.0.0/10 (100.64.0.0 - 100.127.255.255).
 */
export function isAllowedPeerTarget(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map(Number);
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return false;
  return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}
