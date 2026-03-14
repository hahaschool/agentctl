import type { AgentRuntimeConfigOverrides, ManagedRuntimeConfig } from '@agentctl/shared';
import { WorkerError } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { Logger } from 'pino';

import { ClaudeConfigRenderer } from '../../runtime/config/claude-config-renderer.js';
import { CodexConfigRenderer } from '../../runtime/config/codex-config-renderer.js';
import type { RenderedRuntimeConfig } from '../../runtime/config/shared-rendering.js';

// ---------------------------------------------------------------------------
// Route options
// ---------------------------------------------------------------------------

export type ConfigPreviewRoutesOptions = {
  logger: Logger;
};

// ---------------------------------------------------------------------------
// Response type
// ---------------------------------------------------------------------------

type ConfigPreviewResponse = {
  ok: true;
  runtime: string;
  rendered: RenderedRuntimeConfig;
};

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const configPreviewRoutes: FastifyPluginAsync<ConfigPreviewRoutesOptions> = async (
  app,
  opts,
) => {
  const { logger } = opts;

  /**
   * GET /preview?runtime=claude-code|codex
   *
   * Accepts an optional `configJson` query parameter containing a JSON-encoded
   * ManagedRuntimeConfig, and an optional `overridesJson` query parameter
   * containing a JSON-encoded AgentRuntimeConfigOverrides.
   *
   * Returns the rendered config files without writing them to disk.
   */
  app.get<{
    Querystring: {
      runtime?: string;
      configJson?: string;
      overridesJson?: string;
    };
  }>('/preview', async (request, reply) => {
    const runtime = request.query.runtime ?? 'claude-code';

    if (runtime !== 'claude-code' && runtime !== 'codex') {
      throw new WorkerError(
        'INVALID_RUNTIME',
        `Invalid runtime "${runtime}". Must be "claude-code" or "codex".`,
      );
    }

    let config: ManagedRuntimeConfig = buildDefaultPreviewConfig();
    if (request.query.configJson) {
      try {
        config = JSON.parse(request.query.configJson) as ManagedRuntimeConfig;
      } catch {
        throw new WorkerError('INVALID_CONFIG', 'configJson must be valid JSON');
      }
    }

    let overrides: AgentRuntimeConfigOverrides | undefined;
    if (request.query.overridesJson) {
      try {
        overrides = JSON.parse(request.query.overridesJson) as AgentRuntimeConfigOverrides;
      } catch {
        throw new WorkerError('INVALID_OVERRIDES', 'overridesJson must be valid JSON');
      }
    }

    const rendered =
      runtime === 'claude-code'
        ? new ClaudeConfigRenderer().render(config, overrides)
        : new CodexConfigRenderer().render(config, overrides);

    logger.info({ runtime }, 'Config preview requested');

    const response: ConfigPreviewResponse = {
      ok: true,
      runtime,
      rendered,
    };

    return reply.send(response);
  });
};

// ---------------------------------------------------------------------------
// Minimal default config for preview when none is provided
// ---------------------------------------------------------------------------

function buildDefaultPreviewConfig(): ManagedRuntimeConfig {
  return {
    version: 0,
    hash: 'preview',
    instructions: {
      userGlobal: '',
      projectTemplate: '',
    },
    mcpServers: [],
    skills: [],
    sandbox: 'workspace-write',
    approvalPolicy: 'on-failure',
    environmentPolicy: {
      inherit: ['HOME', 'PATH', 'SHELL'],
      set: {},
    },
    runtimeOverrides: {},
  };
}
