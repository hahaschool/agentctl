#!/usr/bin/env npx tsx

/**
 * Dry-run-first PostgreSQL tier provisioning helper.
 *
 * Generates or executes the admin SQL needed to create dev tier databases and
 * login roles with privileges scoped to that tier only. The helper intentionally
 * supports dev tiers only; beta/prod database provisioning remains a manual
 * operator action.
 *
 * Usage:
 *   pnpm tsx scripts/db-provision-tier.ts --tier dev-1
 *   ADMIN_DATABASE_URL=postgresql://postgres@localhost:5433/postgres \
 *     AGENTCTL_DEV1_DATABASE_PASSWORD=... \
 *     pnpm tsx scripts/db-provision-tier.ts --tier dev-1 --execute
 */

import pg from 'pg';

export const SUPPORTED_TIERS = ['dev-1', 'dev-2'] as const;
export type SupportedTier = (typeof SUPPORTED_TIERS)[number];

export const EXIT_SUCCESS = 0;
export const EXIT_INVALID_ARGS = 2;
export const EXIT_PROVISION_FAILED = 1;

type TierDefaults = {
  databaseName: string;
  appRoleName: string;
  rolePasswordEnv: string;
};

const TIER_DEFAULTS: Record<SupportedTier, TierDefaults> = {
  'dev-1': {
    databaseName: 'agentctl_dev1',
    appRoleName: 'agentctl_dev1_app',
    rolePasswordEnv: 'AGENTCTL_DEV1_DATABASE_PASSWORD',
  },
  'dev-2': {
    databaseName: 'agentctl_dev2',
    appRoleName: 'agentctl_dev2_app',
    rolePasswordEnv: 'AGENTCTL_DEV2_DATABASE_PASSWORD',
  },
};

const PROTECTED_TIERS = new Set(['beta', 'prod', 'production']);
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/i;

export class DbProvisionTierError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DbProvisionTierError';
  }
}

export type DbProvisionConfig = {
  tier: SupportedTier;
  databaseName: string;
  appRoleName: string;
  rolePasswordEnv: string;
  rolePassword?: string;
  adminDatabaseUrl?: string;
  dryRun: boolean;
};

export type ProvisionStep = {
  scope: 'admin' | 'database';
  name: string;
  description: string;
  sql: string;
};

export type ProvisionPlan = {
  tier: SupportedTier;
  databaseName: string;
  appRoleName: string;
  rolePasswordEnv: string;
  dryRun: boolean;
  steps: ProvisionStep[];
};

export type ProvisionResult = {
  dryRun: boolean;
  plan: ProvisionPlan;
  executedSteps: string[];
};

type BuildProvisionPlanOptions = {
  redactSecrets?: boolean;
};

function isSupportedTier(value: string): value is SupportedTier {
  return SUPPORTED_TIERS.includes(value as SupportedTier);
}

function requireOption(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new DbProvisionTierError('MISSING_OPTION_VALUE', `Missing value for ${flag}`, { flag });
  }
  return value;
}

function optionalOption(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new DbProvisionTierError('MISSING_OPTION_VALUE', `Missing value for ${flag}`, { flag });
  }
  return value;
}

export function defaultsForTier(tier: SupportedTier): TierDefaults {
  return TIER_DEFAULTS[tier];
}

export function parseArgs(
  argv = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): DbProvisionConfig {
  const args = argv.slice(2);
  const tierValue = requireOption(args, '--tier');

  if (PROTECTED_TIERS.has(tierValue)) {
    throw new DbProvisionTierError(
      'PROTECTED_TIER',
      `Refusing to provision protected tier "${tierValue}". This helper only supports dev-1/dev-2.`,
      { tier: tierValue },
    );
  }

  if (!isSupportedTier(tierValue)) {
    throw new DbProvisionTierError(
      'UNSUPPORTED_TIER',
      `Unsupported tier "${tierValue}". Use one of: ${SUPPORTED_TIERS.join(', ')}`,
      { tier: tierValue },
    );
  }

  const defaults = defaultsForTier(tierValue);
  const rolePasswordEnv = optionalOption(args, '--role-password-env') ?? defaults.rolePasswordEnv;
  const dryRun = !args.includes('--execute');
  const adminDatabaseUrl = optionalOption(args, '--admin-url') ?? env.ADMIN_DATABASE_URL;
  const rolePassword = env[rolePasswordEnv];

  if (!dryRun && !adminDatabaseUrl) {
    throw new DbProvisionTierError(
      'MISSING_ADMIN_DATABASE_URL',
      'Execute mode requires --admin-url or ADMIN_DATABASE_URL.',
    );
  }

  if (!dryRun && !rolePassword) {
    throw new DbProvisionTierError(
      'MISSING_ROLE_PASSWORD',
      `Execute mode requires role password env ${rolePasswordEnv}.`,
      { rolePasswordEnv },
    );
  }

  return {
    tier: tierValue,
    databaseName: defaults.databaseName,
    appRoleName: defaults.appRoleName,
    rolePasswordEnv,
    rolePassword,
    adminDatabaseUrl,
    dryRun,
  };
}

