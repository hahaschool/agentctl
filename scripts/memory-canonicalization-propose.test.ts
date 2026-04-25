import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  loadCanonicalAliasRecordsFromFile,
  loadProposalCandidatesFromFile,
  parseArgs,
  renderProposalReport,
} from './memory-canonicalization-propose.js';

let tmpDir: string;

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

describe('memory canonicalization proposal CLI', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-canonicalization-propose-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses file-backed dry-run options and rejects unsupported apply flags', () => {
    const inputPath = path.join(tmpDir, 'facts.jsonl');
    const aliasesPath = path.join(tmpDir, 'aliases.json');
    const outputPath = path.join(tmpDir, 'report.csv');

    expect(
      parseArgs(
        [
          '--input',
          inputPath,
          '--canonical-aliases',
          aliasesPath,
          '--write',
          outputPath,
          '--format',
          'csv',
        ],
        {},
      ),
    ).toEqual({
      inputPath,
      canonicalAliasesPath: aliasesPath,
      databaseUrl: undefined,
      outputPath,
      format: 'csv',
    });

    expect(() => parseArgs(['--input', inputPath, '--apply'], {})).toThrow(
      '--apply is not supported',
    );
    expect(() => parseArgs(['--input', inputPath, '--execute'], {})).toThrow(
      '--execute is not supported',
    );
  });

  it('loads candidate facts from JSON and JSONL files with camelCase or snake_case keys', async () => {
    const jsonPath = path.join(tmpDir, 'facts.json');
    const jsonlPath = path.join(tmpDir, 'facts.jsonl');

    writeFile(
      jsonPath,
      JSON.stringify([
        {
          factId: 'fact-1',
          scope: 'project:agentctl',
          entityType: 'person',
          entityName: 'John Smith',
          content: 'John Smith approved the rollout.',
          source: { sessionId: 'session-1', turnIndex: 1 },
        },
      ]),
    );
    writeFile(
      jsonlPath,
      [
        JSON.stringify({
          id: 'fact-2',
          scope: 'project:agentctl',
          entity_type: 'concept',
          entity_name: 'Project Atlas',
          content: 'Project Atlas remains active.',
          source_json: { import_source_id: 'import-1' },
        }),
        '',
      ].join('\n'),
    );

    await expect(loadProposalCandidatesFromFile(jsonPath)).resolves.toEqual([
      expect.objectContaining({
        factId: 'fact-1',
        entityType: 'person',
        entityName: 'John Smith',
        source: {
          sessionId: 'session-1',
          turnIndex: 1,
        },
      }),
    ]);
    await expect(loadProposalCandidatesFromFile(jsonlPath)).resolves.toEqual([
      expect.objectContaining({
        factId: 'fact-2',
        entityType: 'concept',
        entityName: 'Project Atlas',
        source: {
          importSourceId: 'import-1',
        },
      }),
    ]);
  });

  it('loads canonical aliases from JSON files and renders CSV-safe dry-run output', async () => {
    const aliasesPath = path.join(tmpDir, 'aliases.json');

    writeFile(
      aliasesPath,
      JSON.stringify({
        rows: [
          {
            canonical_id: 'person-1',
            entity_type: 'person',
            canonical_name: 'John Smith',
            alias: 'John Smith',
          },
        ],
      }),
    );

    const aliases = await loadCanonicalAliasRecordsFromFile(aliasesPath);
    expect(aliases).toEqual([
      expect.objectContaining({
        canonicalId: 'person-1',
        entityType: 'person',
        canonicalName: 'John Smith',
        normalizedCanonicalName: 'john smith',
        alias: 'John Smith',
        normalizedAlias: 'john smith',
      }),
    ]);

    const rendered = renderProposalReport(
      {
        dryRun: true,
        summary: {
          candidates: 1,
          resolved: 1,
          ambiguous: 0,
          unresolved: 0,
          proposedAliases: 0,
          exactMatches: 1,
          skippedSourceMutations: 1,
        },
        proposals: [
          {
            factId: 'fact-1',
            scope: 'project:agentctl',
            entityType: 'person',
            entityName: 'John Smith',
            normalizedEntityName: 'john smith',
            status: 'resolved',
            resolutionReason: 'person_exact',
            proposalAction: 'none',
            canonicalId: 'person-1',
            canonicalName: 'John Smith',
            proposedAlias: null,
            aliasAlreadyExists: true,
            matchedCanonicalIds: ['person-1'],
            matchedCanonicalNames: ['John Smith'],
            contentPreview: '=SUM(1)',
            reviewSource: {
              scope: 'project:agentctl',
              sessionId: 'session-1',
              agentId: null,
              machineId: null,
              turnIndex: 1,
              importSourceId: null,
              importJobId: null,
            },
          },
        ],
      },
      'csv',
    );

    expect(rendered).toContain('factId,scope,entityType,entityName');
    expect(rendered).toContain('fact-1,project:agentctl,person,John Smith');
    expect(rendered).toContain(",'=SUM(1)");
    expect(rendered).not.toContain(',=SUM(1)');
    expect(rendered).not.toContain('[object Object]');
  });
});
