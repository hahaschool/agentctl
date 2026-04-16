import { signDispatchPayload } from '@agentctl/shared';
import type { Logger } from 'pino';

import {
  createPeerRegistrationPayload,
  PEER_REGISTRATION_AGENT_ID,
  type PeerRegistrationFields,
} from './peer-registration.js';
import { isAllowedPeerTarget, stripTrailingSlashes } from './url-guards.js';

/**
 * Roadmap §33.8 — outbound reverse peer registration.
 *
 * When an operator adds a peer on node A, node A calls this helper to tell the
 * new peer (node B) "here is who I am — add me as a peer on your side too".
 * B validates the Ed25519-signed envelope the same way its inbound
 * /api/sync/peers/register route does (see `peer-registration.ts`).
 */

const REVERSE_REGISTRATION_TIMEOUT_MS = 5_000;
const REVERSE_REGISTRATION_ERROR_MAX_LENGTH = 512;

export type ReverseRegistrationStatus = 'ok' | 'failed';

export type ReverseRegistrationResult = {
  status: ReverseRegistrationStatus;
  error: string | null;
  /** Machine-readable error code extracted from the peer's JSON response body (e.g. 'TOKEN_MISMATCH'). */
  errorCode: string | null;
  /** HTTP status code when the peer responded with a non-OK status. */
  httpStatus: number | null;
};

export type SelfIdentity = {
  /** Self machine id (this control plane) — becomes the remote's sync_nodes.id */
  machineId: string;
  hostname: string;
  tailscaleIp: string | null;
  /** Public sync URL of this control plane, reachable by the peer */
  syncUrl: string;
  /** Ed25519 public key of this control plane */
  publicKey: string;
};

export type ReverseRegistrationOptions = {
  /** Remote peer we just added locally */
  targetSyncUrl: string;
  /** Our own identity, as the remote will see us */
  self: SelfIdentity;
  /** Ed25519 secret key (base64) used to sign the registration envelope */
  signingSecretKey: string;
  /** Bootstrap token shared between the two operators (optional, warned if absent) */
  registrationToken: string | null;
  /** Fetch implementation (injected for tests) */
  fetchImpl?: typeof fetch;
  /** Optional logger — every log line includes machineId */
  logger?: Pick<Logger, 'warn' | 'debug'>;
};

/**
 * Truncate an error reason so a single `reverse_registration_error` value can
 * never blow up a database row. We also strip credential-looking substrings to
 * avoid leaking tokens into the column.
 */
export function truncateReverseRegistrationError(reason: string): string {
  const redacted = reason
    .replace(/\b[a-zA-Z0-9]{24,}\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return redacted.length > REVERSE_REGISTRATION_ERROR_MAX_LENGTH
    ? `${redacted.slice(0, REVERSE_REGISTRATION_ERROR_MAX_LENGTH - 1)}…`
    : redacted;
}

function describeFetchError(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name || 'Error';
    const message = error.message || 'unknown';
    return `${name}: ${message}`;
  }
  return `non-error: ${String(error)}`;
}

type HttpErrorDetail = {
  description: string;
  errorCode: string | null;
};

async function describeHttpError(response: Response): Promise<HttpErrorDetail> {
  let body = '';
  try {
    body = await response.text();
  } catch {
    // ignore — body stream could be closed or non-text
  }

  // Try to extract a machine-readable error code from a JSON response body.
  // The peer's registration endpoint returns `{ error: "SOME_CODE", message: "..." }`.
  let errorCode: string | null = null;
  if (body) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (typeof parsed.error === 'string' && parsed.error.length > 0) {
        errorCode = parsed.error;
      }
    } catch {
      // Not JSON — fall through to raw snippet
    }
  }

  const snippet = body ? ` ${body.slice(0, 200)}` : '';
  return {
    description: `HTTP ${response.status} ${response.statusText}${snippet}`,
    errorCode,
  };
}

function buildRegistrationUrl(targetSyncUrl: string): string {
  const trimmed = stripTrailingSlashes(targetSyncUrl);
  return `${trimmed}/api/sync/peers/register`;
}

/**
 * Fire a reverse-registration POST at the peer. Returns a typed outcome — we
 * never throw from here so the caller can tolerate transient peer outages
 * without rolling back the local INSERT.
 */
export async function performReverseRegistration(
  opts: ReverseRegistrationOptions,
): Promise<ReverseRegistrationResult> {
  const { self, signingSecretKey, registrationToken, targetSyncUrl } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;

  const fields: PeerRegistrationFields = {
    machineId: self.machineId,
    hostname: self.hostname,
    syncUrl: self.syncUrl,
    tailscaleIp: self.tailscaleIp,
    publicKey: self.publicKey,
  };
  const payload = createPeerRegistrationPayload(fields);
  const signature = signDispatchPayload(payload, {
    agentId: PEER_REGISTRATION_AGENT_ID,
    machineId: self.machineId,
    secretKey: signingSecretKey,
  });

  const body = {
    machineId: self.machineId,
    hostname: self.hostname,
    syncUrl: self.syncUrl,
    tailscaleIp: self.tailscaleIp ?? undefined,
    publicKey: self.publicKey,
    registrationSignature: signature,
  };

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (registrationToken && registrationToken.trim().length > 0) {
    headers['x-sync-registration-token'] = registrationToken;
  }

  // SSRF guard — only allow Tailscale CGNAT peers or localhost
  try {
    const parsedUrl = new URL(stripTrailingSlashes(targetSyncUrl));
    if (!isAllowedPeerTarget(parsedUrl.hostname)) {
      opts.logger?.warn(
        { machineId: self.machineId, peerSyncUrl: targetSyncUrl },
        'reverse registration blocked — target is not in Tailscale CGNAT range',
      );
      return {
        status: 'failed',
        error: truncateReverseRegistrationError(
          'Target URL is not a Tailscale mesh peer (100.64.0.0/10) or localhost',
        ),
        errorCode: 'INVALID_TARGET',
        httpStatus: null,
      };
    }
  } catch {
    return {
      status: 'failed',
      error: truncateReverseRegistrationError(`Invalid target URL: ${targetSyncUrl}`),
      errorCode: 'INVALID_TARGET',
      httpStatus: null,
    };
  }

  try {
    const response = await fetchImpl(buildRegistrationUrl(targetSyncUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REVERSE_REGISTRATION_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await describeHttpError(response);
      opts.logger?.warn(
        {
          machineId: self.machineId,
          peerSyncUrl: targetSyncUrl,
          status: response.status,
          errorCode: detail.errorCode,
        },
        'reverse peer registration failed',
      );
      return {
        status: 'failed',
        error: truncateReverseRegistrationError(detail.description),
        errorCode: detail.errorCode,
        httpStatus: response.status,
      };
    }

    opts.logger?.debug(
      { machineId: self.machineId, peerSyncUrl: targetSyncUrl },
      'reverse peer registration succeeded',
    );
    return { status: 'ok', error: null, errorCode: null, httpStatus: null };
  } catch (error) {
    const reason = describeFetchError(error);
    opts.logger?.warn(
      { machineId: self.machineId, peerSyncUrl: targetSyncUrl },
      'reverse peer registration threw',
    );
    return {
      status: 'failed',
      error: truncateReverseRegistrationError(reason),
      errorCode: 'NETWORK_ERROR',
      httpStatus: null,
    };
  }
}
