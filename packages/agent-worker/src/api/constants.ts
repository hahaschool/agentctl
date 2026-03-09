/**
 * Shared constants for worker API route handlers.
 */

/** Heartbeat interval for SSE streams (sessions + agent output). */
export const SSE_HEARTBEAT_INTERVAL_MS = 15_000;

/** Timeout for dependency health checks (e.g. control-plane reachability). */
export const HEALTH_CHECK_TIMEOUT_MS = 2_000;
