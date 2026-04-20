import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = new URL('../.github/workflows/deploy-fleet.yml', import.meta.url);

async function readWorkflow(): Promise<string> {
  return readFile(WORKFLOW_PATH, 'utf-8');
}

describe('deploy-fleet workflow safety guards', () => {
  it('passes the docker topology filter to fleet-bootstrap', async () => {
    const workflow = await readWorkflow();

    expect(workflow).toContain('--topology docker');
  });

  it('plans only docker-topology machines for deploy-fleet dry-run and canary', async () => {
    const workflow = await readWorkflow();

    expect(workflow).toContain('TOPOLOGY="docker"');
    expect(workflow).toMatch(/map\(select\(\.labels\.topology == env\(TOPOLOGY\)\)\)/);
    expect(workflow).toMatch(
      /map\(select\(\.labels\.topology == env\(TOPOLOGY\) and \.role == "agent-worker"\)\)/,
    );
    expect(workflow).toMatch(
      /map\(select\(\.labels\.topology == env\(TOPOLOGY\) and \.role == "control-plane"\)\)/,
    );
  });
});
