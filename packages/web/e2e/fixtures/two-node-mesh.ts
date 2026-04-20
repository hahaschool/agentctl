import type { APIRequestContext } from '@playwright/test';

type Env = Record<string, string | undefined>;

type LiveSyncPeer = {
  machineId: string;
  peerVersion?: string | null;
};

type AutoUpdateDryRunEvent =
  | {
      readonly type: 'start';
      readonly startedAt: string;
      readonly command: string;
    }
  | {
      readonly type: 'stdout';
      readonly chunk: string;
    }
  | {
      readonly type: 'stderr';
      readonly chunk: string;
    }
  | {
      readonly type: 'done';
      readonly exitCode: number;
      readonly durationMs: number;
    }
  | {
      readonly type: 'error';
      readonly message: string;
    };

type PeerUpdateDryRunResult = {
  success?: boolean;
  dryRun?: boolean;
  steps?: Array<{
    name?: string;
    ok?: boolean;
    dryRun?: boolean;
    message?: string;
  }>;
};

type DisabledTwoNodeMeshFixtureConfig = {
  enabled: false;
  missingEnv: string[];
  invalidEnv: string[];
};

type EnabledTwoNodeMeshFixtureConfig = {
  enabled: true;
  peerMachineId: string;
  expectedPeerVersion: string;
  pollTimeoutMs: number;
  pollIntervalMs: number;
  dryRunEnabled: boolean;
  dryRunTimeoutMs: number;
  primaryWebUrl: (path?: string) => string;
  primaryApiUrl: (path?: string) => string;
};

export type TwoNodeMeshFixtureConfig =
  | DisabledTwoNodeMeshFixtureConfig
  | EnabledTwoNodeMeshFixtureConfig;

const ENABLE_ENV = 'AGENTCTL_MESH_TWO_NODE_E2E';
const DRY_RUN_ENABLE_ENV = 'AGENTCTL_MESH_DRY_RUN_E2E';
const REQUIRED_ENV = [
  'AGENTCTL_MESH_PRIMARY_WEB_URL',
  'AGENTCTL_MESH_PEER_MACHINE_ID',
  'AGENTCTL_MESH_EXPECTED_PEER_VERSION',
] as const;

function normalizeBaseUrl(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function readOptionalPositiveInt(
  env: Env,
  key: string,
  fallback: number,
): { value: number; invalid: boolean } {
  const raw = env[key]?.trim();
  if (!raw) return { value: fallback, invalid: false };

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { value: fallback, invalid: true };
  }

  return { value: parsed, invalid: false };
}

function joinUrl(baseUrl: string, path = '/'): string {
  return new URL(path, `${baseUrl}/`).toString();
}

export function getTwoNodeMeshFixtureConfig(env: Env = process.env): TwoNodeMeshFixtureConfig {
  if (env[ENABLE_ENV] !== '1') {
    return {
      enabled: false,
      missingEnv: [ENABLE_ENV],
      invalidEnv: [],
    };
  }

  const missingEnv = REQUIRED_ENV.filter((key) => !env[key]?.trim());
  const invalidEnv: string[] = [];
  const primaryWebBase = normalizeBaseUrl(env.AGENTCTL_MESH_PRIMARY_WEB_URL);
  if (env.AGENTCTL_MESH_PRIMARY_WEB_URL && !primaryWebBase) {
    invalidEnv.push('AGENTCTL_MESH_PRIMARY_WEB_URL');
  }

  const primaryApiBase = normalizeBaseUrl(
    env.AGENTCTL_MESH_PRIMARY_API_URL ?? env.AGENTCTL_MESH_PRIMARY_WEB_URL,
  );
  if (env.AGENTCTL_MESH_PRIMARY_API_URL && !primaryApiBase) {
    invalidEnv.push('AGENTCTL_MESH_PRIMARY_API_URL');
  }

  const timeout = readOptionalPositiveInt(env, 'AGENTCTL_MESH_POLL_TIMEOUT_MS', 30_000);
  if (timeout.invalid) invalidEnv.push('AGENTCTL_MESH_POLL_TIMEOUT_MS');

  const interval = readOptionalPositiveInt(env, 'AGENTCTL_MESH_POLL_INTERVAL_MS', 1_000);
  if (interval.invalid) invalidEnv.push('AGENTCTL_MESH_POLL_INTERVAL_MS');

  const dryRunTimeout = readOptionalPositiveInt(
    env,
    'AGENTCTL_MESH_DRY_RUN_TIMEOUT_MS',
    60_000,
  );
  if (dryRunTimeout.invalid) invalidEnv.push('AGENTCTL_MESH_DRY_RUN_TIMEOUT_MS');

  if (missingEnv.length > 0 || invalidEnv.length > 0 || !primaryWebBase || !primaryApiBase) {
    return {
      enabled: false,
      missingEnv,
      invalidEnv,
    };
  }

  return {
    enabled: true,
    peerMachineId: env.AGENTCTL_MESH_PEER_MACHINE_ID?.trim() ?? '',
    expectedPeerVersion: env.AGENTCTL_MESH_EXPECTED_PEER_VERSION?.trim() ?? '',
    pollTimeoutMs: timeout.value,
    pollIntervalMs: interval.value,
    dryRunEnabled: env[DRY_RUN_ENABLE_ENV] === '1',
    dryRunTimeoutMs: dryRunTimeout.value,
    primaryWebUrl: (path = '/') => joinUrl(primaryWebBase, path),
    primaryApiUrl: (path = '/') => joinUrl(primaryApiBase, path),
  };
}

