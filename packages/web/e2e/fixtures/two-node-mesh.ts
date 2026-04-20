import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { APIRequestContext } from '@playwright/test';

type Env = Record<string, string | undefined>;

type LiveSyncPeer = {
  machineId: string;
  hostname?: string | null;
  syncUrl?: string | null;
  peerVersion?: string | null;
  peerSchemaVersion?: number | null;
  reverseRegistrationStatus?: 'pending' | 'ok' | 'failed' | null;
  reverseRegistrationError?: string | null;
  reverseRegistrationErrorCode?: string | null;
  reverseRegistrationHttpStatus?: number | null;
  lastSchemaAheadVersion?: number | null;
  lastSchemaAheadAt?: string | null;
  schemaAheadCount?: number | null;
};

export type LiveMeshConfig = {
  machineId: string;
  hostname: string;
  tailscaleIp: string | null;
  syncUrl: string;
  publicKey: string | null;
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
  schemaAheadEnabled: boolean;
  schemaAheadDatabaseUrl: string | null;
  schemaAheadTimeoutMs: number;
  machineVisibilityEnabled: boolean;
  machineVisibilityMissingEnv: string[];
  machineVisibilityInvalidEnv: string[];
  machineVisibilitySecondaryWebUrl: ((path?: string) => string) | null;
  machineVisibilityMachineHostname: string;
  machineVisibilityOriginLabel: string;
  machineVisibilityTimeoutMs: number;
  addPeerReverseEnabled: boolean;
  addPeerReverseMissingEnv: string[];
  addPeerReverseInvalidEnv: string[];
  addPeerReverseSecondaryWebUrl: ((path?: string) => string) | null;
  addPeerReverseSecondaryApiUrl: ((path?: string) => string) | null;
  addPeerReverseTimeoutMs: number;
  oneWayRetryEnabled: boolean;
  oneWayRetryInvalidEnv: string[];
  oneWayRetryTimeoutMs: number;
  primaryWebUrl: (path?: string) => string;
  primaryApiUrl: (path?: string) => string;
};

export type TwoNodeMeshFixtureConfig =
  | DisabledTwoNodeMeshFixtureConfig
  | EnabledTwoNodeMeshFixtureConfig;

