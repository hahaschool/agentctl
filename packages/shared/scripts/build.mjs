import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(__dirname, '..');
const lockDir = resolve(packageDir, '.build-lock');
const distDir = resolve(packageDir, 'dist');
const tempSuffix = `${process.pid}-${Date.now()}`;
const tempDistDir = resolve(packageDir, `.dist-tmp-${tempSuffix}`);
const tempTsBuildInfoFile = resolve(packageDir, `.tsbuildinfo.${tempSuffix}`);

try {
  rmSync(tempDistDir, { recursive: true, force: true });
  rmSync(tempTsBuildInfoFile, { recursive: true, force: true });

  const result = spawnSync(
    'tsc',
    ['--project', 'tsconfig.json', '--outDir', tempDistDir, '--tsBuildInfoFile', tempTsBuildInfoFile],
    {
    cwd: packageDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  acquireBuildLock(lockDir);
  try {
    syncDir(tempDistDir, distDir);
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
} finally {
  rmSync(tempDistDir, { recursive: true, force: true });
  rmSync(tempTsBuildInfoFile, { recursive: true, force: true });
}

function acquireBuildLock(lockPath) {
  const startedAt = Date.now();

  while (true) {
    try {
      mkdirSync(lockPath);
      writeFileSync(resolve(lockPath, 'owner'), String(process.pid));
      return;
    } catch (error) {
      if (!isLockHeldError(error)) {
        throw error;
      }

      pruneStaleLock(lockPath);

      if (Date.now() - startedAt > 60_000) {
        throw new Error(`Timed out waiting for build lock at ${lockPath}`);
      }

      sleep(100);
    }
  }
}

function pruneStaleLock(lockPath) {
  try {
    const ageMs = Date.now() - statSync(lockPath).mtimeMs;
    if (ageMs > 300_000) {
      rmSync(lockPath, { recursive: true, force: true });
    }
  } catch {
    // Another process may have released the lock while we checked it.
  }
}

function isLockHeldError(error) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EEXIST'
  );
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function syncDir(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });

  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = resolve(sourceDir, entry.name);
    const targetPath = resolve(targetDir, entry.name);

    if (entry.isDirectory()) {
      syncDir(sourcePath, targetPath);
      continue;
    }

    copyFileSync(sourcePath, targetPath);
  }
}
