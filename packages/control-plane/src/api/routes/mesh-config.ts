/**
 * §33.12 Phase 2 — Mesh configuration API endpoints.
 *
 * GET  /api/mesh/config  → resolved MeshConfig (token value redacted)
 * PUT  /api/mesh/config  → update overrides, returns resolved MeshConfig
 *
 * Both endpoints require authentication (same as /api/settings).
 */

import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { MeshConfigProvider } from '../../mesh/mesh-config-provider.js';
import { isValidTailscaleIp } from '../../sync/peer-discovery.js';
import { isAllowedPeerTarget } from '../../sync/url-guards.js';

export type MeshConfigRoutesOptions = {
  meshConfigProvider: MeshConfigProvider;
  machineId: string;
  hostname: string;
  publicKey: string | null;
};

type MeshConfigResponse = {
  machineId: string;
  hostname: string;
  tailscaleIp: string | null;
  tailscaleIpSource: string | null;
  syncUrl: string;
  syncUrlSource: string;
  registrationTokenConfigured: boolean;
  registrationTokenSource: string | null;
  publicKey: string | null;
};

type MeshConfigUpdateBody = {
  tailscaleIpOverride?: string | null;
  syncUrlOverride?: string | null;
  registrationToken?: string | null;
};

function toResponse(
  config: Awaited<ReturnType<MeshConfigProvider['resolve']>>,
  opts: MeshConfigRoutesOptions,
): MeshConfigResponse {
  return {
    machineId: opts.machineId,
    hostname: opts.hostname,
    tailscaleIp: config.tailscaleIp,
    tailscaleIpSource: config.tailscaleIpSource,
    syncUrl: config.syncUrl,
    syncUrlSource: config.syncUrlSource,
    registrationTokenConfigured: config.registrationToken !== null,
    registrationTokenSource: config.registrationTokenSource,
    publicKey: opts.publicKey,
  };
}

const PREFLIGHT_TIMEOUT_MS = 5_000;

type PreflightQuery = {
  targetSyncUrl?: string;
};

type PreflightResponse = {
  tokenStatus: 'compatible' | 'mismatch' | 'remote_disabled' | 'local_missing' | 'error';
  errorCode: string | null;
  message: string;
};

/**
 * §33.12 Phase 3.3 — Pre-flight token compatibility check.
 *
 * Sends a minimal (incomplete) registration POST to the remote peer WITH the
 * local token header. The remote's auth layer checks the token before body
 * validation, so we can infer token status from the error code:
 *
 * - 400 (body validation) → token passed → compatible
 * - 403 TOKEN_INVALID      → tokens don't match
 * - 503 DISABLED            → remote has no token configured
 */
