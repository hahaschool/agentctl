import type {
  AccountCustody,
  AccountSource,
  AccountStatus,
  ApiAccount,
  ManagedRuntime,
  ManagedRuntimeConfig,
} from '@agentctl/shared';

import type {
  Machine as ApiMachine,
  RuntimeConfigDefaultsResponse,
  RuntimeConfigDriftResponse,
} from '@/lib/api';
import {
  DEFAULT_RUNTIME_MODELS,
  type ModelOption,
  RUNTIME_MODEL_OPTIONS,
} from '@/lib/model-options';

export type RuntimeAccessStrategy =
  | 'managed_only'
  | 'local_only'
  | 'prefer_managed'
  | 'prefer_local'
  | 'either';

export type RuntimeSwitchingPolicy = 'locked' | 'failover_only' | 'optimization_enabled';

export type RuntimeProfileSettings = {
  runtime: ManagedRuntime;
  label: string;
  description: string;
  defaultModel: string;
  modelOptions: readonly ModelOption[];
  accessStrategy: RuntimeAccessStrategy;
  switchingPolicy: RuntimeSwitchingPolicy;
  allowedMachineIds: string[];
};

export type WorkerRuntimeRow = {
  runtime: ManagedRuntime;
  probed: boolean;
  installed: boolean;
  authenticated: boolean;
  drifted: boolean;
  syncStatus: string;
  localCredentialCount: number;
  mirroredCredentialCount: number;
  lastAppliedAt: string | null;
};

export type WorkerRuntimeInventory = {
  machineId: string;
  hostname: string;
  status: ApiMachine['status'];
  runtimeRows: WorkerRuntimeRow[];
};

export const RUNTIME_LABELS: Record<ManagedRuntime, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
};

export const RUNTIME_DESCRIPTIONS: Record<ManagedRuntime, string> = {
  'claude-code': 'Anthropic-native runtime with managed CLAUDE.md, MCP, and model defaults.',
  codex: 'OpenAI Codex runtime with managed .codex/config.toml and worker-local discovery.',
};

export const ACCESS_STRATEGY_LABELS: Record<RuntimeAccessStrategy, string> = {
  managed_only: 'Managed only',
  local_only: 'Local only',
  prefer_managed: 'Prefer managed',
  prefer_local: 'Prefer local',
  either: 'Either',
};

export const SWITCHING_POLICY_LABELS: Record<RuntimeSwitchingPolicy, string> = {
  locked: 'Locked',
  failover_only: 'Failover only',
  optimization_enabled: 'Optimization enabled',
};

export function inferAccountRuntimeCompatibility(account: ApiAccount): ManagedRuntime[] {
  if (account.runtimeCompatibility && account.runtimeCompatibility.length > 0) {
    return account.runtimeCompatibility;
  }

  switch (account.provider) {
    case 'openai_api':
      return ['codex'];
    default:
      return ['claude-code'];
  }
}

export function inferAccountSource(account: ApiAccount): AccountSource {
  return account.source ?? 'managed';
}

export function inferAccountCustody(account: ApiAccount): AccountCustody {
  if (account.custody) return account.custody;
  return inferAccountSource(account) === 'discovered_local' ? 'worker_local' : 'control_plane';
}

export function inferAccountStatus(account: ApiAccount): AccountStatus {
  return account.status ?? (account.isActive ? 'active' : 'inactive');
}

