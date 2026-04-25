import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  applyMemoryEvalSecretProvisioning,
  buildMemoryEvalSecretProvisioningPlan,
  formatMemoryEvalSecretProvisioningPlan,
} from './memory-eval-secrets.js';

function writePrivateFixture(rowsPerTag = 1): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-eval-secrets-fixture-'));
  const fixturePath = path.join(dir, 'private.json');
  const tags = [
    'vocabulary-gap',
    'temporal-ambiguity',
    'assistant-reference',
    'person-name-underweighting',
    'noisy-distractor-rejection',
  ];
  const rows = tags.flatMap((tag) =>
    Array.from({ length: rowsPerTag }, (_, index) => ({
      id: `${tag}-${index + 1}`,
      query: `Private query for ${tag} ${index + 1}?`,
      category: 'AgentCTL-private',
      expectedFacts: [{ id: `fact:${tag}:${index + 1}`, relevance: 3 }],
      expectedDrawerSources: [],
      redactedAnswerHints: [`Private redacted hint for ${tag}.`],
      tags: [tag],
      public: false,
    })),
  );

  fs.writeFileSync(
    fixturePath,
    `${JSON.stringify(
      {
        version: 1,
        splitSeed: 42,
        rows,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return fixturePath;
}

function writeChangelog(
  contents = '# Private Fixture Changelog\n\n## 2026-04-25\n\n- Rotated private held-out/full examples.\n',
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-eval-secrets-changelog-'));
  const changelogPath = path.join(dir, 'CHANGELOG.md');
  fs.writeFileSync(changelogPath, contents, 'utf8');
  return changelogPath;
}

describe('memory eval secret provisioning preflight', () => {
  it('summarizes fixture rotation inputs without printing secret bodies', () => {
    const plan = buildMemoryEvalSecretProvisioningPlan({
      fixturePath: writePrivateFixture(),
      fixtureChangelogPath: writeChangelog(),
      repo: 'hahaschool/agentctl',
      minimumRowsPerFailureMode: 1,
      releaseRequired: true,
    });

    const output = formatMemoryEvalSecretProvisioningPlan(plan);

    expect(output).toContain('Memory Eval Private Fixture Secret Preflight');
    expect(output).toContain('Repository: hahaschool/agentctl');
    expect(output).toContain('Fixture rows: 5');
    expect(output).toContain('Latest changelog entry: 2026-04-25');
    expect(output).toContain('MEMORY_EVAL_PRIVATE_FIXTURE_JSON_B64');
    expect(output).toContain('MEMORY_EVAL_PRIVATE_FIXTURE_CHANGELOG_B64');
    expect(output).toContain('MEMORY_EVAL_RELEASE_REQUIRED=true');
    expect(output).not.toContain(plan.fixture.encodedBase64);
    expect(output).not.toContain(plan.changelog.encodedBase64);
    expect(output).not.toContain('Private redacted hint');
  });

  it('applies fixture secrets through gh stdin rather than command arguments', () => {
    const plan = buildMemoryEvalSecretProvisioningPlan({
      fixturePath: writePrivateFixture(),
      fixtureChangelogPath: writeChangelog(),
      repo: 'hahaschool/agentctl',
      minimumRowsPerFailureMode: 1,
      releaseRequired: false,
    });
    const calls: Array<{ args: string[]; stdin: string }> = [];

    applyMemoryEvalSecretProvisioning(plan, {
      runGh(args, stdin) {
        calls.push({ args, stdin });
      },
    });

    expect(calls).toEqual([
      {
        args: [
          'secret',
          'set',
          'MEMORY_EVAL_PRIVATE_FIXTURE_JSON_B64',
          '--repo',
          'hahaschool/agentctl',
        ],
        stdin: plan.fixture.encodedBase64,
      },
      {
        args: [
          'secret',
          'set',
          'MEMORY_EVAL_PRIVATE_FIXTURE_CHANGELOG_B64',
          '--repo',
          'hahaschool/agentctl',
        ],
        stdin: plan.changelog.encodedBase64,
      },
      {
        args: [
          'variable',
          'set',
          'MEMORY_EVAL_FAILURE_MODE_MIN_ROWS',
          '--repo',
          'hahaschool/agentctl',
        ],
        stdin: '1',
      },
      {
        args: ['variable', 'set', 'MEMORY_EVAL_RELEASE_REQUIRED', '--repo', 'hahaschool/agentctl'],
        stdin: 'false',
      },
    ]);

    for (const call of calls) {
      expect(call.args).not.toContain(plan.fixture.encodedBase64);
      expect(call.args).not.toContain(plan.changelog.encodedBase64);
    }
  });

  it('fails before gh when the encoded fixture exceeds the GitHub secret size limit', () => {
    const fixturePath = writePrivateFixture(1);
    fs.appendFileSync(fixturePath, ' '.repeat(60 * 1024), 'utf8');

    expect(() =>
      buildMemoryEvalSecretProvisioningPlan({
        fixturePath,
        fixtureChangelogPath: writeChangelog(),
        repo: 'hahaschool/agentctl',
        minimumRowsPerFailureMode: 1,
      }),
    ).toThrow(/MEMORY_EVAL_PRIVATE_FIXTURE_JSON_B64|48 KiB/i);
  });
});
