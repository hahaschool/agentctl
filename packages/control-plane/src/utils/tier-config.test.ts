import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearTierConfigCache, isValidSourceTier, loadTierConfigs } from './tier-config.js';

// ── Test fixtures ──────────────────────────────────────────────

const ENV_DEV1 = `
TIER=dev-1
PORT=8081
WORKER_PORT=9001
WEB_PORT=5174
DATABASE_URL=postgresql://user@localhost:5433/agentctl_dev1
REDIS_URL=redis://localhost:6379/1
API_KEY=secret-should-be-filtered
`;

const ENV_DEV2 = `
TIER=dev-2
PORT=8082
WORKER_PORT=9002
WEB_PORT=5175
DATABASE_URL=postgresql://user@localhost:5433/agentctl_dev2
REDIS_URL=redis://localhost:6379/2
`;

const ENV_BETA = `
TIER=beta
PORT=8080
WORKER_PORT=9000
WEB_PORT=5173
DATABASE_URL=postgresql://user@localhost:5433/agentctl_beta
REDIS_URL=redis://localhost:6379/0
`;

const ENV_MISSING_PORTS = `
TIER=dev-1
DATABASE_URL=postgresql://user@localhost:5433/agentctl_dev1
`;

// ── Helpers ────────────────────────────────────────────────────

let testDir: string;

function writeEnv(filename: string, content: string): void {
  writeFileSync(join(testDir, filename), content, 'utf-8');
}

// ── Tests ──────────────────────────────────────────────────────

describe('tier-config', () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'tier-config-test-'));
    clearTierConfigCache();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('loadTierConfigs', () => {
    it('returns empty array when no .env files exist', () => {
      const configs = loadTierConfigs(testDir);
      expect(configs).toEqual([]);
    });

    it('parses a single dev-1 env file', () => {
      writeEnv('.env.dev-1', ENV_DEV1);

      const configs = loadTierConfigs(testDir);

      expect(configs).toHaveLength(1);
      expect(configs[0]).toEqual({
        name: 'dev-1',
        label: 'Dev 1',
        cpPort: 8081,
        workerPort: 9001,
        webPort: 5174,
        database: 'agentctl_dev1',
        redisDb: 1,
      });
    });

    it('parses all three tier files when present', () => {
      writeEnv('.env.dev-1', ENV_DEV1);
      writeEnv('.env.dev-2', ENV_DEV2);
      writeEnv('.env.beta', ENV_BETA);

      const configs = loadTierConfigs(testDir);

      expect(configs).toHaveLength(3);
      const names = configs.map((c) => c.name);
      expect(names).toContain('dev-1');
      expect(names).toContain('dev-2');
      expect(names).toContain('beta');
    });

    it('skips env files with missing required port fields', () => {
      writeEnv('.env.dev-1', ENV_MISSING_PORTS);

      const configs = loadTierConfigs(testDir);

      expect(configs).toHaveLength(0);
    });

    it('correctly extracts database name from PostgreSQL URL', () => {
      writeEnv('.env.beta', ENV_BETA);

      const configs = loadTierConfigs(testDir);

      expect(configs[0].database).toBe('agentctl_beta');
    });

    it('correctly extracts Redis DB number from URL', () => {
      writeEnv('.env.dev-2', ENV_DEV2);

      const configs = loadTierConfigs(testDir);

      expect(configs[0].redisDb).toBe(2);
    });

    it('defaults Redis DB to 0 when path is empty', () => {
      const envNoRedisDb = `
TIER=dev-1
PORT=8081
WORKER_PORT=9001
WEB_PORT=5174
DATABASE_URL=postgresql://user@localhost:5433/mydb
REDIS_URL=redis://localhost:6379
`;
      writeEnv('.env.dev-1', envNoRedisDb);

      const configs = loadTierConfigs(testDir);

      expect(configs[0].redisDb).toBe(0);
    });

    it('returns cached results on subsequent calls with same repoRoot', () => {
      writeEnv('.env.dev-1', ENV_DEV1);

      const first = loadTierConfigs(testDir);
      // Delete the file — cache should still work
      rmSync(join(testDir, '.env.dev-1'));
      const second = loadTierConfigs(testDir);

      expect(first).toBe(second);
    });

    it('returns fresh results after clearTierConfigCache()', () => {
      writeEnv('.env.dev-1', ENV_DEV1);
      const first = loadTierConfigs(testDir);
      expect(first).toHaveLength(1);

      clearTierConfigCache();
      rmSync(join(testDir, '.env.dev-1'));
      const second = loadTierConfigs(testDir);

      expect(second).toHaveLength(0);
    });

    it('returns frozen (immutable) config arrays', () => {
      writeEnv('.env.dev-1', ENV_DEV1);

      const configs = loadTierConfigs(testDir);

      expect(Object.isFrozen(configs)).toBe(true);
    });
  });

  describe('isValidSourceTier', () => {
    it('returns true for a valid dev tier present in configs', () => {
      writeEnv('.env.dev-1', ENV_DEV1);
      const configs = loadTierConfigs(testDir);

      expect(isValidSourceTier('dev-1', configs)).toBe(true);
    });

    it('returns false for beta tier (target, not source)', () => {
      writeEnv('.env.beta', ENV_BETA);
      const configs = loadTierConfigs(testDir);

      expect(isValidSourceTier('beta', configs)).toBe(false);
    });

    it('returns false for dev tier not present in configs', () => {
      writeEnv('.env.dev-1', ENV_DEV1);
      const configs = loadTierConfigs(testDir);

      expect(isValidSourceTier('dev-3', configs)).toBe(false);
    });

    it('returns false for empty string', () => {
      const configs = loadTierConfigs(testDir);
      expect(isValidSourceTier('', configs)).toBe(false);
    });

    it('returns false for invalid format (no dash number)', () => {
      writeEnv('.env.dev-1', ENV_DEV1);
      const configs = loadTierConfigs(testDir);

      expect(isValidSourceTier('dev', configs)).toBe(false);
      expect(isValidSourceTier('dev-', configs)).toBe(false);
      expect(isValidSourceTier('production', configs)).toBe(false);
    });

    it('accepts dev-N format where N > 2', () => {
      // isValidSourceTier checks format AND config presence
      // dev-99 matches format but not in configs
      const configs = loadTierConfigs(testDir);
      expect(isValidSourceTier('dev-99', configs)).toBe(false);
    });
  });
});
