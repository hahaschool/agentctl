/**
 * Shared pagination and batch-size constants for all CP route handlers.
 * Import from here instead of defining local duplicates.
 */

// --- Pagination defaults per resource type ---

type PaginationConfig = { defaultLimit: number; maxLimit: number };

export const PAGINATION: Record<string, PaginationConfig> & {
  agents: PaginationConfig;
  agentRuns: PaginationConfig;
  sessions: PaginationConfig;
  audit: PaginationConfig;
  replay: PaginationConfig;
  securityFindings: PaginationConfig;
  webhooks: PaginationConfig;
} = {
  agents: { defaultLimit: 100, maxLimit: 500 },
  agentRuns: { defaultLimit: 20, maxLimit: 200 },
  sessions: { defaultLimit: 50, maxLimit: 200 },
  audit: { defaultLimit: 100, maxLimit: 1000 },
  replay: { defaultLimit: 100, maxLimit: 1000 },
  securityFindings: { defaultLimit: 50, maxLimit: 500 },
  webhooks: { defaultLimit: 50, maxLimit: 200 },
};

// --- Batch-size limits for bulk-write endpoints ---

export const BATCH_LIMITS = {
  audit: 1000,
  securityFindings: 500,
};

// --- Helper to clamp a parsed limit ---

export function clampLimit(
  parsed: number,
  defaults: { defaultLimit: number; maxLimit: number },
): number {
  if (!Number.isFinite(parsed) || parsed < 1) return defaults.defaultLimit;
  return Math.min(Math.floor(parsed), defaults.maxLimit);
}

// --- Proxy/request timeout defaults (used by route handlers) ---

/** Timeout for worker requests that proxy files, git, and terminal ops. */
export const WORKER_REQUEST_TIMEOUT_MS = 10_000;

/** Timeout for loop proxy operations (start/stop/prompt/config). */
export const LOOP_PROXY_TIMEOUT_MS = 30_000;

/** Timeout for emergency stop proxy operations. */
export const EMERGENCY_STOP_TIMEOUT_MS = 15_000;

/** Heartbeat interval for WebSocket and SSE connections. */
export const WS_HEARTBEAT_INTERVAL_MS = 30_000;

/** Timeout for dependency health checks (DB, Redis, Mem0, LiteLLM). */
export const HEALTH_CHECK_TIMEOUT_MS = 2_000;

/** Timeout for session discovery requests to workers. */
export const SESSION_DISCOVER_TIMEOUT_MS = 5_000;
