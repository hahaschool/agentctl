import type {
  AgentConfig,
  AgentRuntimeConfigOverrides,
  ConfigPreviewFile,
  ConfigPreviewResponse,
  ManagedRuntimeConfig,
} from '@agentctl/shared';
import { WorkerError } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { Logger } from 'pino';

import { ClaudeConfigRenderer } from '../../runtime/config/claude-config-renderer.js';
import { CodexConfigRenderer } from '../../runtime/config/codex-config-renderer.js';
import { resolveInstructionStrategy } from '../../runtime/config/instructions-strategy.js';
import { safeExistsSync, safeReadFile } from '../../utils/path-security.js';

// ---------------------------------------------------------------------------
// Route options
// ---------------------------------------------------------------------------

export type ConfigPreviewRoutesOptions = {
  logger: Logger;
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
      instructionsStrategy?: string;
      projectPath?: string;
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

    const instructionsStrategy = parseInstructionsStrategy(request.query.instructionsStrategy);
    const projectPath = request.query.projectPath ?? undefined;
    const workspaceInstructionFilePath = getWorkspaceInstructionFilePath(runtime);

    const rendered =
      runtime === 'claude-code'
        ? new ClaudeConfigRenderer().render(config, overrides, {
            instructionsStrategy,
            projectPath,
          })
        : new CodexConfigRenderer().render(config, overrides, {
            instructionsStrategy,
            projectPath,
          });
    const overridden = computeOverriddenFields(overrides);
    let files: ConfigPreviewFile[] = rendered.files.map((f) => {
      const hasOverride =
        overridden.length > 0 && overridden.some((field) => f.content.includes(field));
      const isWorkspaceInstructions =
        f.scope === 'workspace' && f.path === workspaceInstructionFilePath;

      let status: ConfigPreviewFile['status'] = hasOverride ? 'merged' : 'managed';
      if (isWorkspaceInstructions) {
        status = instructionsStrategy === 'merge' ? 'merged' : 'managed';
      }

      return {
        path: f.path,
        scope: f.scope,
        content: f.content,
        status,
        overriddenFields: hasOverride ? overridden : undefined,
      };
    });

    if (instructionsStrategy === 'project') {
      const projectInstructionContent = await readProjectInstructionFile({
        fileName: workspaceInstructionFilePath,
        projectPath,
      });

      files = files.filter(
        (file) => !(file.scope === 'workspace' && file.path === workspaceInstructionFilePath),
      );
      files.push({
        path: workspaceInstructionFilePath,
        scope: 'workspace',
        content:
          projectInstructionContent ??
          `(No ${workspaceInstructionFilePath} found in project directory)`,
        status: 'project',
      });
    }

    logger.info({ runtime }, 'Config preview requested');

    const response: ConfigPreviewResponse = {
      ok: true,
      runtime,
      files,
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

function computeOverriddenFields(overrides?: AgentRuntimeConfigOverrides): string[] {
  if (!overrides) return [];
  return Object.entries(overrides)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
}

function parseInstructionsStrategy(value: string | undefined): AgentConfig['instructionsStrategy'] {
  if (!value || value.length === 0) {
    return 'project';
  }
  if (value === 'project' || value === 'managed' || value === 'merge') {
    return resolveInstructionStrategy(value);
  }
  throw new WorkerError(
    'INVALID_INSTRUCTIONS_STRATEGY',
    `instructionsStrategy must be one of: project, managed, merge (received "${value}")`,
  );
}

function getWorkspaceInstructionFilePath(
  runtime: 'claude-code' | 'codex',
): 'CLAUDE.md' | 'AGENTS.md' {
  return runtime === 'claude-code' ? 'CLAUDE.md' : 'AGENTS.md';
}

async function readProjectInstructionFile({
  fileName,
  projectPath,
}: {
  fileName: 'CLAUDE.md' | 'AGENTS.md';
  projectPath: string | undefined;
}): Promise<string | null> {
  if (!projectPath || projectPath.trim().length === 0) {
    return null;
  }

  try {
    const instructionPath = safeExistsSync(`${projectPath}/${fileName}`, projectPath);
    return instructionPath ? await safeReadFile(instructionPath, projectPath) : null;
  } catch {
    return null;
  }
}