function quoteIdentifier(identifier: string): string {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new DbProvisionTierError('INVALID_IDENTIFIER', `Unsafe SQL identifier: ${identifier}`, {
      identifier,
    });
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function passwordLiteral(config: DbProvisionConfig, redactSecrets: boolean): string {
  if (redactSecrets) {
    return quoteLiteral('<role-password>');
  }
  if (!config.rolePassword) {
    throw new DbProvisionTierError(
      'MISSING_ROLE_PASSWORD',
      `Role password env ${config.rolePasswordEnv} is required to build executable SQL.`,
      { rolePasswordEnv: config.rolePasswordEnv },
    );
  }
  return quoteLiteral(config.rolePassword);
}

function createOrUpdateRoleSql(config: DbProvisionConfig, redactSecrets: boolean): string {
  const roleName = quoteIdentifier(config.appRoleName);
  const roleLiteral = quoteLiteral(config.appRoleName);
  const password = passwordLiteral(config, redactSecrets);

  return `
DO $agentctl_tier_provision$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = ${roleLiteral}) THEN
    CREATE ROLE ${roleName} WITH LOGIN PASSWORD ${password} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  ELSE
    ALTER ROLE ${roleName} WITH LOGIN PASSWORD ${password} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END
$agentctl_tier_provision$;`.trim();
}

function createDatabaseSql(config: DbProvisionConfig): string {
  return `CREATE DATABASE ${quoteIdentifier(config.databaseName)} OWNER ${quoteIdentifier(config.appRoleName)};`;
}

function databaseGrantsSql(config: DbProvisionConfig): string {
  const databaseName = quoteIdentifier(config.databaseName);
  const appRoleName = quoteIdentifier(config.appRoleName);

  return `
REVOKE ALL ON DATABASE ${databaseName} FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE ${databaseName} TO ${appRoleName};
ALTER DATABASE ${databaseName} OWNER TO ${appRoleName};`.trim();
}

function schemaGrantsSql(config: DbProvisionConfig): string {
  const appRoleName = quoteIdentifier(config.appRoleName);

  return `
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO ${appRoleName};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${appRoleName};
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${appRoleName};
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${appRoleName};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${appRoleName};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${appRoleName};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${appRoleName};`.trim();
}

export function buildProvisionPlan(
  config: DbProvisionConfig,
  options: BuildProvisionPlanOptions = {},
): ProvisionPlan {
  const redactSecrets = options.redactSecrets ?? true;

  return {
    tier: config.tier,
    databaseName: config.databaseName,
    appRoleName: config.appRoleName,
    rolePasswordEnv: config.rolePasswordEnv,
    dryRun: config.dryRun,
    steps: [
      {
        scope: 'admin',
        name: 'role',
        description: 'Create or update the tier-scoped app login role.',
        sql: createOrUpdateRoleSql(config, redactSecrets),
      },
      {
        scope: 'admin',
        name: 'database',
        description:
          'Create the tier database when missing. Execute mode checks pg_database before running this statement.',
        sql: createDatabaseSql(config),
      },
      {
        scope: 'admin',
        name: 'database-grants',
        description: 'Restrict public database access and grant only this tier role.',
        sql: databaseGrantsSql(config),
      },
      {
        scope: 'database',
        name: 'schema-grants',
        description: 'Restrict public schema access and grant app CRUD privileges in this tier DB.',
        sql: schemaGrantsSql(config),
      },
    ],
  };
}

export function renderProvisionPlan(plan: ProvisionPlan): string {
  const header = [
    '-- AgentCTL per-tier PostgreSQL provisioning plan',
    `-- tier: ${plan.tier}`,
    `-- database: ${plan.databaseName}`,
    `-- app role: ${plan.appRoleName}`,
    `-- mode: ${plan.dryRun ? 'dry-run' : 'execute'}`,
    '-- role password value: not printed',
    '-- beta/prod are intentionally unsupported by this helper',
  ].join('\n');

  const body = plan.steps
    .map((step, index) =>
      [
        '',
        `-- ${index + 1}. [${step.scope}] ${step.description}`,
        step.name === 'database'
          ? `--    Execute mode runs this only if ${plan.databaseName} does not already exist.`
          : null,
        step.sql,
      ]
        .filter((line): line is string => line !== null)
        .join('\n'),
    )
    .join('\n');

  return `${header}\n${body}\n`;
}

export function databaseUrlForDatabase(adminDatabaseUrl: string, databaseName: string): string {
  const url = new URL(adminDatabaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

export async function runProvision(config: DbProvisionConfig): Promise<ProvisionResult> {
  const plan = buildProvisionPlan(config, { redactSecrets: config.dryRun });

  if (config.dryRun) {
    return { dryRun: true, plan, executedSteps: [] };
  }

  if (!config.adminDatabaseUrl) {
    throw new DbProvisionTierError(
      'MISSING_ADMIN_DATABASE_URL',
      'Execute mode requires --admin-url or ADMIN_DATABASE_URL.',
    );
  }

  const executablePlan = buildProvisionPlan(config, { redactSecrets: false });
  const adminPool = new pg.Pool({ connectionString: config.adminDatabaseUrl });
  const executedSteps: string[] = [];

  try {
    for (const step of executablePlan.steps.filter((candidate) => candidate.scope === 'admin')) {
      if (step.name === 'database') {
        const existing = await adminPool.query<{ exists: number }>(
          'SELECT 1 AS exists FROM pg_database WHERE datname = $1',
          [config.databaseName],
        );
        if (existing.rows.length === 0) {
          await adminPool.query(step.sql);
          executedSteps.push(step.name);
        }
        continue;
      }
      await adminPool.query(step.sql);
      executedSteps.push(step.name);
    }
  } finally {
    await adminPool.end();
  }

  const targetPool = new pg.Pool({
    connectionString: databaseUrlForDatabase(config.adminDatabaseUrl, config.databaseName),
  });

  try {
    for (const step of executablePlan.steps.filter((candidate) => candidate.scope === 'database')) {
      await targetPool.query(step.sql);
      executedSteps.push(step.name);
    }
  } finally {
    await targetPool.end();
  }

  return { dryRun: false, plan, executedSteps };
}

export function usage(): string {
  return `
Usage:
  pnpm tsx scripts/db-provision-tier.ts --tier dev-1 [--dry-run]
  ADMIN_DATABASE_URL=postgresql://postgres@localhost:5433/postgres \\
    AGENTCTL_DEV1_DATABASE_PASSWORD=... \\
    pnpm tsx scripts/db-provision-tier.ts --tier dev-1 --execute

Options:
  --tier dev-1|dev-2          Required. Protected beta/prod tiers are refused.
  --dry-run                   Print the SQL plan only. This is the default.
  --execute                   Execute the plan against PostgreSQL.
  --admin-url <url>           Admin maintenance DB URL. Defaults to ADMIN_DATABASE_URL.
  --role-password-env <name>  Env var containing app role password.
`.trim();
}

export async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(usage());
    return;
  }

  const config = parseArgs();
  const result = await runProvision(config);

  if (result.dryRun) {
    console.log(renderProvisionPlan(result.plan));
    return;
  }

  console.error(
    `[db-provision-tier] Provisioned ${config.tier} database ${config.databaseName} with role ${config.appRoleName}.`,
  );
  console.error(`[db-provision-tier] Executed steps: ${result.executedSteps.join(', ')}`);
}

const isDirectExecution =
  process.argv[1]?.endsWith('db-provision-tier.ts') ||
  process.argv[1]?.endsWith('db-provision-tier.js');

if (isDirectExecution) {
  main().catch((error: unknown) => {
    if (error instanceof DbProvisionTierError) {
      console.error(`[db-provision-tier] Error [${error.code}]: ${error.message}`);
      if (error.context) {
        console.error('[db-provision-tier] Context:', JSON.stringify(error.context, null, 2));
      }
      process.exit(
        error.code === 'PROTECTED_TIER' || error.code === 'UNSUPPORTED_TIER'
          ? EXIT_INVALID_ARGS
          : EXIT_PROVISION_FAILED,
      );
    }

    console.error('[db-provision-tier] Fatal error:', error);
    process.exit(EXIT_PROVISION_FAILED);
  });
}
