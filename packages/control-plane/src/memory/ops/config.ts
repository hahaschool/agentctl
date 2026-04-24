import { MEMORY_OPS_JOB_KINDS, type MemoryOpsJobKind } from '@agentctl/shared';

const MEMORY_OPS_JOB_KIND_SET = new Set<string>(MEMORY_OPS_JOB_KINDS);

function parseEnabledKinds(value: string | undefined): Set<MemoryOpsJobKind> {
  const kinds = new Set<MemoryOpsJobKind>();
  for (const rawKind of (value ?? '').split(',')) {
    const kind = rawKind.trim();
    if (!kind) {
      continue;
    }
    if (MEMORY_OPS_JOB_KIND_SET.has(kind)) {
      kinds.add(kind as MemoryOpsJobKind);
    }
  }
  return kinds;
}

function parseMaxFailRatio(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? '0.05');
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0.05;
}

export type MemoryOpsConfig = {
  enabled: boolean;
  enabledJobKinds: Set<MemoryOpsJobKind>;
  signingSecret: string;
  maxFailRatio: number;
  drawerSourceRoots: string[];
};

export function readMemoryOpsConfig(): MemoryOpsConfig {
  return {
    enabled: process.env.MEMORY_OPS_ENABLED === 'true',
    enabledJobKinds: parseEnabledKinds(process.env.MEMORY_OPS_ENABLED_KINDS),
    signingSecret: process.env.MEMORY_OPS_SIGNING_SECRET ?? '',
    maxFailRatio: parseMaxFailRatio(process.env.MEMORY_OPS_MAX_FAIL_RATIO),
    drawerSourceRoots: (process.env.MEMORY_OPS_DRAWER_SOURCE_ROOTS ?? '')
      .split(':')
      .map((path) => path.trim())
      .filter(Boolean),
  };
}

export const MEMORY_OPS_ENABLED = readMemoryOpsConfig().enabled;
export const ENABLED_JOB_KINDS = readMemoryOpsConfig().enabledJobKinds;
export const MEMORY_OPS_SIGNING_SECRET = readMemoryOpsConfig().signingSecret;
export const MAX_FAIL_RATIO = readMemoryOpsConfig().maxFailRatio;
export const DRAWER_SOURCE_ROOTS = readMemoryOpsConfig().drawerSourceRoots;