export function skipReasonForTwoNodeMeshFixture(config: TwoNodeMeshFixtureConfig): string {
  if (config.enabled) {
    return 'two-node mesh fixture is enabled';
  }

  const parts = ['Set AGENTCTL_MESH_TWO_NODE_E2E=1 to run the live two-node mesh fixture.'];
  if (config.missingEnv.length > 0) {
    parts.push(`Missing: ${config.missingEnv.join(', ')}.`);
  }
  if (config.invalidEnv.length > 0) {
    parts.push(`Invalid: ${config.invalidEnv.join(', ')}.`);
  }
  return parts.join(' ');
}

export function skipReasonForTwoNodeMeshDryRun(config: TwoNodeMeshFixtureConfig): string {
  if (!config.enabled) {
    return skipReasonForTwoNodeMeshFixture(config);
  }
  if (!config.dryRunEnabled) {
    return `Set ${DRY_RUN_ENABLE_ENV}=1 to run the live peer-update dry-run assertion.`;
  }
  return 'two-node mesh dry-run assertion is enabled';
}

async function readPeer(request: APIRequestContext, config: EnabledTwoNodeMeshFixtureConfig) {
  const response = await request.get(config.primaryApiUrl('/api/sync/peers'));
  if (!response.ok()) {
    throw new Error(`GET /api/sync/peers failed with HTTP ${response.status()}`);
  }

  const body = (await response.json()) as { peers?: LiveSyncPeer[] };
  const peers = Array.isArray(body.peers) ? body.peers : [];
  return peers.find((peer) => peer.machineId === config.peerMachineId) ?? null;
}

export async function pingPeerAndWaitForVersion(
  request: APIRequestContext,
  config: EnabledTwoNodeMeshFixtureConfig,
): Promise<LiveSyncPeer> {
  const pingResponse = await request.post(
    config.primaryApiUrl(`/api/sync/peers/${encodeURIComponent(config.peerMachineId)}/ping`),
  );
  if (!pingResponse.ok()) {
    throw new Error(
      `POST /api/sync/peers/${config.peerMachineId}/ping failed with HTTP ${pingResponse.status()}`,
    );
  }

  const deadline = Date.now() + config.pollTimeoutMs;
  let lastPeer = await readPeer(request, config);

  while (Date.now() <= deadline) {
    if (lastPeer?.peerVersion === config.expectedPeerVersion) {
      return lastPeer;
    }

    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
    lastPeer = await readPeer(request, config);
  }

  throw new Error(
    `Timed out waiting for ${config.peerMachineId} peerVersion=${config.expectedPeerVersion}; ` +
      `last observed ${lastPeer?.peerVersion ?? 'missing peer'}`,
  );
}

function parseSseEvents(raw: string): AutoUpdateDryRunEvent[] {
  return raw
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data:'))
    .map((block) => JSON.parse(block.slice('data:'.length).trim()) as AutoUpdateDryRunEvent);
}

function parsePeerUpdateDryRunResult(output: string): PeerUpdateDryRunResult {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const candidate = [...lines]
    .reverse()
    .find((line) => line.startsWith('{') && line.endsWith('}'));

  if (!candidate) {
    throw new Error('peer update dry-run did not emit a JSON result line');
  }

  return JSON.parse(candidate) as PeerUpdateDryRunResult;
}

export async function runPeerUpdateDryRunAndReadPlan(
  request: APIRequestContext,
  config: EnabledTwoNodeMeshFixtureConfig,
): Promise<{
  events: AutoUpdateDryRunEvent[];
  output: string;
  result: PeerUpdateDryRunResult;
}> {
  const response = await request.post(config.primaryApiUrl('/api/mesh/auto-update/dry-run'), {
    headers: { Accept: 'text/event-stream' },
    timeout: config.dryRunTimeoutMs,
  });
  if (!response.ok()) {
    throw new Error(`POST /api/mesh/auto-update/dry-run failed with HTTP ${response.status()}`);
  }

  const events = parseSseEvents(await response.text());
  const output = events
    .filter((event) => event.type === 'stdout' || event.type === 'stderr')
    .map((event) => event.chunk)
    .join('');
  const result = parsePeerUpdateDryRunResult(output);

  return { events, output, result };
}
