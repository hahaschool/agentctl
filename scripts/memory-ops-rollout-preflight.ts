import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { MEMORY_OPS_JOB_KINDS, type MemoryOpsJobKind } from '../packages/shared/src/memory/ops.js';
import {
  EMBEDDING_MODEL_CATALOG,
  type EmbeddingCatalogEntry,
} from '../packages/shared/src/memory/providers.js';

const TARGET_KINDS = [...MEMORY_OPS_JOB_KINDS];
const TARGET_KIND_SET = new Set<MemoryOpsJobKind>(TARGET_KINDS);
const REQUIRED_TABLES = [
  'api_accounts',
  'memory_ops_jobs',
  'memory_ops_job_events',
  'memory_ops_audit',
] as const;
const STATUS_ORDER = ['fail', 'warn', 'pass', 'skip'] as const;
const SECRET_PATTERN = /SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL/i;
const require = createRequire(import.meta.url);

export type RolloutTarget = 'dev-1' | 'live';
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export type MemoryOpsRolloutPreflightCliOptions = {
  target: RolloutTarget;
  envFile?: string;
  json: boolean;
};

export type MemoryOpsRolloutPreflightCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  summary: string;
  details?: string[];
};

export type MemoryOpsRolloutDbProvider = {
  id: string;
  provider: string;
  model: string | null;
  lastTestOk: boolean | null;
  lastTestedAt: string | null;
  dim: number | null;
};

export type MemoryOpsRolloutDbInspection = {
  reachable: boolean;
  error?: string;
  requiredTables: Record<(typeof REQUIRED_TABLES)[number], boolean>;
  activeProvider: MemoryOpsRolloutDbProvider | null;
  embeddingProviderCount: number;
};

export type MemoryOpsRolloutRedisInspection = {
  reachable: boolean;
  ping?: string;
  error?: string;
};

export type MemoryOpsRolloutPathInspection = {
  exists: boolean;
  isDirectory: boolean;
};

export type MemoryOpsRolloutPreflightDeps = {
  inspectDatabase?: (databaseUrl: string) => Promise<MemoryOpsRolloutDbInspection>;
  inspectRedis?: (redisUrl: string) => Promise<MemoryOpsRolloutRedisInspection>;
  inspectPath?: (targetPath: string) => MemoryOpsRolloutPathInspection;
};

export type MemoryOpsRolloutPreflightReport = {
  ok: boolean;
  readyToEnable: boolean;
  target: RolloutTarget;
  envFile: string | null;
  rollout: {
    enabled: boolean;
    enabledKinds: MemoryOpsJobKind[];
    missingTargetKinds: MemoryOpsJobKind[];
    unknownKinds: string[];
    stage: 'disabled' | 'partial' | 'enabled';
  };
  checks: MemoryOpsRolloutPreflightCheck[];
};

type BuildReportOptions = MemoryOpsRolloutPreflightCliOptions & {
  env?: NodeJS.ProcessEnv;
};

function usage(): string {
  return `Usage: pnpm memory:ops:preflight [--target dev-1|live] [--env-file <path>] [--json]

Dry-run-only Memory Operations rollout preflight. Inspects local env/config,
rollout flags, DB/provider readiness, Redis reachability, drawer roots, and
Gate 2 env presence without starting jobs or calling live providers.

Options:
  --target <target>      dev-1 or live. Default: live.
  --env-file <path>      Merge an env file over the current shell env.
                         File values win when both are present.
  --json                 Emit a machine-readable JSON summary.
  --help, -h             Show this message.`;
}

