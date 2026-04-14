import { describe, expect, it } from 'vitest';

import {
  buildProvisionPlan,
  DbProvisionTierError,
  databaseUrlForDatabase,
  parseArgs,
  renderProvisionPlan,
} from './db-provision-tier.js';

describe('parseArgs()', () => {
  it('defaults to a dry-run dev tier plan', () => {
    const config = parseArgs(['node', 'db-provision-tier.ts', '--tier', 'dev-1'], {});

    expect(config).toMatchObject({
      tier: 'dev-1',
      databaseName: 'agentctl_dev1',
      appRoleName: 'agentctl_dev1_app',
      rolePasswordEnv: 'AGENTCTL_DEV1_DATABASE_PASSWORD',
      dryRun: true,
    });
  });

  it('rejects protected beta and prod tiers', () => {
    expect(() => parseArgs(['node', 'db-provision-tier.ts', '--tier', 'beta'], {})).toThrow(
      DbProvisionTierError,
    );
    expect(() => parseArgs(['node', 'db-provision-tier.ts', '--tier', 'prod'], {})).toThrow(
      DbProvisionTierError,
    );
  });

  it('requires an admin URL and role password for execute mode', () => {
    expect(() =>
      parseArgs(['node', 'db-provision-tier.ts', '--tier', 'dev-2', '--execute'], {}),
    ).toThrow(DbProvisionTierError);

    expect(() =>
      parseArgs(
        [
          'node',
          'db-provision-tier.ts',
          '--tier',
          'dev-2',
          '--execute',
          '--admin-url',
          'postgresql://postgres@localhost:5433/postgres',
        ],
        {},
      ),
    ).toThrow(DbProvisionTierError);
  });

  it('loads the role password from the configured environment variable in execute mode', () => {
    const config = parseArgs(
      [
        'node',
        'db-provision-tier.ts',
        '--tier',
        'dev-2',
        '--execute',
        '--admin-url',
        'postgresql://postgres@localhost:5433/postgres',
        '--role-password-env',
        'DEV2_DB_PASSWORD',
      ],
      { DEV2_DB_PASSWORD: 'super-secret' },
    );

    expect(config.dryRun).toBe(false);
    expect(config.rolePassword).toBe('super-secret');
    expect(config.rolePasswordEnv).toBe('DEV2_DB_PASSWORD');
  });
});

describe('buildProvisionPlan()', () => {
  it('renders least-privilege SQL scoped to only the selected dev tier', () => {
    const plan = buildProvisionPlan({
      tier: 'dev-1',
      databaseName: 'agentctl_dev1',
      appRoleName: 'agentctl_dev1_app',
      rolePasswordEnv: 'AGENTCTL_DEV1_DATABASE_PASSWORD',
      rolePassword: 'super-secret',
      dryRun: true,
    });

    const sql = renderProvisionPlan(plan);

    expect(sql).toContain('CREATE ROLE "agentctl_dev1_app"');
    expect(sql).toContain('NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION');
    expect(sql).toContain('CREATE DATABASE "agentctl_dev1" OWNER "agentctl_dev1_app";');
    expect(sql).toContain('REVOKE ALL ON DATABASE "agentctl_dev1" FROM PUBLIC;');
    expect(sql).toContain('GRANT CONNECT, TEMPORARY ON DATABASE "agentctl_dev1"');
    expect(sql).toContain('REVOKE ALL ON SCHEMA public FROM PUBLIC;');
    expect(sql).toContain('GRANT USAGE, CREATE ON SCHEMA public TO "agentctl_dev1_app";');
    expect(sql).not.toContain('agentctl_beta');
    expect(sql).not.toContain('agentctl_prod');
    expect(sql).not.toContain('super-secret');
    expect(sql).not.toContain('AGENTCTL_DEV1_DATABASE_PASSWORD');
  });
});

describe('databaseUrlForDatabase()', () => {
  it('replaces only the database path and keeps credentials and query parameters', () => {
    expect(
      databaseUrlForDatabase(
        'postgresql://postgres:secret@localhost:5433/postgres?sslmode=disable',
        'agentctl_dev1',
      ),
    ).toBe('postgresql://postgres:secret@localhost:5433/agentctl_dev1?sslmode=disable');
  });
});
