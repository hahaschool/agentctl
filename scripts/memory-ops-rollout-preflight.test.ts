import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildMemoryOpsRolloutPreflightReport,
  formatMemoryOpsRolloutPreflightReport,
  type MemoryOpsRolloutPreflightDeps,
  parseArgs,
  resolveMemoryOpsRolloutPreflightEnv,
} from './memory-ops-rollout-preflight.js';

const FULL_KIND_LIST = 'embedding-backfill,drawer-backfill,consolidation,synthesis' as const;

function makeReadyDeps(): MemoryOpsRolloutPreflightDeps {
  return {
    inspectDatabase: async () => ({
      reachable: true,
      requiredTables: {
        api_accounts: true,
        memory_ops_jobs: true,
        memory_ops_job_events: true,
        memory_ops_audit: true,
      },
      activeProvider: {
        id: '11111111-1111-4111-8111-111111111111',
        provider: 'openai',
        model: 'text-embedding-3-small',
        lastTestOk: true,
        lastTestedAt: '2026-04-25T00:00:00.000Z',
        dim: 1536,
      },
      embeddingProviderCount: 1,
    }),
    inspectRedis: async () => ({
      reachable: true,
      ping: 'PONG',
    }),
    inspectPath: () => ({
      exists: true,
      isDirectory: true,
    }),
  };
}

function makeBaseEnv(drawerRoot: string): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgresql://agentctl:agentctl@localhost:5432/agentctl',
    REDIS_URL: 'redis://localhost:6379/0',
    CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
    MEMORY_OPS_SIGNING_SECRET: 's'.repeat(40),
    MEMORY_OPS_ENABLED: 'false',
    MEMORY_OPS_ENABLED_KINDS: FULL_KIND_LIST,
    MEMORY_OPS_DRAWER_SOURCE_ROOTS: drawerRoot,
  };
}

let tmpDir = '';

afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  }
});

describe('memory ops rollout preflight CLI', () => {
  it('parses target, env-file, and json flags', () => {
    expect(parseArgs(['--target', 'dev-1', '--env-file', '.env.dev-1', '--json'])).toEqual({
      target: 'dev-1',
      envFile: path.resolve('.env.dev-1'),
      json: true,
    });

    expect(parseArgs([])).toEqual({
      target: 'live',
      envFile: undefined,
      json: false,
    });
  });

  it('loads an env file safely and lets explicit file values win over the shell', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-ops-preflight-env-'));
    const envFile = path.join(tmpDir, '.env.dev-1');
    fs.writeFileSync(
      envFile,
      [
        'MEMORY_OPS_ENABLED=false',
        `MEMORY_OPS_ENABLED_KINDS=${FULL_KIND_LIST}`,
        'MEMORY_OPS_SIGNING_SECRET=file-secret-value',
      ].join('\n'),
      'utf8',
    );

    const resolved = resolveMemoryOpsRolloutPreflightEnv(
      { target: 'live', envFile, json: false },
      {
        MEMORY_OPS_ENABLED: 'true',
        GATE2_GEMINI_API_KEY: 'shell-only-gate2-key',
      },
    );

    expect(resolved.MEMORY_OPS_ENABLED).toBe('false');
    expect(resolved.MEMORY_OPS_ENABLED_KINDS).toBe(FULL_KIND_LIST);
    expect(resolved.MEMORY_OPS_SIGNING_SECRET).toBe('file-secret-value');
    expect(resolved.GATE2_GEMINI_API_KEY).toBe('shell-only-gate2-key');
  });

  it('reports a ready-to-enable rollout without printing secret values', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-ops-preflight-ready-'));
    const drawerRoot = path.join(tmpDir, 'drawers');
    fs.mkdirSync(drawerRoot, { recursive: true });

    const env = makeBaseEnv(drawerRoot);
    const report = await buildMemoryOpsRolloutPreflightReport(
      {
        target: 'live',
        json: false,
        envFile: undefined,
        env,
      },
      makeReadyDeps(),
    );

    expect(report.ok).toBe(true);
    expect(report.readyToEnable).toBe(true);
    expect(report.rollout.enabled).toBe(false);
    expect(report.rollout.enabledKinds).toEqual([
      'embedding-backfill',
      'drawer-backfill',
      'consolidation',
      'synthesis',
    ]);
    expect(report.checks.find((check) => check.id === 'rollout-flags')?.status).toBe('warn');
    expect(report.checks.find((check) => check.id === 'database')?.status).toBe('pass');
    expect(report.checks.find((check) => check.id === 'redis')?.status).toBe('pass');
    expect(report.checks.find((check) => check.id === 'provider')?.status).toBe('pass');
    expect(report.checks.find((check) => check.id === 'gemini-gate2')?.status).toBe('warn');

    const rendered = formatMemoryOpsRolloutPreflightReport(report);
    expect(rendered).toContain('Memory Operations rollout preflight (live)');
    expect(rendered).toContain('Ready to enable: yes');
    expect(rendered).toContain('Current rollout: disabled');
    expect(rendered).not.toContain(env.MEMORY_OPS_SIGNING_SECRET as string);
    expect(rendered).not.toContain(env.CREDENTIAL_ENCRYPTION_KEY as string);
  });

  it('fails when live rollout flags are partially enabled', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-ops-preflight-flags-'));
    const drawerRoot = path.join(tmpDir, 'drawers');
    fs.mkdirSync(drawerRoot, { recursive: true });

    const env = {
      ...makeBaseEnv(drawerRoot),
      MEMORY_OPS_ENABLED: 'true',
      MEMORY_OPS_ENABLED_KINDS: 'embedding-backfill,drawer-backfill',
    };
    const report = await buildMemoryOpsRolloutPreflightReport(
      {
        target: 'live',
        json: false,
        envFile: undefined,
        env,
      },
      makeReadyDeps(),
    );

    expect(report.ok).toBe(false);
    expect(report.readyToEnable).toBe(false);
    expect(report.checks.find((check) => check.id === 'rollout-flags')).toMatchObject({
      status: 'fail',
    });
    expect(report.checks.find((check) => check.id === 'rollout-flags')?.summary).toMatch(
      /missing target kinds/i,
    );
  });

  it('fails when no tested active embedding provider is configured', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-ops-preflight-provider-'));
    const drawerRoot = path.join(tmpDir, 'drawers');
    fs.mkdirSync(drawerRoot, { recursive: true });

    const env = makeBaseEnv(drawerRoot);
    const report = await buildMemoryOpsRolloutPreflightReport(
      {
        target: 'dev-1',
        json: false,
        envFile: undefined,
        env,
      },
      {
        ...makeReadyDeps(),
        inspectDatabase: async () => ({
          reachable: true,
          requiredTables: {
            api_accounts: true,
            memory_ops_jobs: true,
            memory_ops_job_events: true,
            memory_ops_audit: true,
          },
          activeProvider: {
            id: '11111111-1111-4111-8111-111111111111',
            provider: 'openai',
            model: 'text-embedding-3-small',
            lastTestOk: null,
            lastTestedAt: null,
            dim: null,
          },
          embeddingProviderCount: 1,
        }),
      },
    );

    expect(report.ok).toBe(false);
    expect(report.readyToEnable).toBe(false);
    expect(report.checks.find((check) => check.id === 'provider')).toMatchObject({
      status: 'fail',
    });
    expect(report.checks.find((check) => check.id === 'provider')?.summary).toMatch(
      /has not passed a provider test/i,
    );
  });
});