export function parseArgs(
  argv: readonly string[] = process.argv.slice(2),
): MemoryOpsRolloutPreflightCliOptions {
  const options: MemoryOpsRolloutPreflightCliOptions = {
    target: 'live',
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--target') {
      const value = readOptionValue(argv, index, arg);
      if (value !== 'dev-1' && value !== 'live') {
        throw new Error('--target must be one of: dev-1, live');
      }
      options.target = value;
      index += 1;
      continue;
    }

    if (arg === '--env-file') {
      options.envFile = path.resolve(readOptionValue(argv, index, arg));
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

export function resolveMemoryOpsRolloutPreflightEnv(
  options: MemoryOpsRolloutPreflightCliOptions,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (!options.envFile) {
    return { ...env };
  }

  const raw = fs.readFileSync(options.envFile, 'utf8');
  const parsed = parseSimpleEnvFile(raw);
  return {
    ...env,
    ...parsed,
  };
}

export async function buildMemoryOpsRolloutPreflightReport(
  options: BuildReportOptions,
  deps: MemoryOpsRolloutPreflightDeps = {},
): Promise<MemoryOpsRolloutPreflightReport> {
  const env = options.env ?? resolveMemoryOpsRolloutPreflightEnv(options);
  const checks: MemoryOpsRolloutPreflightCheck[] = [];
  const inspectDatabase = deps.inspectDatabase ?? defaultInspectDatabase;
  const inspectRedis = deps.inspectRedis ?? defaultInspectRedis;
  const inspectPath = deps.inspectPath ?? defaultInspectPath;

  const enabledValue = parseBooleanLike(env.MEMORY_OPS_ENABLED);
  const parsedKinds = parseEnabledKinds(env.MEMORY_OPS_ENABLED_KINDS);
  const rolloutStage = classifyRolloutStage(enabledValue === true, parsedKinds.values);
  const rollout = {
    enabled: enabledValue === true,
    enabledKinds: parsedKinds.values,
    missingTargetKinds: TARGET_KINDS.filter((kind) => !parsedKinds.values.includes(kind)),
    unknownKinds: parsedKinds.unknown,
    stage: rolloutStage,
  };

  checks.push(evaluateRolloutFlags(env, rollout, enabledValue));
  checks.push(evaluateSigningSecret(env.MEMORY_OPS_SIGNING_SECRET));
  checks.push(evaluateEncryptionKey(env.CREDENTIAL_ENCRYPTION_KEY));

  const databaseUrl = env.DATABASE_URL?.trim() ?? '';
  const dbCheckIndex =
    checks.push(
      evaluateUrlPresence('database', 'DATABASE_URL', databaseUrl, ['postgres:', 'postgresql:']),
    ) - 1;
  let dbInspection: MemoryOpsRolloutDbInspection | null = null;
  if (checks[dbCheckIndex]?.status !== 'fail') {
    try {
      dbInspection = await inspectDatabase(databaseUrl);
    } catch (error) {
      dbInspection = {
        reachable: false,
        error: error instanceof Error ? error.message : String(error),
        requiredTables: {
          api_accounts: false,
          memory_ops_jobs: false,
          memory_ops_job_events: false,
          memory_ops_audit: false,
        },
        activeProvider: null,
        embeddingProviderCount: 0,
      };
    }
    checks[dbCheckIndex] = evaluateDatabaseInspection(dbInspection);
  }

  const redisUrl = env.REDIS_URL?.trim() ?? '';
  const redisCheckIndex =
    checks.push(evaluateUrlPresence('redis', 'REDIS_URL', redisUrl, ['redis:', 'rediss:'])) - 1;
  if (checks[redisCheckIndex]?.status !== 'fail') {
    let redisInspection: MemoryOpsRolloutRedisInspection;
    try {
      redisInspection = await inspectRedis(redisUrl);
    } catch (error) {
      redisInspection = {
        reachable: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    checks[redisCheckIndex] = evaluateRedisInspection(redisInspection);
  }

  checks.push(evaluateDrawerRoots(env.MEMORY_OPS_DRAWER_SOURCE_ROOTS, inspectPath));
  checks.push(evaluateProvider(dbInspection, options.target));
  checks.push(evaluateGeminiGate2(env, options.target));

  const hasFailure = checks.some((check) => check.status === 'fail');

  return {
    ok: !hasFailure,
    readyToEnable: !hasFailure,
    target: options.target,
    envFile: options.envFile ?? null,
    rollout,
    checks,
  };
}

export function formatMemoryOpsRolloutPreflightReport(
  report: MemoryOpsRolloutPreflightReport,
): string {
  const lines = [
    `Memory Operations rollout preflight (${report.target})`,
    '',
    `Env source: ${report.envFile ?? 'process environment'}`,
    `Ready to enable: ${report.readyToEnable ? 'yes' : 'no'}`,
    `Current rollout: ${report.rollout.stage}`,
    `Enabled kinds: ${report.rollout.enabledKinds.join(', ') || '(none)'}`,
  ];

  if (report.rollout.missingTargetKinds.length > 0) {
    lines.push(`Missing target kinds: ${report.rollout.missingTargetKinds.join(', ')}`);
  }
  if (report.rollout.unknownKinds.length > 0) {
    lines.push(`Unknown kinds: ${report.rollout.unknownKinds.join(', ')}`);
  }

  lines.push('', 'Checks:');

  for (const check of [...report.checks].sort((left, right) => {
    return STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status);
  })) {
    lines.push(`[${check.status.toUpperCase()}] ${check.label}: ${check.summary}`);
    for (const detail of check.details ?? []) {
      lines.push(`  - ${detail}`);
    }
  }

  lines.push('', 'Secret values are never printed by this preflight.');
  return lines.join('\n');
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(argv);
  const report = await buildMemoryOpsRolloutPreflightReport(options);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatMemoryOpsRolloutPreflightReport(report));
  }

  return report.ok ? 0 : 1;
}

function readOptionValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseSimpleEnvFile(raw: string): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/gu)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