async function checkTokenPreflight(
  targetSyncUrl: string,
  registrationToken: string | null,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<PreflightResponse> {
  if (!registrationToken) {
    return {
      tokenStatus: 'local_missing',
      errorCode: 'PEER_REGISTRATION_TOKEN_MISSING',
      message: 'No registration token configured locally. Set one in Settings → Mesh.',
    };
  }

  // Safe trailing-slash removal (avoids ReDoS from /\/+$/ on user input)
  let cleanUrl = targetSyncUrl;
  while (cleanUrl.endsWith('/')) {
    cleanUrl = cleanUrl.slice(0, -1);
  }

  // Defence-in-depth SSRF check (route handler validates too, but this
  // function may be called from other call-sites in the future).
  const parsedTarget = new URL(cleanUrl);
  if (!isAllowedPeerTarget(parsedTarget.hostname)) {
    return {
      tokenStatus: 'error',
      errorCode: 'INVALID_TARGET',
      message:
        'Pre-flight check only allowed against Tailscale mesh peers (100.64.0.0/10) or localhost.',
    };
  }

  const url = `${cleanUrl}/api/sync/peers/register`;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-sync-registration-token': registrationToken,
  };

  // Deliberately incomplete body — we want a validation error, not an actual registration.
  const body = JSON.stringify({});

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS),
    });

    let errorCode: string | null = null;
    try {
      const json = (await response.json()) as Record<string, unknown>;
      if (typeof json.error === 'string') {
        errorCode = json.error;
      }
    } catch {
      // Non-JSON response — fall through
    }

    // Token was accepted, body validation kicked in → compatible
    if (
      response.status === 400 &&
      errorCode !== 'PEER_REGISTRATION_TOKEN_INVALID' &&
      errorCode !== 'PEER_REGISTRATION_DISABLED'
    ) {
      return {
        tokenStatus: 'compatible',
        errorCode: null,
        message: 'Registration tokens are compatible.',
      };
    }

    if (errorCode === 'PEER_REGISTRATION_TOKEN_INVALID') {
      return {
        tokenStatus: 'mismatch',
        errorCode,
        message:
          "The tokens on this node and the remote don't match. Check Settings → Mesh on both machines.",
      };
    }

    if (errorCode === 'PEER_REGISTRATION_DISABLED') {
      return {
        tokenStatus: 'remote_disabled',
        errorCode,
        message: 'The remote peer has no registration token configured.',
      };
    }

    // Unexpected response
    return {
      tokenStatus: 'error',
      errorCode,
      message: `Unexpected response: HTTP ${response.status}${errorCode ? ` (${errorCode})` : ''}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      tokenStatus: 'error',
      errorCode: 'NETWORK_ERROR',
      message: `Could not reach the remote peer: ${msg}`,
    };
  }
}

export const meshConfigRoutes: FastifyPluginAsync<MeshConfigRoutesOptions> = async (app, opts) => {
  const { meshConfigProvider } = opts;

  app.get('/mesh/config', async () => {
    const config = await meshConfigProvider.resolve();
    return toResponse(config, opts);
  });

  // §33.12 Phase 3.3 — Pre-flight token status check
  app.get<{ Querystring: PreflightQuery }>('/mesh/config/preflight', async (request, reply) => {
    const targetSyncUrl = request.query.targetSyncUrl;
    if (!targetSyncUrl || typeof targetSyncUrl !== 'string') {
      throw new ControlPlaneError('INVALID_REQUEST', 'targetSyncUrl query parameter is required');
    }
    try {
      const parsed = new URL(targetSyncUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new ControlPlaneError('INVALID_SYNC_URL', 'targetSyncUrl must use http or https');
      }
      if (!isAllowedPeerTarget(parsed.hostname)) {
        throw new ControlPlaneError(
          'INVALID_SYNC_URL',
          'targetSyncUrl must point to a Tailscale mesh peer (100.64.0.0/10) or localhost',
        );
      }
    } catch (err) {
      if (err instanceof ControlPlaneError) throw err;
      throw new ControlPlaneError('INVALID_SYNC_URL', 'targetSyncUrl must be a valid URL');
    }

    const config = await meshConfigProvider.resolve();
    const result = await checkTokenPreflight(targetSyncUrl, config.registrationToken);
    reply.code(200);
    return result;
  });

  app.put<{ Body: MeshConfigUpdateBody }>('/mesh/config', async (request, reply) => {
    const body = request.body as MeshConfigUpdateBody | null;
    if (!body || typeof body !== 'object') {
      throw new ControlPlaneError('INVALID_REQUEST', 'Request body must be a JSON object');
    }

    // Validate IP if provided
    if (body.tailscaleIpOverride !== undefined && body.tailscaleIpOverride !== null) {
      if (
        typeof body.tailscaleIpOverride !== 'string' ||
        !isValidTailscaleIp(body.tailscaleIpOverride)
      ) {
        throw new ControlPlaneError(
          'INVALID_TAILSCALE_IP',
          'tailscaleIpOverride must be a valid IPv4 address (not loopback/link-local)',
        );
      }
    }

    // Validate sync URL if provided
    if (body.syncUrlOverride !== undefined && body.syncUrlOverride !== null) {
      if (typeof body.syncUrlOverride !== 'string') {
        throw new ControlPlaneError('INVALID_SYNC_URL', 'syncUrlOverride must be a string');
      }
      try {
        const parsed = new URL(body.syncUrlOverride);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          throw new ControlPlaneError('INVALID_SYNC_URL', 'syncUrlOverride must use http or https');
        }
      } catch (err) {
        if (err instanceof ControlPlaneError) throw err;
        throw new ControlPlaneError('INVALID_SYNC_URL', 'syncUrlOverride must be a valid URL');
      }
    }

    // Validate token if provided
    if (body.registrationToken !== undefined && body.registrationToken !== null) {
      if (typeof body.registrationToken !== 'string' || body.registrationToken.length === 0) {
        throw new ControlPlaneError(
          'INVALID_TOKEN',
          'registrationToken must be a non-empty string (or null to clear)',
        );
      }
    }

    const config = await meshConfigProvider.update({
      tailscaleIpOverride: body.tailscaleIpOverride,
      syncUrlOverride: body.syncUrlOverride,
      registrationToken: body.registrationToken,
    });

    reply.code(200);
    return toResponse(config, opts);
  });
};