const ENABLE_ENV = 'AGENTCTL_MESH_TWO_NODE_E2E';
const DRY_RUN_ENABLE_ENV = 'AGENTCTL_MESH_DRY_RUN_E2E';
const SCHEMA_AHEAD_ENABLE_ENV = 'AGENTCTL_MESH_SCHEMA_AHEAD_E2E';
const SCHEMA_AHEAD_DATABASE_URL_ENV = 'AGENTCTL_MESH_PRIMARY_DATABASE_URL';
const MACHINE_VISIBILITY_ENABLE_ENV = 'AGENTCTL_MESH_MACHINE_VISIBILITY_E2E';
const MACHINE_VISIBILITY_SECONDARY_WEB_URL_ENV = 'AGENTCTL_MESH_SECONDARY_WEB_URL';
const MACHINE_VISIBILITY_MACHINE_HOSTNAME_ENV = 'AGENTCTL_MESH_SYNCED_MACHINE_HOSTNAME';
const MACHINE_VISIBILITY_ORIGIN_LABEL_ENV = 'AGENTCTL_MESH_SYNCED_MACHINE_ORIGIN_LABEL';
const ADD_PEER_REVERSE_ENABLE_ENV = 'AGENTCTL_MESH_ADD_PEER_REVERSE_E2E';
const ADD_PEER_REVERSE_SECONDARY_API_URL_ENV = 'AGENTCTL_MESH_SECONDARY_API_URL';
const ONE_WAY_RETRY_ENABLE_ENV = 'AGENTCTL_MESH_ONE_WAY_RETRY_E2E';
const REQUIRED_ENV = [
  'AGENTCTL_MESH_PRIMARY_WEB_URL',
  'AGENTCTL_MESH_PEER_MACHINE_ID',
  'AGENTCTL_MESH_EXPECTED_PEER_VERSION',
] as const;
const execFileAsync = promisify(execFile);
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const SCHEMA_AHEAD_FIXTURE_RUNNER = `
import { createDb } from './packages/control-plane/src/db/connection.ts';
import { applyChange, recordSchemaAheadRejection } from './packages/control-plane/src/sync/apply-change.ts';

const databaseUrl = process.env.AGENTCTL_SCHEMA_AHEAD_FIXTURE_DATABASE_URL;
const peerMachineId = process.env.AGENTCTL_SCHEMA_AHEAD_FIXTURE_PEER_MACHINE_ID;
const envelopeSchemaVersion = Number(process.env.AGENTCTL_SCHEMA_AHEAD_FIXTURE_ENVELOPE_SCHEMA_VERSION);

if (!databaseUrl) {
  throw new Error('AGENTCTL_SCHEMA_AHEAD_FIXTURE_DATABASE_URL is required');
}
if (!peerMachineId) {
  throw new Error('AGENTCTL_SCHEMA_AHEAD_FIXTURE_PEER_MACHINE_ID is required');
}
if (!Number.isSafeInteger(envelopeSchemaVersion) || envelopeSchemaVersion < 0) {
  throw new Error('AGENTCTL_SCHEMA_AHEAD_FIXTURE_ENVELOPE_SCHEMA_VERSION must be a safe non-negative integer');
}

const db = createDb(databaseUrl, {
  sessionNodeId: 'schema-ahead-fixture',
  max: 1,
  min: 0,
  idleTimeoutMillis: 1_000,
  connectionTimeoutMillis: 5_000,
});

try {
  const rowId = \`schema-ahead-fixture-\${Date.now()}\`;
  const change = {
    id: Date.now(),
    nodeId: peerMachineId,
    tableName: 'machines',
    rowId,
    operation: 'INSERT',
    payload: {
      id: rowId,
      hostname: \`\${rowId}.fixture.invalid\`,
      tailscale_ip: '100.64.0.250',
      os: 'linux',
      arch: 'x64',
      status: 'online',
    },
    vclock: { [peerMachineId]: Date.now() },
    createdAt: new Date(),
    synced: false,
    meta: {
      schemaVersion: envelopeSchemaVersion,
      protocolVersion: 1,
      producerVersion: 'schema-ahead-fixture',
    },
  };

  try {
    await applyChange(change, db);
    throw new Error('Expected MESH_ENVELOPE_SCHEMA_AHEAD but applyChange accepted the fixture envelope');
  } catch (err) {
    if (!err || typeof err !== 'object' || err.code !== 'MESH_ENVELOPE_SCHEMA_AHEAD') {
      throw err;
    }
  }

  await recordSchemaAheadRejection(db, peerMachineId, envelopeSchemaVersion);
} finally {
  await db.$client.end();
}
`;

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

  const schemaAheadTimeout = readOptionalPositiveInt(
    env,
    'AGENTCTL_MESH_SCHEMA_AHEAD_TIMEOUT_MS',
    30_000,
  );
  if (schemaAheadTimeout.invalid) invalidEnv.push('AGENTCTL_MESH_SCHEMA_AHEAD_TIMEOUT_MS');

  if (missingEnv.length > 0 || invalidEnv.length > 0 || !primaryWebBase || !primaryApiBase) {
    return {
      enabled: false,
      missingEnv,
      invalidEnv,
    };
  }

  const machineVisibilityEnabled = env[MACHINE_VISIBILITY_ENABLE_ENV] === '1';
  const machineVisibilityMissingEnv: string[] = [];
  const machineVisibilityInvalidEnv: string[] = [];
  const secondaryWebUrlRaw = env[MACHINE_VISIBILITY_SECONDARY_WEB_URL_ENV]?.trim();
  const secondaryWebBase = normalizeBaseUrl(secondaryWebUrlRaw);
  const machineVisibilityMachineHostname =
    env[MACHINE_VISIBILITY_MACHINE_HOSTNAME_ENV]?.trim() ?? '';
  const machineVisibilityOriginLabel =
    env[MACHINE_VISIBILITY_ORIGIN_LABEL_ENV]?.trim() ?? '';
  const machineVisibilityTimeout = readOptionalPositiveInt(
    env,
    'AGENTCTL_MESH_MACHINE_VISIBILITY_TIMEOUT_MS',
    30_000,
  );
  const addPeerReverseEnabled = env[ADD_PEER_REVERSE_ENABLE_ENV] === '1';
  const addPeerReverseMissingEnv: string[] = [];
  const addPeerReverseInvalidEnv: string[] = [];
  const addPeerReverseSecondaryWebRaw =
    env[MACHINE_VISIBILITY_SECONDARY_WEB_URL_ENV]?.trim() ?? '';
  const addPeerReverseSecondaryWebBase = normalizeBaseUrl(addPeerReverseSecondaryWebRaw);
  const addPeerReverseSecondaryApiRaw =
    env[ADD_PEER_REVERSE_SECONDARY_API_URL_ENV]?.trim() ||
    env[MACHINE_VISIBILITY_SECONDARY_WEB_URL_ENV]?.trim();
  const addPeerReverseSecondaryApiBase = normalizeBaseUrl(addPeerReverseSecondaryApiRaw);
  const addPeerReverseTimeout = readOptionalPositiveInt(
    env,
    'AGENTCTL_MESH_ADD_PEER_REVERSE_TIMEOUT_MS',
    30_000,
  );
  const oneWayRetryEnabled = env[ONE_WAY_RETRY_ENABLE_ENV] === '1';
  const oneWayRetryInvalidEnv: string[] = [];
  const oneWayRetryTimeout = readOptionalPositiveInt(
    env,
    'AGENTCTL_MESH_ONE_WAY_RETRY_TIMEOUT_MS',
    30_000,
  );

  if (machineVisibilityEnabled) {
    if (!secondaryWebUrlRaw) {
      machineVisibilityMissingEnv.push(MACHINE_VISIBILITY_SECONDARY_WEB_URL_ENV);
    } else if (!secondaryWebBase) {
      machineVisibilityInvalidEnv.push(MACHINE_VISIBILITY_SECONDARY_WEB_URL_ENV);
    }
    if (!machineVisibilityMachineHostname) {
      machineVisibilityMissingEnv.push(MACHINE_VISIBILITY_MACHINE_HOSTNAME_ENV);
    }
    if (!machineVisibilityOriginLabel) {
      machineVisibilityMissingEnv.push(MACHINE_VISIBILITY_ORIGIN_LABEL_ENV);
    }
    if (machineVisibilityTimeout.invalid) {
      machineVisibilityInvalidEnv.push('AGENTCTL_MESH_MACHINE_VISIBILITY_TIMEOUT_MS');
    }
  }

  if (addPeerReverseEnabled) {
    if (!addPeerReverseSecondaryWebRaw) {
      addPeerReverseMissingEnv.push(MACHINE_VISIBILITY_SECONDARY_WEB_URL_ENV);
    } else if (!addPeerReverseSecondaryWebBase) {
      addPeerReverseInvalidEnv.push(MACHINE_VISIBILITY_SECONDARY_WEB_URL_ENV);
    }
    if (!addPeerReverseSecondaryApiRaw) {
      addPeerReverseMissingEnv.push(ADD_PEER_REVERSE_SECONDARY_API_URL_ENV);
    } else if (!addPeerReverseSecondaryApiBase) {
      addPeerReverseInvalidEnv.push(ADD_PEER_REVERSE_SECONDARY_API_URL_ENV);
    }
    if (addPeerReverseTimeout.invalid) {
      addPeerReverseInvalidEnv.push('AGENTCTL_MESH_ADD_PEER_REVERSE_TIMEOUT_MS');
    }
  }

  if (oneWayRetryEnabled) {
    if (oneWayRetryTimeout.invalid) {
      oneWayRetryInvalidEnv.push('AGENTCTL_MESH_ONE_WAY_RETRY_TIMEOUT_MS');
    }
  }

  return {
    enabled: true,
    peerMachineId: env.AGENTCTL_MESH_PEER_MACHINE_ID?.trim() ?? '',
    expectedPeerVersion: env.AGENTCTL_MESH_EXPECTED_PEER_VERSION?.trim() ?? '',
    pollTimeoutMs: timeout.value,
    pollIntervalMs: interval.value,
    dryRunEnabled: env[DRY_RUN_ENABLE_ENV] === '1',
    dryRunTimeoutMs: dryRunTimeout.value,
    schemaAheadEnabled: env[SCHEMA_AHEAD_ENABLE_ENV] === '1',
    schemaAheadDatabaseUrl: env[SCHEMA_AHEAD_DATABASE_URL_ENV]?.trim() || null,
    schemaAheadTimeoutMs: schemaAheadTimeout.value,
    machineVisibilityEnabled,
    machineVisibilityMissingEnv,
    machineVisibilityInvalidEnv,
    machineVisibilitySecondaryWebUrl: secondaryWebBase
      ? (path = '/') => joinUrl(secondaryWebBase, path)
      : null,
    machineVisibilityMachineHostname,
    machineVisibilityOriginLabel,
    machineVisibilityTimeoutMs: machineVisibilityTimeout.value,
    addPeerReverseEnabled,
    addPeerReverseMissingEnv,
    addPeerReverseInvalidEnv,
    addPeerReverseSecondaryWebUrl: addPeerReverseSecondaryWebBase
      ? (path = '/') => joinUrl(addPeerReverseSecondaryWebBase, path)
      : null,
    addPeerReverseSecondaryApiUrl: addPeerReverseSecondaryApiBase
      ? (path = '/') => joinUrl(addPeerReverseSecondaryApiBase, path)
      : null,
    addPeerReverseTimeoutMs: addPeerReverseTimeout.value,
    oneWayRetryEnabled,
    oneWayRetryInvalidEnv,
    oneWayRetryTimeoutMs: oneWayRetryTimeout.value,
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

export function skipReasonForTwoNodeMeshSchemaAhead(
  config: TwoNodeMeshFixtureConfig,
): string {
  if (!config.enabled) {
    return skipReasonForTwoNodeMeshFixture(config);
  }
  if (!config.schemaAheadEnabled) {
    return `Set ${SCHEMA_AHEAD_ENABLE_ENV}=1 to run the live schema-ahead rejection assertion.`;
  }
  if (!config.schemaAheadDatabaseUrl) {
    return `Set ${SCHEMA_AHEAD_DATABASE_URL_ENV} to the primary node database URL for the schema-ahead rejection assertion.`;
  }
  return 'two-node mesh schema-ahead assertion is enabled';
}

export function skipReasonForTwoNodeMeshMachineVisibility(
  config: TwoNodeMeshFixtureConfig,
): string {
  if (!config.enabled) {
    return skipReasonForTwoNodeMeshFixture(config);
  }
  if (!config.machineVisibilityEnabled) {
    return `Set ${MACHINE_VISIBILITY_ENABLE_ENV}=1 to run the live A-to-B machine visibility assertion.`;
  }

  const parts: string[] = [];
  if (config.machineVisibilityMissingEnv.length > 0) {
    parts.push(`Missing: ${config.machineVisibilityMissingEnv.join(', ')}.`);
  }
  if (config.machineVisibilityInvalidEnv.length > 0) {
    parts.push(`Invalid: ${config.machineVisibilityInvalidEnv.join(', ')}.`);
  }
  if (parts.length > 0) return parts.join(' ');

  return 'two-node mesh A-to-B machine visibility assertion is enabled';
}

export function skipReasonForTwoNodeMeshAddPeerReverse(
  config: TwoNodeMeshFixtureConfig,
): string {
  if (!config.enabled) {
    return skipReasonForTwoNodeMeshFixture(config);
  }
  if (!config.addPeerReverseEnabled) {
    return `Set ${ADD_PEER_REVERSE_ENABLE_ENV}=1 to run the live add-peer reverse-registration assertion.`;
  }

  const parts: string[] = [];
  if (config.addPeerReverseMissingEnv.length > 0) {
    parts.push(`Missing: ${config.addPeerReverseMissingEnv.join(', ')}.`);
  }
  if (config.addPeerReverseInvalidEnv.length > 0) {
    parts.push(`Invalid: ${config.addPeerReverseInvalidEnv.join(', ')}.`);
  }
  if (parts.length > 0) return parts.join(' ');

  return 'two-node mesh add-peer reverse-registration assertion is enabled';
}

export function skipReasonForTwoNodeMeshOneWayRetry(
  config: TwoNodeMeshFixtureConfig,
): string {
  if (!config.enabled) {
    return skipReasonForTwoNodeMeshFixture(config);
  }
  if (!config.oneWayRetryEnabled) {
    return `Set ${ONE_WAY_RETRY_ENABLE_ENV}=1 to run the live one-way warning/retry assertion.`;
  }

  const parts: string[] = [];
  if (config.oneWayRetryInvalidEnv.length > 0) {
    parts.push(`Invalid: ${config.oneWayRetryInvalidEnv.join(', ')}.`);
  }
  if (parts.length > 0) return parts.join(' ');

  return 'two-node mesh one-way warning/retry assertion is enabled';
}

export async function readMeshConfig(
  request: APIRequestContext,
  meshUrl: (path?: string) => string,
): Promise<LiveMeshConfig> {
  const response = await request.get(meshUrl('/api/mesh/config'));
  if (!response.ok()) {
    throw new Error(`GET /api/mesh/config failed with HTTP ${response.status()}`);
  }

  const body = (await response.json()) as Partial<LiveMeshConfig>;
  if (!body.machineId || !body.hostname || !body.syncUrl) {
    throw new Error('GET /api/mesh/config did not return machineId, hostname, and syncUrl');
  }

  return {
    machineId: body.machineId,
    hostname: body.hostname,
    tailscaleIp: body.tailscaleIp ?? null,
    syncUrl: body.syncUrl,
    publicKey: body.publicKey ?? null,
  };
}

async function readPeerFromApiUrl(
  request: APIRequestContext,
  peersUrl: (path?: string) => string,
  machineId: string,
): Promise<LiveSyncPeer | null> {
  const response = await request.get(peersUrl('/api/sync/peers'));
  if (!response.ok()) {
    throw new Error(`GET /api/sync/peers failed with HTTP ${response.status()}`);
  }

  const body = (await response.json()) as { peers?: LiveSyncPeer[] };
  const peers = Array.isArray(body.peers) ? body.peers : [];
  return peers.find((peer) => peer.machineId === machineId) ?? null;
}

async function readPeer(request: APIRequestContext, config: EnabledTwoNodeMeshFixtureConfig) {
  return readPeerFromApiUrl(request, config.primaryApiUrl, config.peerMachineId);
}

export async function readConfiguredPeer(
  request: APIRequestContext,
  config: EnabledTwoNodeMeshFixtureConfig,
): Promise<LiveSyncPeer | null> {
  return readPeer(request, config);
}

async function waitForPeer(
  request: APIRequestContext,
  peersUrl: (path?: string) => string,
  machineId: string,
  timeoutMs: number,
  intervalMs: number,
  predicate: (peer: LiveSyncPeer) => boolean,
  description: string,
): Promise<LiveSyncPeer> {
  const deadline = Date.now() + timeoutMs;
  let lastPeer = await readPeerFromApiUrl(request, peersUrl, machineId);

  while (Date.now() <= deadline) {
    if (lastPeer && predicate(lastPeer)) {
      return lastPeer;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    lastPeer = await readPeerFromApiUrl(request, peersUrl, machineId);
  }

  throw new Error(
    `Timed out waiting for ${machineId} ${description}; ` +
      `last observed ${lastPeer ? JSON.stringify(lastPeer) : 'missing peer'}`,
  );
}

export async function waitForPrimaryPeerReverseStatus(
  request: APIRequestContext,
  config: EnabledTwoNodeMeshFixtureConfig,
  machineId: string,
  status: 'ok' | 'failed',
  timeoutMs: number,
): Promise<LiveSyncPeer> {
  return waitForPeer(
    request,
    config.primaryApiUrl,
    machineId,
    timeoutMs,
    config.pollIntervalMs,
    (peer) => peer.reverseRegistrationStatus === status,
    `reverseRegistrationStatus=${status}`,
  );
}

export async function waitForAddPeerReverseOnSecondaryNode(
  request: APIRequestContext,
  config: EnabledTwoNodeMeshFixtureConfig,
  primaryMachineId: string,
): Promise<LiveSyncPeer> {
  if (!config.addPeerReverseSecondaryApiUrl) {
    throw new Error(skipReasonForTwoNodeMeshAddPeerReverse(config));
  }

  return waitForPeer(
    request,
    config.addPeerReverseSecondaryApiUrl,
    primaryMachineId,
    config.addPeerReverseTimeoutMs,
    config.pollIntervalMs,
    (peer) => Boolean(peer.machineId),
    'to appear on the secondary node after reverse registration',
  );
}

async function readPrimarySchemaVersion(
  request: APIRequestContext,
  config: EnabledTwoNodeMeshFixtureConfig,
): Promise<number> {
  const response = await request.get(config.primaryApiUrl('/api/version-compat'));
  if (!response.ok()) {
    throw new Error(`GET /api/version-compat failed with HTTP ${response.status()}`);
  }

  const body = (await response.json()) as { schemaVersion?: unknown };
  const schemaVersion = body.schemaVersion;
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 0) {
    throw new Error('GET /api/version-compat did not return a safe schemaVersion');
  }

  return schemaVersion;
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

function formatFixtureCommandError(err: unknown, secret: string): string {
  const raw =
    err instanceof Error
      ? [err.message, 'stderr' in err ? String(err.stderr ?? '') : ''].join('\n').trim()
      : String(err);
  return raw.replaceAll(secret, '[redacted database url]');
}

async function runSchemaAheadFixtureInjection(
  config: EnabledTwoNodeMeshFixtureConfig,
  envelopeSchemaVersion: number,
): Promise<void> {
  if (!config.schemaAheadDatabaseUrl) {
    throw new Error(skipReasonForTwoNodeMeshSchemaAhead(config));
  }

  try {
    await execFileAsync('pnpm', ['--filter', '@agentctl/shared', 'build'], {
      cwd: REPO_ROOT,
      timeout: config.schemaAheadTimeoutMs,
      maxBuffer: 1_000_000,
    });

    await execFileAsync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', SCHEMA_AHEAD_FIXTURE_RUNNER],
      {
        cwd: REPO_ROOT,
        timeout: config.schemaAheadTimeoutMs,
        maxBuffer: 1_000_000,
        env: {
          ...process.env,
          AGENTCTL_SCHEMA_AHEAD_FIXTURE_DATABASE_URL: config.schemaAheadDatabaseUrl,
          AGENTCTL_SCHEMA_AHEAD_FIXTURE_PEER_MACHINE_ID: config.peerMachineId,
          AGENTCTL_SCHEMA_AHEAD_FIXTURE_ENVELOPE_SCHEMA_VERSION: String(
            envelopeSchemaVersion,
          ),
        },
      },
    );
  } catch (err) {
    throw new Error(
      `schema-ahead fixture injection failed: ${formatFixtureCommandError(
        err,
        config.schemaAheadDatabaseUrl,
      )}`,
    );
  }
}

export async function forceSchemaAheadEnvelopeRejectionAndReadPeer(
  request: APIRequestContext,
  config: EnabledTwoNodeMeshFixtureConfig,
): Promise<{
  before: LiveSyncPeer;
  after: LiveSyncPeer;
  localSchemaVersion: number;
  envelopeSchemaVersion: number;
}> {
  if (!config.schemaAheadEnabled || !config.schemaAheadDatabaseUrl) {
    throw new Error(skipReasonForTwoNodeMeshSchemaAhead(config));
  }

  const before = await readPeer(request, config);
  if (!before) {
    throw new Error(`Peer ${config.peerMachineId} is not registered on the primary node`);
  }

  const beforeCount = before.schemaAheadCount ?? 0;
  const localSchemaVersion = await readPrimarySchemaVersion(request, config);
  const envelopeSchemaVersion = localSchemaVersion + 2;

  await runSchemaAheadFixtureInjection(config, envelopeSchemaVersion);

  const deadline = Date.now() + config.schemaAheadTimeoutMs;
  let after = await readPeer(request, config);

  while (Date.now() <= deadline) {
    const count = after?.schemaAheadCount ?? 0;
    if (
      after?.lastSchemaAheadVersion === envelopeSchemaVersion &&
      count > beforeCount
    ) {
      return { before, after, localSchemaVersion, envelopeSchemaVersion };
    }

    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
    after = await readPeer(request, config);
  }

  throw new Error(
    `Timed out waiting for ${config.peerMachineId} schema-ahead rejection ` +
      `lastSchemaAheadVersion=${envelopeSchemaVersion}; ` +
      `last observed version=${after?.lastSchemaAheadVersion ?? 'missing peer'}, ` +
      `count=${after?.schemaAheadCount ?? 0}`,
  );
}
