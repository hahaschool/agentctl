/**
 * §33.12 Phase 3.2 — Map machine-readable reverse-registration error codes
 * to actionable user guidance.
 *
 * Error codes are persisted by the backend (Phase 3.1) and surfaced via the
 * SyncNode type's `reverseRegistrationErrorCode` field. This module turns
 * those codes into human-readable { title, action } pairs for UI display.
 */

type ErrorGuidance = {
  /** Short heading shown in a toast or badge tooltip (e.g. "Token mismatch"). */
  title: string;
  /** Actionable next step the user can take to fix the issue. */
  action: string;
};

type DescribeContext = {
  /** This node's sync URL, interpolated into certain messages. */
  syncUrl?: string;
};

const ERROR_CODE_MAP: Record<string, (ctx: DescribeContext) => ErrorGuidance> = {
  PEER_REGISTRATION_DISABLED: () => ({
    title: 'Remote has no registration token',
    action: 'Ask the remote operator to configure a token in Settings → Mesh.',
  }),
  PEER_REGISTRATION_TOKEN_INVALID: () => ({
    title: 'Token mismatch',
    action:
      "The tokens on this node and the remote don't match. Check Settings → Mesh on both machines.",
  }),
  PEER_REGISTRATION_TOKEN_MISSING: () => ({
    title: 'No token configured locally',
    action: 'Set a registration token in Settings → Mesh before adding peers.',
  }),
  INVALID_SYNC_URL: (ctx) => ({
    title: 'Sync URL not reachable from remote',
    action: `This node's Sync URL (${ctx.syncUrl ?? 'unknown'}) cannot be reached by the remote peer. Check Settings → Mesh → Tailscale IP.`,
  }),
  PEER_REGISTRATION_INVALID_SIGNATURE: () => ({
    title: 'Signature verification failed',
    action:
      'The Ed25519 signature was rejected. This may indicate a clock skew >60s between nodes. Check system time on both machines.',
  }),
  NETWORK_ERROR: () => ({
    title: 'Peer unreachable',
    action:
      'Could not connect to the remote peer. Verify Tailscale is running and the peer is online.',
  }),
  REVERSE_REGISTRATION_DISABLED: () => ({
    title: 'Remote disabled reverse registration',
    action:
      'The remote peer rejected automatic registration. Add this node manually on the remote side.',
  }),
};

/**
 * Convert a reverse-registration error code (and optional raw message) into
 * a user-facing { title, action } pair.
 *
 * When the code is unknown or null, falls back to a generic message using
 * the raw error string from the backend.
 */
export function describeReverseRegistrationError(
  errorCode: string | null | undefined,
  errorMessage: string | null | undefined,
  context: DescribeContext = {},
): ErrorGuidance {
  const mapper = errorCode ? ERROR_CODE_MAP[errorCode] : undefined;
  if (mapper) {
    return mapper(context);
  }

  return {
    title: 'Reverse registration failed',
    action: errorMessage ?? 'Check logs for details.',
  };
}
