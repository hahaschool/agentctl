/**
 * Sandbox enforcement verification types.
 *
 * These types are used to communicate the result of post-spawn sandbox
 * verification checks. After an agent session is spawned, the worker
 * inspects the process tree to confirm the expected sandbox mechanism
 * (bubblewrap on Linux, Seatbelt on macOS, or Codex --sandbox flag)
 * is actively wrapping the agent process.
 */

export const SANDBOX_METHODS = ['bubblewrap', 'seatbelt', 'codex-sandbox', 'none'] as const;

export type SandboxMethod = (typeof SANDBOX_METHODS)[number];

/**
 * Result of a post-spawn sandbox verification check.
 *
 * - `enforced: true` means the expected sandbox mechanism was confirmed active.
 * - `enforced: false` means the check could not confirm sandbox enforcement
 *   (the agent may still be sandboxed, but the canary check could not verify it).
 */
export type SandboxVerificationResult = {
  /** Whether the sandbox constraint was confirmed as actively enforced. */
  enforced: boolean;
  /** The sandbox mechanism detected (or 'none' if no sandbox was found). */
  method: SandboxMethod;
  /** Human-readable details about the verification result. */
  details: string;
  /** The PID of the agent process that was checked, if available. */
  pid?: number;
  /** ISO 8601 timestamp of when the check was performed. */
  checkedAt: string;
};

/**
 * Network enforcement policy modes used by the network-policy enforcer.
 */
export type NetworkEnforcementMode = 'none' | 'egress-only' | 'allowlist';

/**
 * Result of applying a network enforcement policy.
 */
export type NetworkEnforcementResult = {
  /** Whether the network policy was successfully applied. */
  applied: boolean;
  /** The enforcement mode that was requested. */
  mode: NetworkEnforcementMode;
  /** The mechanism used to enforce the policy (e.g. 'iptables', 'docker-network', 'macos-pf'). */
  mechanism: string;
  /** Human-readable details about the enforcement result. */
  details: string;
};
