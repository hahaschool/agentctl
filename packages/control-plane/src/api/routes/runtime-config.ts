import { createHash } from 'node:crypto';

import type {
  ManagedRuntimeConfig,
  RuntimeConfigSyncRequest,
  RuntimeConfigSyncResponse,
} from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type {
  MachineRuntimeStateRecord,
  RuntimeConfigStore,
} from '../../runtime-management/runtime-config-store.js';

export type RuntimeConfigRouteStore = Pick<
  RuntimeConfigStore,
  'getLatestRevision' | 'saveRevision' | 'listMachineStates'
>;

export type RuntimeConfigRoutesOptions = {
  runtimeConfigStore: RuntimeConfigRouteStore;
};

export const runtimeConfigRoutes: FastifyPluginAsync<RuntimeConfigRoutesOptions> = async (
  app,
  opts,
) => {
  const { runtimeConfigStore } = opts;

  app.get(
    '/defaults',
    {
      schema: {
        tags: ['runtime-config'],
        summary: 'Get the active managed runtime configuration defaults',
      },
    },
    async () => {
      const latest = await runtimeConfigStore.getLatestRevision();
      const effective = latest ?? makeDefaultRuntimeConfig();

      return {
        version: effective.version,
        hash: effective.hash,
        config: effective.config ?? effective,
      };
    },
  );

  app.put<{
    Body: { config?: ManagedRuntimeConfig };
  }>(
    '/defaults',
    {
      schema: {
        tags: ['runtime-config'],
        summary: 'Save managed runtime configuration defaults',
      },
    },
    async (request, reply) => {
      const { config } = request.body ?? {};
      if (!config) {
        return reply.code(400).send({
          error: 'INVALID_RUNTIME_CONFIG',
          message: 'A config payload is required',
        });
      }

      const saved = await runtimeConfigStore.saveRevision(config);
      return {
        version: saved.version,
        hash: saved.hash,
        config: saved.config,
      };
    },
  );

  app.post<{
    Body: RuntimeConfigSyncRequest;
  }>(
    '/sync',
    {
      schema: {
        tags: ['runtime-config'],
        summary: 'Queue runtime config synchronization for one or more machines',
      },
    },
    async (request, reply) => {
      const { machineIds, configVersion } = request.body ?? {};
      if (
        !Array.isArray(machineIds) ||
        machineIds.length === 0 ||
        typeof configVersion !== 'number'
      ) {
        return reply.code(400).send({
          error: 'INVALID_RUNTIME_SYNC_REQUEST',
          message: 'machineIds[] and configVersion are required',
        });
      }

      const response: RuntimeConfigSyncResponse = {
        queued: machineIds.length,
        machineIds,
        configVersion,
      };
      return response;
    },
  );

  app.get<{
    Querystring: { machineId?: string };
  }>(
    '/drift',
    {
      schema: {
        tags: ['runtime-config'],
        summary: 'Inspect per-machine runtime config drift',
      },
    },
    async (request) => {
      const latest = await runtimeConfigStore.getLatestRevision();
      const effective = latest ?? makeDefaultRuntimeConfig();
      const states = await runtimeConfigStore.listMachineStates(request.query.machineId);

      return {
        activeVersion: effective.version,
        activeHash: effective.hash,
        items: states.map((state) => toDriftItem(state, effective.version, effective.hash)),
      };
    },
  );
};

type RuntimeConfigEnvelope = {
  version: number;
  hash: string;
  config: ManagedRuntimeConfig;
};

function makeDefaultRuntimeConfig(): RuntimeConfigEnvelope {
  const draft = {
    version: 1,
    instructions: {
      userGlobal: 'Follow the managed runtime defaults from AgentCTL.',
      projectTemplate: 'Use repository instructions, MCP, and skills as rendered by AgentCTL.',
    },
    mcpServers: [],
    skills: [],
    sandbox: 'workspace-write',
    approvalPolicy: 'on-request',
    environmentPolicy: {
      inherit: ['PATH', 'HOME'],
      set: {},
    },
    runtimeOverrides: {
      claudeCode: {
        settingsPath: '.claude/settings.json',
      },
      codex: {
        configPath: '.codex/config.toml',
      },
    },
  } satisfies Omit<ManagedRuntimeConfig, 'hash'>;

  const hash = `sha256:${createHash('sha256').update(JSON.stringify(draft)).digest('hex')}`;
  return {
    version: draft.version,
    hash,
    config: {
      ...draft,
      hash,
    },
  };
}

function toDriftItem(
  state: MachineRuntimeStateRecord,
  activeVersion: number,
  activeHash: string,
): MachineRuntimeStateRecord & { drifted: boolean } {
  return {
    ...state,
    drifted:
      state.configVersion !== activeVersion ||
      state.configHash !== activeHash ||
      state.syncStatus !== 'in-sync',
  };
}
