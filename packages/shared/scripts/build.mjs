import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(__dirname, '..');

for (const relativePath of ['dist', '.tsbuildinfo']) {
  rmSync(resolve(packageDir, relativePath), { recursive: true, force: true });
}

const result = spawnSync('tsc', ['--project', 'tsconfig.json'], {
  cwd: packageDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
