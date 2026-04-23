import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildUnifiedDiff,
  encodeClaudeProjectPath,
  formatMemoryMdDryRun,
  generateMemoryMdDryRun,
  parseArgs,
  type ReviewableMemoryFact,
  resolveClaudeMemoryPath,
  runGenerateMemoryMdDryRun,
  runGenerateMemoryMdDryRunFromSource,
} from './generate-memory-md.js';

function createFact(overrides: Partial<ReviewableMemoryFact> = {}): ReviewableMemoryFact {
  return {
    id: overrides.id ?? 'fact-1',
    scope: overrides.scope ?? 'project:agentctl',
    content: overrides.content ?? 'Use Biome for formatting and linting.',
    content_model: overrides.content_model ?? 'text-embedding-3-small',
    entity_type: overrides.entity_type ?? 'decision',
    confidence: overrides.confidence ?? 0.9,
    strength: overrides.strength ?? 0.8,
    source:
      overrides.source ??
      ({
        session_id: null,
        agent_id: null,
        machine_id: null,
        turn_index: null,
        extraction_method: 'manual',
      } as ReviewableMemoryFact['source']),
    valid_from: overrides.valid_from ?? '2026-04-22T00:00:00.000Z',
    valid_until: overrides.valid_until ?? null,
    created_at: overrides.created_at ?? '2026-04-22T00:00:00.000Z',
    accessed_at: overrides.accessed_at ?? '2026-04-22T00:00:00.000Z',
    tags: overrides.tags ?? [],
    usage_count: overrides.usage_count ?? 0,
    pinned: overrides.pinned ?? false,
    reviewed: overrides.reviewed,
    metadata: overrides.metadata,
  };
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

describe('parseArgs', () => {
  it('derives the default project scope from the project basename', () => {
    const result = parseArgs([
      '--project-path',
      '/Users/test/workspaces/agentctl',
      '--facts-json',
      '/tmp/facts.json',
    ]);

    expect(result.projectPath).toBe('/Users/test/workspaces/agentctl');
    expect(result.factsJsonPath).toBe('/tmp/facts.json');
    expect(result.scope).toBe('project:agentctl');
    expect(result.assumeInputReviewed).toBe(false);
    expect(result.maxFacts).toBe(8);
    expect(result.maxFactChars).toBe(140);
  });

  it('accepts a control-plane API source instead of a JSON file', () => {
    const result = parseArgs([
      '--project-path',
      '/repo/agentctl',
      '--control-plane-url',
      'http://127.0.0.1:4111',
      '--api-token',
      'token-123',
      '--api-fetch-limit',
      '25',
      '--facts-fetch-timeout-ms',
      '1500',
    ]);

    expect(result.factsJsonPath).toBeUndefined();
    expect(result.controlPlaneUrl).toBe('http://127.0.0.1:4111');
    expect(result.apiToken).toBe('token-123');
    expect(result.factsFetchLimit).toBe(25);
    expect(result.factsFetchTimeoutMs).toBe(1500);
  });

  it('requires exactly one fact source', () => {
    expect(() =>
      parseArgs(['--project-path', '/repo/agentctl', '--facts-json', '/tmp/facts.json']),
    ).not.toThrow();
    expect(() =>
      parseArgs(['--project-path', '/repo/agentctl', '--control-plane-url', 'http://localhost']),
    ).not.toThrow();
    expect(() => parseArgs(['--project-path', '/repo/agentctl'])).toThrow(/exactly one/i);
    expect(() =>
      parseArgs([
        '--project-path',
        '/repo/agentctl',
        '--facts-json',
        '/tmp/facts.json',
        '--control-plane-url',
        'http://localhost',
      ]),
    ).toThrow(/exactly one/i);
  });

  it('accepts explicit scope and bounded integer overrides', () => {
    const result = parseArgs([
      '--project-path',
      '/repo/agentctl',
      '--facts-json',
      '/tmp/facts.json',
      '--scope',
      'global',
      '--claude-projects-dir',
      '/tmp/claude-projects',
      '--assume-input-reviewed',
      '--max-facts',
      '4',
      '--max-fact-chars',
      '80',
      '--json',
    ]);

    expect(result.scope).toBe('global');
    expect(result.claudeProjectsDir).toBe('/tmp/claude-projects');
    expect(result.assumeInputReviewed).toBe(true);
    expect(result.maxFacts).toBe(4);
    expect(result.maxFactChars).toBe(80);
    expect(result.json).toBe(true);
  });
});

describe('generateMemoryMdDryRun', () => {
  it('selects only explicitly reviewed facts by default, sorts them, truncates them, and dedupes duplicates', () => {
    const result = generateMemoryMdDryRun(
      [
        createFact({
          id: 'fact-low',
          content: 'Use pnpm for workspace commands.',
          entity_type: 'pattern',
          confidence: 0.7,
          reviewed: true,
        }),
        createFact({
          id: 'fact-top',
          content:
            'Use Biome for formatting and linting across the repo because split tools caused repeated drift in pull requests.',
          entity_type: 'decision',
          confidence: 0.95,
          tags: ['reviewed'],
        }),
        createFact({
          id: 'fact-duplicate',
          content: 'Use pnpm for workspace commands.',
          entity_type: 'question',
          confidence: 0.2,
          reviewed: true,
        }),
        createFact({
          id: 'fact-unreviewed',
          content: 'Investigate a future MCP rewrite.',
          reviewed: false,
        }),
        createFact({
          id: 'fact-other-scope',
          scope: 'project:other',
          content: 'Other project fact.',
          reviewed: true,
        }),
      ],
      {
        projectPath: '/Users/test/agentctl',
        claudeProjectsDir: '/tmp/claude-projects',
        scope: 'project:agentctl',
        assumeInputReviewed: false,
        maxFacts: 3,
        maxFactChars: 60,
      },
    );

    expect(result.scopedFacts).toBe(4);
    expect(result.reviewedFacts).toBe(3);
    expect(result.selectedFacts.map((fact) => fact.id)).toEqual(['fact-top', 'fact-low']);
    expect(result.proposedContent).toContain(
      'Use Biome for formatting and linting across the repo...',
    );
    expect(result.proposedContent).toContain('Use pnpm for workspace commands.');
    expect(result.proposedContent).not.toContain('Investigate a future MCP rewrite.');
    expect(result.reviewMode).toBe('explicit-markers');
  });

  it('appends the generated block after manual MEMORY content when markers are absent', () => {
    const result = generateMemoryMdDryRun([createFact({ reviewed: true })], {
      projectPath: '/Users/test/agentctl',
      claudeProjectsDir: '/tmp/claude-projects',
      scope: 'project:agentctl',
      assumeInputReviewed: false,
      maxFacts: 8,
      maxFactChars: 140,
      existingMemoryContent: '# Manual Notes\n\n- Keep dangerous operations gated.\n',
    });

    expect(result.proposedContent).toBe(
      '# Manual Notes\n\n- Keep dangerous operations gated.\n\n<!-- agentctl-memory-md:start -->\n## Generated Project Memory\n- Use Biome for formatting and linting.\n<!-- agentctl-memory-md:end -->\n',
    );
    expect(result.diff).toContain('+<!-- agentctl-memory-md:start -->');
    expect(result.diff).toContain(' Keep dangerous operations gated.');
  });

  it('replaces an existing generated block without touching manual lines', () => {
    const existing = [
      '# Manual Notes',
      '',
      '- Keep human-curated safety rules.',
      '',
      '<!-- agentctl-memory-md:start -->',
      '## Generated Project Memory',
      '- Old generated line.',
      '<!-- agentctl-memory-md:end -->',
      '',
      '## Tail',
      '- Keep this too.',
      '',
    ].join('\n');

    const result = generateMemoryMdDryRun(
      [createFact({ reviewed: true, content: 'Use focused script tests before broader suites.' })],
      {
        projectPath: '/Users/test/agentctl',
        claudeProjectsDir: '/tmp/claude-projects',
        scope: 'project:agentctl',
        assumeInputReviewed: false,
        maxFacts: 8,
        maxFactChars: 140,
        existingMemoryContent: existing,
      },
    );

    expect(result.proposedContent).toContain('- Keep human-curated safety rules.');
    expect(result.proposedContent).toContain('- Keep this too.');
    expect(result.proposedContent).toContain('- Use focused script tests before broader suites.');
    expect(result.proposedContent).not.toContain('- Old generated line.');
  });

  it('rejects malformed generated markers so the dry run stays explicit', () => {
    expect(() =>
      generateMemoryMdDryRun([createFact({ reviewed: true })], {
        projectPath: '/Users/test/agentctl',
        claudeProjectsDir: '/tmp/claude-projects',
        scope: 'project:agentctl',
        assumeInputReviewed: false,
        maxFacts: 8,
        maxFactChars: 140,
        existingMemoryContent:
          '# Manual Notes\n\n<!-- agentctl-memory-md:start -->\n## Generated Project Memory\n',
      }),
    ).toThrow(/incomplete generated block/i);
  });
});

describe('runGenerateMemoryMdDryRun', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'generate-memory-md-'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves Claude project memory inside the nested memory directory', () => {
    const projectPath = path.join(tmpDir, 'agentctl');
    const claudeProjectsDir = path.join(tmpDir, '.claude', 'projects');

    expect(resolveClaudeMemoryPath(projectPath, claudeProjectsDir)).toBe(
      path.join(claudeProjectsDir, encodeClaudeProjectPath(projectPath), 'memory', 'MEMORY.md'),
    );
  });

  it('loads facts from disk, resolves the Claude MEMORY path, and keeps dry-run output readable', () => {
    const projectPath = path.join(tmpDir, 'agentctl');
    const claudeProjectsDir = path.join(tmpDir, '.claude', 'projects');
    const factsJsonPath = path.join(tmpDir, 'facts.json');
    const memoryPath = resolveClaudeMemoryPath(projectPath, claudeProjectsDir);

    fs.mkdirSync(projectPath, { recursive: true });
    writeJson(factsJsonPath, {
      facts: [
        createFact({
          id: 'fact-a',
          content: 'Biome is the formatter and lint baseline for touched files.',
          scope: 'project:agentctl',
          metadata: { reviewed: true },
        }),
        createFact({
          id: 'fact-b',
          content: 'This fact is unreviewed and should stay out by default.',
          scope: 'project:agentctl',
        }),
      ],
    });

    fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
    fs.writeFileSync(memoryPath, '# Existing Memory\n', 'utf8');

    const result = runGenerateMemoryMdDryRun({
      projectPath,
      factsJsonPath,
      claudeProjectsDir,
      scope: 'project:agentctl',
      assumeInputReviewed: false,
      maxFacts: 8,
      maxFactChars: 90,
      factsFetchLimit: 500,
      factsFetchTimeoutMs: 10_000,
      json: false,
    });

    expect(result.memoryPath).toBe(memoryPath);
    expect(result.existingMemoryExists).toBe(true);
    expect(result.selectedFacts.map((fact) => fact.id)).toEqual(['fact-a']);
    expect(result.diff).toContain(memoryPath);
    expect(formatMemoryMdDryRun(result)).toContain('# MEMORY.md Dry Run');
    expect(formatMemoryMdDryRun(result)).toContain(
      'Biome is the formatter and lint baseline for touched files.',
    );
  });

  it('fetches scoped facts from the control-plane API source for dry-run selection', async () => {
    const projectPath = path.join(tmpDir, 'agentctl');
    const claudeProjectsDir = path.join(tmpDir, '.claude', 'projects');
    const reviewedFact = createFact({
      id: 'api-fact',
      content: 'Surface A can source reviewed facts from the control-plane memory API.',
      scope: 'project:agentctl',
      tags: ['surface-a-reviewed'],
    });
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true, facts: [reviewedFact] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await runGenerateMemoryMdDryRunFromSource({
      projectPath,
      controlPlaneUrl: 'http://127.0.0.1:4111',
      claudeProjectsDir,
      scope: 'project:agentctl',
      assumeInputReviewed: false,
      maxFacts: 8,
      maxFactChars: 120,
      factsFetchLimit: 25,
      factsFetchTimeoutMs: 1500,
      json: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestedUrl.href).toBe(
      'http://127.0.0.1:4111/api/memory/facts?scope=project%3Aagentctl&limit=25&offset=0',
    );
    expect(result.selectedFacts.map((fact) => fact.id)).toEqual(['api-fact']);
    expect(result.proposedContent).toContain(
      'Surface A can source reviewed facts from the control-plane memory API.',
    );
  });

  it('paginates control-plane facts up to the API fetch limit and sends an optional bearer token', async () => {
    const projectPath = path.join(tmpDir, 'agentctl');
    const claudeProjectsDir = path.join(tmpDir, '.claude', 'projects');
    const firstPageFacts = Array.from({ length: 500 }, (_, index) =>
      createFact({
        id: `api-fact-${String(index + 1).padStart(3, '0')}`,
        content: `Reviewed API fact ${index + 1}.`,
        tags: ['reviewed'],
      }),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            facts: firstPageFacts,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            facts: [
              createFact({
                id: 'api-fact-3',
                content: 'Third API fact arrives on the second page.',
                tags: ['reviewed'],
              }),
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await runGenerateMemoryMdDryRunFromSource({
      projectPath,
      controlPlaneUrl: 'http://127.0.0.1:4111',
      apiToken: 'token-123',
      claudeProjectsDir,
      scope: 'project:agentctl',
      assumeInputReviewed: false,
      maxFacts: 3,
      maxFactChars: 120,
      factsFetchLimit: 501,
      factsFetchTimeoutMs: 1500,
      json: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).href).toBe(
      'http://127.0.0.1:4111/api/memory/facts?scope=project%3Aagentctl&limit=500&offset=0',
    );
    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).href).toBe(
      'http://127.0.0.1:4111/api/memory/facts?scope=project%3Aagentctl&limit=1&offset=500',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Accept: 'application/json', Authorization: 'Bearer token-123' },
    });
    expect(result.totalFacts).toBe(501);
    expect(result.selectedFacts).toHaveLength(3);
  });

  it('rejects malformed control-plane API responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true, rows: [] }), { status: 200 })),
    );

    await expect(
      runGenerateMemoryMdDryRunFromSource({
        projectPath: path.join(tmpDir, 'agentctl'),
        controlPlaneUrl: 'http://127.0.0.1:4111',
        claudeProjectsDir: path.join(tmpDir, '.claude', 'projects'),
        scope: 'project:agentctl',
        assumeInputReviewed: false,
        maxFacts: 8,
        maxFactChars: 120,
        factsFetchLimit: 25,
        factsFetchTimeoutMs: 1500,
        json: false,
      }),
    ).rejects.toThrow(/facts array/i);
  });

  it('rejects non-2xx control-plane API responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 503 })),
    );

    await expect(
      runGenerateMemoryMdDryRunFromSource({
        projectPath: path.join(tmpDir, 'agentctl'),
        controlPlaneUrl: 'http://127.0.0.1:4111',
        claudeProjectsDir: path.join(tmpDir, '.claude', 'projects'),
        scope: 'project:agentctl',
        assumeInputReviewed: false,
        maxFacts: 8,
        maxFactChars: 120,
        factsFetchLimit: 25,
        factsFetchTimeoutMs: 1500,
        json: false,
      }),
    ).rejects.toThrow(/HTTP 503/i);
  });
});

describe('buildUnifiedDiff', () => {
  it('renders an insertion against /dev/null when no MEMORY file exists yet', () => {
    const diff = buildUnifiedDiff(
      null,
      '<!-- agentctl-memory-md:start -->\n## Generated Project Memory\n<!-- agentctl-memory-md:end -->\n',
      '/tmp/MEMORY.md',
    );

    expect(diff).toContain('--- /dev/null');
    expect(diff).toContain('+++ /tmp/MEMORY.md');
    expect(diff).toContain('+<!-- agentctl-memory-md:start -->');
  });
});
