import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function writeExecutable(filePath: string, content: string): void {
  writeFileSync(filePath, content);
  chmodSync(filePath, 0o755);
}

describe('env-up.sh', () => {
  it('starts a dev tier with the portable lock fallback and WEB_PORT-aware web command', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'agentctl-env-up-'));
    const lockRoot = mkdtempSync(path.join(tmpdir(), 'agentctl-locks-'));
    const binDir = path.join(repoRoot, 'bin');
    const pnpmLog = path.join(repoRoot, 'pnpm.log');

    try {
      mkdirSync(path.join(repoRoot, 'scripts'), { recursive: true });
      mkdirSync(path.join(repoRoot, 'packages', 'control-plane'), { recursive: true });
      mkdirSync(binDir, { recursive: true });

      const scriptPath = path.join(repoRoot, 'scripts', 'env-up.sh');
      copyFileSync(path.join(__dirname, 'env-up.sh'), scriptPath);
      chmodSync(scriptPath, 0o755);

      writeFileSync(
        path.join(repoRoot, '.env.dev-test'),
        [
          'TIER=dev-test',
          'PORT=18180',
          'WORKER_PORT=19100',
          'WEB_PORT=15573',
          'DATABASE_URL=postgresql://dev@127.0.0.1:5433/agentctl_dev_test',
          'REDIS_URL=redis://localhost:6379/9',
          'CONTROL_PLANE_URL=http://localhost:18180',
          'CONTROL_URL=http://localhost:18180',
          'NEXT_PUBLIC_API_URL=http://localhost:18180',
          '',
        ].join('\n'),
      );

      writeExecutable(path.join(binDir, 'lsof'), ['#!/usr/bin/env bash', 'exit 1', ''].join('\n'));
      writeExecutable(
        path.join(binDir, 'pnpm'),
        [
          '#!/usr/bin/env bash',
          'printf "cwd=%s|skip=%s|web=%s|args=%s\\n" "$PWD" "$' +
            '{SKIP_MIGRATIONS:-}" "$' +
            '{WEB_PORT:-}" "$*" >> "$PNPM_LOG"',
          'exit 0',
          '',
        ].join('\n'),
      );

      const staleLockDir = path.join(lockRoot, 'dev-test.lock.d');
      mkdirSync(staleLockDir);
      writeFileSync(path.join(lockRoot, 'dev-test.lock'), 'pid=999999\ntier=dev-test\n');

      const output = execFileSync('bash', [scriptPath, 'dev-test'], {
        cwd: repoRoot,
        env: {
          ...process.env,
          AGENTCTL_FORCE_PORTABLE_LOCK: '1',
          LOCK_DIR_OVERRIDE: lockRoot,
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
          PNPM_LOG: pnpmLog,
        },
        encoding: 'utf8',
      });

      const pnpmCalls = readFileSync(pnpmLog, 'utf8');
      expect(output).toContain('Warning: removing stale tier lock for dev-test.');
      expect(output).toContain('Web:    http://localhost:15573');
      expect(pnpmCalls).toContain('args=drizzle-kit migrate');
      expect(pnpmCalls).toContain('skip=true|web=15573|args=--filter @agentctl/control-plane dev');
      expect(pnpmCalls).toContain('web=15573|args=--filter @agentctl/agent-worker dev');
      expect(pnpmCalls).toContain('web=15573|args=--filter @agentctl/web dev');
      expect(pnpmCalls).not.toContain('-- --port');
      expect(existsSync(path.join(lockRoot, 'dev-test.lock'))).toBe(false);
      expect(existsSync(staleLockDir)).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(lockRoot, { recursive: true, force: true });
    }
  });
});