export function readRuntimeProfiles(
  runtimeDefaults: RuntimeConfigDefaultsResponse | undefined,
  machines: ApiMachine[],
): RuntimeProfileSettings[] {
  const config = runtimeDefaults?.config;
  const allMachineIds = machines.map((machine) => machine.id);

  const claudeOverride = (config?.runtimeOverrides.claudeCode ?? {}) as Record<string, unknown>;
  const codexOverride = (config?.runtimeOverrides.codex ?? {}) as Record<string, unknown>;

  return [
    {
      runtime: 'claude-code',
      label: RUNTIME_LABELS['claude-code'],
      description: RUNTIME_DESCRIPTIONS['claude-code'],
      defaultModel: stringOrFallback(claudeOverride.model, DEFAULT_RUNTIME_MODELS['claude-code']),
      modelOptions: RUNTIME_MODEL_OPTIONS['claude-code'],
      accessStrategy: enumOrFallback(
        claudeOverride.accessStrategy,
        'prefer_managed',
      ) as RuntimeAccessStrategy,
      switchingPolicy: enumOrFallback(
        claudeOverride.switchingPolicy,
        'failover_only',
      ) as RuntimeSwitchingPolicy,
      allowedMachineIds: stringArrayOrFallback(claudeOverride.allowedMachineIds, allMachineIds),
    },
    {
      runtime: 'codex',
      label: RUNTIME_LABELS.codex,
      description: RUNTIME_DESCRIPTIONS.codex,
      defaultModel: stringOrFallback(codexOverride.model, DEFAULT_RUNTIME_MODELS.codex),
      modelOptions: RUNTIME_MODEL_OPTIONS.codex,
      accessStrategy: enumOrFallback(
        codexOverride.accessStrategy,
        'prefer_managed',
      ) as RuntimeAccessStrategy,
      switchingPolicy: enumOrFallback(
        codexOverride.switchingPolicy,
        'failover_only',
      ) as RuntimeSwitchingPolicy,
      allowedMachineIds: stringArrayOrFallback(codexOverride.allowedMachineIds, allMachineIds),
    },
  ];
}

export function buildRuntimeConfig(
  current: ManagedRuntimeConfig,
  profiles: RuntimeProfileSettings[],
): ManagedRuntimeConfig {
  const claudeProfile = profiles.find((profile) => profile.runtime === 'claude-code');
  const codexProfile = profiles.find((profile) => profile.runtime === 'codex');

  return {
    ...current,
    runtimeOverrides: {
      ...current.runtimeOverrides,
      claudeCode: {
        ...(current.runtimeOverrides.claudeCode ?? {}),
        ...(claudeProfile
          ? {
              model: claudeProfile.defaultModel,
              accessStrategy: claudeProfile.accessStrategy,
              switchingPolicy: claudeProfile.switchingPolicy,
              allowedMachineIds: claudeProfile.allowedMachineIds,
            }
          : {}),
      },
      codex: {
        ...(current.runtimeOverrides.codex ?? {}),
        ...(codexProfile
          ? {
              model: codexProfile.defaultModel,
              accessStrategy: codexProfile.accessStrategy,
              switchingPolicy: codexProfile.switchingPolicy,
              allowedMachineIds: codexProfile.allowedMachineIds,
            }
          : {}),
      },
    },
  };
}

export function buildWorkerRuntimeInventory(
  machines: ApiMachine[],
  drift: RuntimeConfigDriftResponse | undefined,
): WorkerRuntimeInventory[] {
  return machines.map((machine) => ({
    machineId: machine.id,
    hostname: machine.hostname,
    status: machine.status,
    runtimeRows: (['claude-code', 'codex'] as const).map((runtime) => {
      const item = drift?.items.find(
        (candidate) => candidate.machineId === machine.id && candidate.runtime === runtime,
      );
      const metadata = item?.metadata ?? {};
      const probed = item !== undefined;
      return {
        runtime,
        probed,
        installed: probed ? (item?.isInstalled ?? false) : false,
        authenticated: probed ? (item?.isAuthenticated ?? false) : false,
        drifted: item?.drifted ?? false,
        syncStatus: item?.syncStatus ?? 'unknown',
        localCredentialCount: numberOrZero(metadata.localCredentialCount),
        mirroredCredentialCount: numberOrZero(metadata.mirroredCredentialCount),
        lastAppliedAt: item?.lastConfigAppliedAt ?? null,
      };
    }),
  }));
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function stringArrayOrFallback(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : fallback;
}

function enumOrFallback(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
