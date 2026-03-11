import { createHash } from 'node:crypto';

import type {
  ManagedRuntime,
  ManagedRuntimeConfig,
  RuntimeCapabilityState,
  RuntimeConfigSyncRequest,
  RuntimeConfigSyncResponse,
} from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { DbAgentRegistry } from '../../registry/db-registry.js';
import type {
  MachineRuntimeStateRecord,
  RuntimeConfigStore,
} from '../../runtime-management/runtime-config-store.js';

export type RuntimeConfigRouteStore = Pick<
  RuntimeConfigStore,
  'getLatestRevision' | 'saveRevision' | 'listMachineStates' | 'upsertMachineState'
>;

export type RuntimeConfigRoutesOptions = {
  runtimeConfigStore: RuntimeConfigRouteStore;
  dbRegistry?: DbAgentRegistry | null;
  workerPort?: number;
};

export const runtimeConfigRoutes: FastifyPluginAsync<RuntimeConfigRoutesOptions> = async (
  app,
  opts,
) => {
  const { runtimeConfigStore, dbRegistry = null, workerPort = 9000 } = opts;

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

  app.post<{
    Body: { machineId?: string };
  }>(
    '/refresh',
    {
      schema: {
        tags: ['runtime-config'],
        summary: 'Probe workers for runtime installation status and persist results',
      },
    },
    async (request, reply) => {
      if (!dbRegistry) {
        return reply.code(503).send({
          error: 'REGISTRY_UNAVAILABLE',
          message: 'Database registry is not configured — cannot resolve worker URLs',
        });
      }

      const targetMachineId = request.body?.machineId;
      const allMachines = targetMachineId
        ? await dbRegistry.listMachines().then((list) => list.filter((m) => m.id === targetMachineId))
        : await dbRegistry.listMachines();

      const onlineMachines = allMachines.filter((m) => m.status !== 'offline');

      if (onlineMachines.length === 0) {
        return { refreshed: 0, items: [] };
      }

      type RefreshResult = {
        machineId: string;
        runtime: ManagedRuntime;
        isInstalled: boolean;
        isAuthenticated: boolean;
      };

      const results: RefreshResult[] = [];

      const probePromises = onlineMachines.map(async (machine) => {
        const address = machine.tailscaleIp ?? machine.hostname;
        const workerUrl = `http://${address}:${String(workerPort)}`;
        try {
          const res = await fetch(`${workerUrl}/runtime-config/state`, {
            signal: AbortSignal.timeout(5000),
          });
          if (!res.ok) return;

          const body = (await res.json()) as {
            runtimes?: Record<ManagedRuntime, RuntimeCapabilityState>;
          };
          if (!body.runtimes) return;

          for (const [runtime, state] of Object.entries(body.runtimes) as [
            ManagedRuntime,
            RuntimeCapabilityState,
          ][]) {
            await runtimeConfigStore.upsertMachineState({
              machineId: machine.id,
              runtime,
              isInstalled: state.installed,
              isAuthenticated: state.authenticated,
              syncStatus: 'unknown',
              configVersion: null,
              configHash: null,
              metadata: {},
            });
            results.push({
              machineId: machine.id,
              runtime,
              isInstalled: state.installed,
              isAuthenticated: state.authenticated,
            });
          }
        } catch {
          app.log.warn(
            { machineId: machine.id, workerUrl },
            'Failed to probe worker runtime state',
          );
        }
      });

      await Promise.all(probePromises);

      return { refreshed: results.length, items: results };
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
        modelProvider: 'openai',
        reasoningEffort: 'high',
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
