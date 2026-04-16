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

export const meshConfigRoutes: FastifyPluginAsync<MeshConfigRoutesOptions> = async (app, opts) => {
  const { meshConfigProvider } = opts;

  app.get('/mesh/config', async () => {
    const config = await meshConfigProvider.resolve();
    return toResponse(config, opts);
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
