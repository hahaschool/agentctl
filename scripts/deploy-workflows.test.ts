import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

async function readWorkflow(fileName: string): Promise<string> {
  return readFile(new URL(`../.github/workflows/${fileName}`, import.meta.url), 'utf-8');
}

function migrationBlocks(workflow: string): string[] {
  return workflow
    .split('      - name: Run database migrations')
    .slice(1)
    .map((section) => section.split('      # ── Deploy')[0] ?? section);
}

function expectRemoteMigrationPasswordForwarding(block: string): void {
  const dollar = '$';

  expect(block).toContain(
    'POSTGRES_PASSWORD_B64="$(printf \'%s\' "$POSTGRES_PASSWORD" | base64 | tr -d \'\\n\')"',
  );
  expect(block).toContain('<< REMOTE_SCRIPT');
  expect(block).not.toContain("<< 'REMOTE_SCRIPT'");
  expect(block).toContain(
    'POSTGRES_PASSWORD="\\$(printf \'%s\' "$POSTGRES_PASSWORD_B64" | base64 -d)"',
  );
  expect(block).toContain('export POSTGRES_PASSWORD');
  expect(block).toContain(
    `: "\\${dollar}{POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required for DB migrations}"`,
  );
  expect(block).toContain(
    `-e DATABASE_URL="postgresql://\\${dollar}{POSTGRES_USER:-agentctl}:\\${dollar}{POSTGRES_PASSWORD}@agentctl-postgres-prod:5432/\\${dollar}{POSTGRES_DB:-agentctl}"`,
  );
}

describe('deployment workflow migration secret forwarding', () => {
  it('forwards POSTGRES_PASSWORD into remote dev and production migration shells', async () => {
    for (const fileName of ['deploy-dev.yml', 'deploy-prod.yml']) {
      const blocks = migrationBlocks(await readWorkflow(fileName));

      expect(blocks).toHaveLength(1);
      for (const block of blocks) {
        expectRemoteMigrationPasswordForwarding(block);
      }
    }
  });

  it('forwards POSTGRES_PASSWORD into both fleet migration phases', async () => {
    const blocks = migrationBlocks(await readWorkflow('deploy-fleet.yml'));

    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expectRemoteMigrationPasswordForwarding(block);
    }
  });
});