function parseBooleanLike(value: string | undefined): boolean | null {
  if (value === undefined || value.trim() === '') {
    return null;
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function parseEnabledKinds(value: string | undefined): {
  values: MemoryOpsJobKind[];
  unknown: string[];
} {
  const values: MemoryOpsJobKind[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();

  for (const raw of (value ?? '').split(',')) {
    const kind = raw.trim();
    if (!kind || seen.has(kind)) {
      continue;
    }
    seen.add(kind);
    if (TARGET_KIND_SET.has(kind as MemoryOpsJobKind)) {
      values.push(kind as MemoryOpsJobKind);
    } else {
      unknown.push(kind);
    }
  }

  return { values, unknown };
}

function classifyRolloutStage(
  enabled: boolean,
  enabledKinds: readonly MemoryOpsJobKind[],
): 'disabled' | 'partial' | 'enabled' {
  if (!enabled) {
    return 'disabled';
  }
  if (enabledKinds.length === TARGET_KINDS.length) {
    return 'enabled';
  }
  return 'partial';
}

function evaluateRolloutFlags(
  env: NodeJS.ProcessEnv,
  rollout: MemoryOpsRolloutPreflightReport['rollout'],
  enabledValue: boolean | null,
): MemoryOpsRolloutPreflightCheck {
  if (!env.MEMORY_OPS_ENABLED || enabledValue === null) {
    return failCheck(
      'rollout-flags',
      'Rollout flags',
      'MEMORY_OPS_ENABLED must be set explicitly to true or false',
    );
  }

  if (!env.MEMORY_OPS_ENABLED_KINDS) {
    return failCheck(
      'rollout-flags',
      'Rollout flags',
      'MEMORY_OPS_ENABLED_KINDS must be set explicitly for the rollout target',
    );
  }

  if (rollout.unknownKinds.length > 0) {
    return failCheck(
      'rollout-flags',
      'Rollout flags',
      `Unknown job kinds in MEMORY_OPS_ENABLED_KINDS: ${rollout.unknownKinds.join(', ')}`,
    );
  }

  if (rollout.missingTargetKinds.length > 0) {
    return failCheck(
      'rollout-flags',
      'Rollout flags',
      `MEMORY_OPS_ENABLED_KINDS is missing target kinds: ${rollout.missingTargetKinds.join(', ')}`,
    );
  }

  if (!rollout.enabled) {
    return warnCheck(
      'rollout-flags',
      'Rollout flags',
      'Target job kinds are staged, but MEMORY_OPS_ENABLED is still false',
    );
  }

  return passCheck(
    'rollout-flags',
    'Rollout flags',
    'MEMORY_OPS_ENABLED=true with the full PR G job-kind set',
  );
}

function evaluateSigningSecret(value: string | undefined): MemoryOpsRolloutPreflightCheck {
  const secret = value?.trim() ?? '';
  if (!secret) {
    return failCheck(
      'signing-secret',
      'Signing secret',
      'MEMORY_OPS_SIGNING_SECRET is required for provider test tokens and egress previews',
    );
  }
  if (secret.length < 32) {
    return failCheck(
      'signing-secret',
      'Signing secret',
      'MEMORY_OPS_SIGNING_SECRET must be at least 32 characters',
    );
  }
  return passCheck(
    'signing-secret',
    'Signing secret',
    `MEMORY_OPS_SIGNING_SECRET is present (${secret.length} chars)`,
  );
}

function evaluateEncryptionKey(value: string | undefined): MemoryOpsRolloutPreflightCheck {
  const key = value?.trim() ?? '';
  if (!key) {
    return failCheck(
      'credential-key',
      'Credential encryption key',
      'CREDENTIAL_ENCRYPTION_KEY is required to decrypt embedding provider credentials',
    );
  }
  if (!/^[0-9a-fA-F]{64}$/u.test(key)) {
    return failCheck(
      'credential-key',
      'Credential encryption key',
      'CREDENTIAL_ENCRYPTION_KEY must be 64 hex characters',
    );
  }
  return passCheck(
    'credential-key',
    'Credential encryption key',
    'CREDENTIAL_ENCRYPTION_KEY is present (64 hex chars)',
  );
}

function evaluateUrlPresence(
  id: string,
  envVar: string,
  value: string,
  protocols: readonly string[],
): MemoryOpsRolloutPreflightCheck {
  if (!value) {
    return failCheck(id, envVar, `${envVar} is required`);
  }

  try {
    const parsed = new URL(value);
    if (!protocols.includes(parsed.protocol)) {
      return failCheck(id, envVar, `${envVar} must use one of: ${protocols.join(', ')}`);
    }
  } catch {
    return failCheck(id, envVar, `${envVar} is not a valid URL`);
  }

  return passCheck(id, envVar, `${envVar} is set`);
}

function evaluateDatabaseInspection(
  inspection: MemoryOpsRolloutDbInspection,
): MemoryOpsRolloutPreflightCheck {
  if (!inspection.reachable) {
    return failCheck(
      'database',
      'DATABASE_URL',
      inspection.error ?? 'Failed to connect to PostgreSQL',
    );
  }

  const missingTables = REQUIRED_TABLES.filter((table) => !inspection.requiredTables[table]);
  if (missingTables.length > 0) {
    return failCheck(
      'database',
      'DATABASE_URL',
      `Required Memory Ops tables are missing: ${missingTables.join(', ')}`,
    );
  }

  return passCheck(
    'database',
    'DATABASE_URL',
    'PostgreSQL is reachable and required Memory Ops tables exist',
  );
}

function evaluateRedisInspection(
  inspection: MemoryOpsRolloutRedisInspection,
): MemoryOpsRolloutPreflightCheck {
  if (!inspection.reachable) {
    return failCheck('redis', 'REDIS_URL', inspection.error ?? 'Failed to connect to Redis');
  }

  return passCheck('redis', 'REDIS_URL', `Redis is reachable (${inspection.ping ?? 'PING ok'})`);
}

function evaluateDrawerRoots(
  value: string | undefined,
  inspectPath: (targetPath: string) => MemoryOpsRolloutPathInspection,
): MemoryOpsRolloutPreflightCheck {
  const roots = (value ?? '')
    .split(':')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (roots.length === 0) {
    return failCheck(
      'drawer-roots',
      'Drawer source roots',
      'MEMORY_OPS_DRAWER_SOURCE_ROOTS must contain at least one local source root',
    );
  }

  const missing: string[] = [];
  const notDirectories: string[] = [];
  for (const root of roots) {
    const info = inspectPath(root);
    if (!info.exists) {
      missing.push(root);
      continue;
    }
    if (!info.isDirectory) {
      notDirectories.push(root);
    }
  }

  if (missing.length > 0 || notDirectories.length > 0) {
    const details: string[] = [];
    if (missing.length > 0) {
      details.push(`Missing: ${missing.join(', ')}`);
    }
    if (notDirectories.length > 0) {
      details.push(`Not directories: ${notDirectories.join(', ')}`);
    }
    return failCheck(
      'drawer-roots',
      'Drawer source roots',
      'One or more drawer source roots are invalid',
      details,
    );
  }

  return passCheck(
    'drawer-roots',
    'Drawer source roots',
    `Drawer source roots are present (${roots.length})`,
  );
}

function evaluateProvider(
  inspection: MemoryOpsRolloutDbInspection | null,
  target: RolloutTarget,
): MemoryOpsRolloutPreflightCheck {
  if (!inspection || !inspection.reachable) {
    return skipCheck(
      'provider',
      'Active embedding provider',
      'Skipped because the database check did not pass',
    );
  }

  if (!inspection.requiredTables.api_accounts) {
    return skipCheck(
      'provider',
      'Active embedding provider',
      'Skipped because api_accounts is not available yet',
    );
  }

  const provider = inspection.activeProvider;
  if (!provider) {
    return failCheck(
      'provider',
      'Active embedding provider',
      'No active embedding provider is configured in api_accounts',
    );
  }

  const catalogEntry = findCatalogEntry(provider.provider, provider.model);
  if (!catalogEntry) {
    return failCheck(
      'provider',
      'Active embedding provider',
      `Active provider ${provider.provider}/${provider.model ?? '(missing model)'} is not in the catalog`,
    );
  }

  if (!catalogEntry.verified) {
    const summary = `Active provider ${catalogEntry.provider}/${catalogEntry.model} is still unverified in the catalog`;
    return target === 'live'
      ? failCheck('provider', 'Active embedding provider', summary)
      : warnCheck('provider', 'Active embedding provider', summary);
  }

  if (provider.lastTestOk !== true) {
    return failCheck(
      'provider',
      'Active embedding provider',
      `Active provider ${catalogEntry.provider}/${catalogEntry.model} has not passed a provider test`,
    );
  }

  if (provider.dim !== catalogEntry.dim) {
    return failCheck(
      'provider',
      'Active embedding provider',
      `Active provider dim ${provider.dim ?? 'null'} does not match catalog dim ${catalogEntry.dim}`,
    );
  }

  const testedAt = provider.lastTestedAt ? `; last tested ${provider.lastTestedAt}` : '';
  return passCheck(
    'provider',
    'Active embedding provider',
    `Active provider ${catalogEntry.provider}/${catalogEntry.model} is tested and dimension-locked (${catalogEntry.dim})${testedAt}`,
  );
}

function evaluateGeminiGate2(
  env: NodeJS.ProcessEnv,
  target: RolloutTarget,
): MemoryOpsRolloutPreflightCheck {
  const hasKey = Boolean(env.GATE2_GEMINI_API_KEY?.trim());
  const verifiedFlag = env.GEMINI_VERIFIED?.trim() ?? '';
  const verifiedLabel = verifiedFlag ? `GEMINI_VERIFIED=${verifiedFlag}` : 'GEMINI_VERIFIED unset';

  if (!hasKey) {
    return warnCheck(
      'gemini-gate2',
      'Gemini Gate 2 env',
      `GATE2_GEMINI_API_KEY is not set; this preflight does not call Gemini (${verifiedLabel})`,
      target === 'live'
        ? [
            'Live Gemini verification is still a separate manual gate before any verified:true flip.',
          ]
        : undefined,
    );
  }

  if (verifiedFlag !== '1') {
    return warnCheck(
      'gemini-gate2',
      'Gemini Gate 2 env',
      `GATE2_GEMINI_API_KEY is present, but ${verifiedLabel}; the gated smoke will still skip`,
    );
  }

  return passCheck(
    'gemini-gate2',
    'Gemini Gate 2 env',
    'Gate 2 env vars are present; this preflight intentionally did not call Gemini',
  );
}

function passCheck(
  id: string,
  label: string,
  summary: string,
  details?: string[],
): MemoryOpsRolloutPreflightCheck {
  return { id, label, status: 'pass', summary, details };
}

function warnCheck(
  id: string,
  label: string,
  summary: string,
  details?: string[],
): MemoryOpsRolloutPreflightCheck {
  return { id, label, status: 'warn', summary, details };
}

function failCheck(
  id: string,
  label: string,
  summary: string,
  details?: string[],
): MemoryOpsRolloutPreflightCheck {
  return { id, label, status: 'fail', summary, details };
}

function skipCheck(
  id: string,
  label: string,
  summary: string,
  details?: string[],
): MemoryOpsRolloutPreflightCheck {
  return { id, label, status: 'skip', summary, details };
}

function findCatalogEntry(
  provider: string,
  model: string | null,
): EmbeddingCatalogEntry | undefined {
  if (!model) {
    return undefined;
  }
  return EMBEDDING_MODEL_CATALOG.find(
    (entry) => entry.provider === provider && entry.model === model,
  );
}

function defaultInspectPath(targetPath: string): MemoryOpsRolloutPathInspection {
  try {
    const stat = fs.statSync(targetPath);
    return {
      exists: true,
      isDirectory: stat.isDirectory(),
    };
  } catch {
    return {
      exists: false,
      isDirectory: false,
    };
  }
}

async function defaultInspectDatabase(databaseUrl: string): Promise<MemoryOpsRolloutDbInspection> {
  const { Pool } = requirePackageFromPnpm<{
    Pool: new (options: {
      connectionString: string;
      max: number;
      idleTimeoutMillis: number;
      connectionTimeoutMillis: number;
    }) => {
      query: <TRow = Record<string, unknown>>(sql: string) => Promise<{ rows: TRow[] }>;
      end: () => Promise<void>;
    };
  }>('pg');
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    idleTimeoutMillis: 1_000,
    connectionTimeoutMillis: 3_000,
  });

  try {
    await pool.query('SELECT 1');
    const tableRows = await pool.query<{
      api_accounts: boolean;
      memory_ops_jobs: boolean;
      memory_ops_job_events: boolean;
      memory_ops_audit: boolean;
    }>(
      `SELECT
         to_regclass('public.api_accounts') IS NOT NULL AS api_accounts,
         to_regclass('public.memory_ops_jobs') IS NOT NULL AS memory_ops_jobs,
         to_regclass('public.memory_ops_job_events') IS NOT NULL AS memory_ops_job_events,
         to_regclass('public.memory_ops_audit') IS NOT NULL AS memory_ops_audit`,
    );
    const tables = tableRows.rows[0] ?? {
      api_accounts: false,
      memory_ops_jobs: false,
      memory_ops_job_events: false,
      memory_ops_audit: false,
    };

    let activeProvider: MemoryOpsRolloutDbProvider | null = null;
    let embeddingProviderCount = 0;

    if (tables.api_accounts) {
      const countRows = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM api_accounts
          WHERE credential_kind = 'embedding'`,
      );
      embeddingProviderCount = Number.parseInt(countRows.rows[0]?.count ?? '0', 10);

      const providerRows = await pool.query<{
        id: string;
        provider: string;
        metadata: Record<string, unknown> | string | null;
      }>(
        `SELECT id, provider, metadata
           FROM api_accounts
          WHERE credential_kind = 'embedding'
            AND is_active = true
          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
          LIMIT 1`,
      );
      const row = providerRows.rows[0];
      if (row) {
        const metadata = readJsonObject(row.metadata);
        activeProvider = {
          id: row.id,
          provider: row.provider,
          model: typeof metadata.model === 'string' ? metadata.model : null,
          lastTestOk: typeof metadata.lastTestOk === 'boolean' ? metadata.lastTestOk : null,
          lastTestedAt: typeof metadata.lastTestedAt === 'string' ? metadata.lastTestedAt : null,
          dim: typeof metadata.dim === 'number' ? metadata.dim : null,
        };
      }
    }

    return {
      reachable: true,
      requiredTables: tables,
      activeProvider,
      embeddingProviderCount,
    };
  } catch (error) {
    return {
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
      requiredTables: {
        api_accounts: false,
        memory_ops_jobs: false,
        memory_ops_job_events: false,
        memory_ops_audit: false,
      },
      activeProvider: null,
      embeddingProviderCount: 0,
    };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function defaultInspectRedis(redisUrl: string): Promise<MemoryOpsRolloutRedisInspection> {
  type RedisConstructor = new (
    url: string,
    options: {
      lazyConnect: boolean;
      enableOfflineQueue: boolean;
      maxRetriesPerRequest: number;
      connectTimeout: number;
    },
  ) => {
    on: (event: 'error', listener: (error: Error) => void) => void;
    connect: () => Promise<void>;
    ping: () => Promise<string>;
    disconnect: () => void;
  };
  const redisModule = requirePackageFromPnpm<{ default?: RedisConstructor } | RedisConstructor>(
    'ioredis',
  );
  const RedisCtor = typeof redisModule === 'function' ? redisModule : (redisModule.default ?? null);
  if (!RedisCtor) {
    throw new Error('Failed to load ioredis from the pnpm store');
  }
  const redis = new RedisCtor(redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 3_000,
  });
  let lastError: Error | null = null;
  redis.on('error', (error) => {
    lastError = error;
  });

  try {
    await redis.connect();
    const ping = await redis.ping();
    return {
      reachable: true,
      ping,
    };
  } catch (error) {
    return {
      reachable: false,
      error: lastError?.message ?? (error instanceof Error ? error.message : String(error)),
    };
  } finally {
    redis.disconnect();
  }
}

function readJsonObject(value: Record<string, unknown> | string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return Array.isArray(value) ? {} : value;
}

function requirePackageFromPnpm<T>(packageName: string): T {
  const storeDir = path.resolve(process.cwd(), 'node_modules', '.pnpm');
  let entryName: string | undefined;

  try {
    entryName = fs
      .readdirSync(storeDir)
      .find((entry) => entry === packageName || entry.startsWith(`${packageName}@`));
  } catch {
    entryName = undefined;
  }

  if (!entryName) {
    throw new Error(`Package '${packageName}' was not found under ${storeDir}`);
  }

  const packageDir = path.join(storeDir, entryName, 'node_modules', packageName);
  return require(packageDir) as T;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (SECRET_PATTERN.test(message)) {
        console.error('Memory Ops rollout preflight failed with a secret-bearing error message');
      } else {
        console.error(message);
      }
      process.exitCode = 1;
    });
}
