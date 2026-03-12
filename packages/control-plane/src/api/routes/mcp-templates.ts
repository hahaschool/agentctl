import type { McpServerTemplate } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { MachineRegistryLike } from '../../registry/agent-registry.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { resolveWorkerUrlByMachineId } from '../resolve-worker-url.js';

// ---------------------------------------------------------------------------
// Default MCP server templates
// ---------------------------------------------------------------------------

const MCP_TEMPLATES: readonly McpServerTemplate[] = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read/write access to the local filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/'],
    runtimeTypes: ['claude-code', 'codex'],
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'Persistent memory storage via the MCP memory server',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    runtimeTypes: ['claude-code', 'codex'],
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Web search via the Brave Search API',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    env: { BRAVE_API_KEY: '' },
    runtimeTypes: ['claude-code', 'codex'],
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'GitHub repository operations (issues, PRs, code search)',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    runtimeTypes: ['claude-code', 'codex'],
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Query and manage PostgreSQL databases',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    env: { DATABASE_URL: '' },
    runtimeTypes: ['claude-code', 'codex'],
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    description: 'Query and manage SQLite databases',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite'],
    runtimeTypes: ['claude-code', 'codex'],
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Read and post messages in Slack workspaces',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: { SLACK_BOT_TOKEN: '', SLACK_TEAM_ID: '' },
    runtimeTypes: ['claude-code'],
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer',
    description: 'Browser automation and web scraping via Puppeteer',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    runtimeTypes: ['claude-code'],
  },
  {
    id: 'fetch',
    name: 'Fetch',
    description: 'Make HTTP requests to external APIs',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    runtimeTypes: ['claude-code', 'codex'],
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: 'Step-by-step reasoning and problem decomposition',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    runtimeTypes: ['claude-code', 'codex'],
  },
] as const;

// ---------------------------------------------------------------------------
// Route options
// ---------------------------------------------------------------------------

export type McpTemplateRoutesOptions = {
  registry?: MachineRegistryLike;
  dbRegistry?: DbAgentRegistry;
  workerPort?: number;
};

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const mcpTemplateRoutes: FastifyPluginAsync<McpTemplateRoutesOptions> = async (
  app,
  opts,
) => {
  const { dbRegistry, workerPort = 9000 } = opts;

  // GET /api/mcp/templates — list all MCP server templates
  app.get(
    '/templates',
    {
      schema: {
        tags: ['mcp'],
        summary: 'List MCP server templates',
        description: 'Returns pre-configured MCP server templates for common use cases',
      },
    },
    async (_request, reply) => {
      return reply.send({
        ok: true,
        templates: MCP_TEMPLATES,
        count: MCP_TEMPLATES.length,
      });
    },
  );

  // GET /api/mcp/discover — proxy discovery request to a worker
  app.get<{
    Querystring: { machineId: string; projectPath?: string };
  }>(
    '/discover',
    {
      schema: {
        tags: ['mcp'],
        summary: 'Discover MCP servers on a machine',
        description:
          'Proxies a discovery request to the specified worker machine to find MCP servers from project and global configs',
      },
    },
    async (request, reply) => {
      const { machineId, projectPath } = request.query;

      if (!machineId) {
        return reply.code(400).send({
          error: 'INVALID_INPUT',
          message: 'machineId query parameter is required',
        });
      }

      if (!dbRegistry) {
        return reply.code(503).send({
          error: 'REGISTRY_UNAVAILABLE',
          message: 'Database registry is not configured',
        });
      }

      const workerResult = await resolveWorkerUrlByMachineId(machineId, {
        dbRegistry,
        workerPort,
      });

      if (!workerResult.ok) {
        return reply
          .code(workerResult.status)
          .send({ error: workerResult.error, message: workerResult.message });
      }

      // Proxy the request to the worker
      const qs = new URLSearchParams();
      if (projectPath) qs.set('projectPath', projectPath);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      const workerUrl = `${workerResult.url}/api/mcp/discover${suffix}`;

      try {
        const response = await fetch(workerUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(10_000),
        });

        const data = await response.json();

        if (!response.ok) {
          return reply.code(response.status).send(data);
        }

        return reply.send(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(502).send({
          error: 'WORKER_UNREACHABLE',
          message: `Failed to reach worker for MCP discovery: ${message}`,
        });
      }
    },
  );
};
