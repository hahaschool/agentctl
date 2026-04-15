// ---------------------------------------------------------------------------
// Mesh auto-update — types surfaced by the `/settings` Mesh auto-update panel
// (roadmap §33.11). The control-plane exposes three routes that consume these:
//
//   GET  /api/mesh/auto-update             → AutoUpdateStatus
//   POST /api/mesh/auto-update/toggle      → AutoUpdateStatus (after toggle)
//   POST /api/mesh/auto-update/dry-run     → SSE stream of AutoUpdateDryRunEvent
//
// Keep this file dependency-free so the iOS + web clients can import it without
// pulling in the rest of the mesh sync module.
// ---------------------------------------------------------------------------

/**
 * Summary of the last recorded peer-update attempt. Sourced from
 * `~/.agentctl/update-history.json` by the control-plane route — the history
 * file itself is written by `scripts/peer-update.ts` after each run.
 */
export type AutoUpdateLastRun = {
  /** Tag the update moved to (e.g. "v0.3.4"). */
  readonly version: string;
  /** ISO timestamp captured when the run began. */
  readonly startedAt: string;
  /** Wall-clock duration in milliseconds (finishedAt - startedAt). */
  readonly durationMs: number;
  /** Terminal status of the run. */
  readonly status: 'success' | 'failure';
  /** Best-effort error message when `status === "failure"`. */
  readonly error?: string;
  /** True when the run was a `--dry-run` invocation. */
  readonly dryRun: boolean;
};

/**
 * Per-node auto-update status returned by `GET /api/mesh/auto-update`.
 *
 * `enabled` / `nextScheduledRun` are derived from the platform scheduler
 * (launchd on darwin, systemd-user on linux). `lastRun` is sourced from the
 * shared update-history file so the UI can show the outcome of the most
 * recent attempt regardless of whether the scheduler is currently enabled.
 */
export type AutoUpdateStatus = {
  /** Whether the scheduler unit is currently loaded + enabled. */
  readonly enabled: boolean;
  /**
   * ISO timestamp of the next scheduled run, or `null` when the scheduler is
   * disabled / the platform has no scheduler unit installed.
   */
  readonly nextScheduledRun: string | null;
  /** Most recent run from update-history.json, or `null` when history is empty. */
  readonly lastRun: AutoUpdateLastRun | null;
  /** Platform label for diagnostic display — `"darwin" | "linux" | "unsupported"`. */
  readonly platform: 'darwin' | 'linux' | 'unsupported';
};

/**
 * Body schema for `POST /api/mesh/auto-update/toggle`.
 */
export type AutoUpdateToggleRequest = {
  readonly enabled: boolean;
};

/**
 * Discriminated union of SSE events emitted by the dry-run streaming route.
 * Consumers switch on `type` to update the log panel incrementally.
 */
export type AutoUpdateDryRunEvent =
  | {
      readonly type: 'start';
      readonly startedAt: string;
      readonly command: string;
    }
  | {
      readonly type: 'stdout';
      readonly chunk: string;
    }
  | {
      readonly type: 'stderr';
      readonly chunk: string;
    }
  | {
      readonly type: 'done';
      readonly exitCode: number;
      readonly durationMs: number;
    }
  | {
      readonly type: 'error';
      readonly message: string;
    };
