import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { MemoryFact, MemoryScope } from '@agentctl/shared';

export type ReviewableMemoryFact = MemoryFact & {
  reviewed?: boolean;
  metadata?: Record<string, unknown>;
};

export type GenerateMemoryMdCliOptions = {
  projectPath: string;
  factsJsonPath: string;
  claudeProjectsDir: string;
  scope: MemoryScope;
  assumeInputReviewed: boolean;
  maxFacts: number;
  maxFactChars: number;
  json: boolean;
};

export type SelectedMemoryMdFact = {
  id: string;
  scope: MemoryScope;
  entityType: MemoryFact['entity_type'];
  renderedContent: string;
};

export type MemoryMdDryRunResult = {
  dryRun: true;
  projectPath: string;
  memoryPath: string;
  scope: MemoryScope;
  reviewMode: 'explicit-markers' | 'assume-input-reviewed';
  existingMemoryExists: boolean;
  totalFacts: number;
  scopedFacts: number;
  reviewedFacts: number;
  selectedFacts: SelectedMemoryMdFact[];
  proposedContent: string;
  diff: string;
  assumptions: string[];
};

const GENERATED_BLOCK_START = '<!-- agentctl-memory-md:start -->';
const GENERATED_BLOCK_END = '<!-- agentctl-memory-md:end -->';
const DEFAULT_MAX_FACTS = 8;
const DEFAULT_MAX_FACT_CHARS = 140;
const DEFAULT_CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

const ENTITY_PRIORITY: Record<MemoryFact['entity_type'], number> = {
  decision: 0,
  principle: 1,
  preference: 2,
  skill: 3,
  pattern: 4,
  code_artifact: 5,
  concept: 6,
  error: 7,
  person: 8,
  experience: 9,
  question: 10,
};

function usage(): string {
  return `Usage: pnpm tsx scripts/generate-memory-md.ts --project-path <path> --facts-json <path> [options]

Create a bounded dry-run MEMORY.md proposal for a Claude project path without writing files.

Options:
  --project-path <path>        Absolute or relative project path to materialize.
  --facts-json <path>          JSON file containing MemoryFact rows or { facts: MemoryFact[] }.
  --scope <scope>              Memory scope to summarize. Default: project:<basename(project-path)>.
  --claude-projects-dir <dir>  Override Claude projects root. Default: ~/.claude/projects.
  --assume-input-reviewed      Treat the input file as already reviewed.
  --max-facts <count>          Max generated bullets. Default: ${DEFAULT_MAX_FACTS}.
  --max-fact-chars <count>     Max characters per generated bullet. Default: ${DEFAULT_MAX_FACT_CHARS}.
  --json                       Emit the dry-run result as JSON.
  --help, -h                   Show this help text.

Reviewed facts are explicit by default: reviewed=true, metadata.reviewed=true, source.reviewed=true,
or tags including "reviewed" / "surface-a-reviewed".`;
}

export function parseArgs(argv: readonly string[]): GenerateMemoryMdCliOptions {
  let projectPath: string | null = null;
  let factsJsonPath: string | null = null;
  let claudeProjectsDir = DEFAULT_CLAUDE_PROJECTS_DIR;
  let scope: MemoryScope | null = null;
  let assumeInputReviewed = false;
  let maxFacts = DEFAULT_MAX_FACTS;
  let maxFactChars = DEFAULT_MAX_FACT_CHARS;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }

    if (arg === '--project-path') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--project-path requires a value');
      }
      projectPath = path.resolve(value);
      index += 1;
      continue;
    }

    if (arg === '--facts-json') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--facts-json requires a value');
      }
      factsJsonPath = path.resolve(value);
      index += 1;
      continue;
    }

    if (arg === '--claude-projects-dir') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--claude-projects-dir requires a value');
      }
      claudeProjectsDir = path.resolve(value);
      index += 1;
      continue;
    }

    if (arg === '--scope') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--scope requires a value');
      }
      if (!isMemoryScope(value)) {
        throw new Error('--scope must be global, project:<id>, agent:<id>, or session:<id>');
      }
      scope = value;
      index += 1;
      continue;
    }

    if (arg === '--assume-input-reviewed') {
      assumeInputReviewed = true;
      continue;
    }

    if (arg === '--max-facts') {
      maxFacts = parsePositiveInteger(argv[index + 1], '--max-facts');
      index += 1;
      continue;
    }

    if (arg === '--max-fact-chars') {
      maxFactChars = parsePositiveInteger(argv[index + 1], '--max-fact-chars');
      index += 1;
      continue;
    }

    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg?.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!projectPath) {
    throw new Error('--project-path is required');
  }
  if (!factsJsonPath) {
    throw new Error('--facts-json is required');
  }

  return {
    projectPath,
    factsJsonPath,
    claudeProjectsDir,
    scope: scope ?? deriveDefaultScope(projectPath),
    assumeInputReviewed,
    maxFacts,
    maxFactChars,
    json,
  };
}

export function extractProjectName(projectPath: string): string {
  let end = projectPath.length;
  while (end > 0 && projectPath[end - 1] === path.sep) {
    end -= 1;
  }

  const trimmed = projectPath.slice(0, end);
  const lastSlash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
}

export function deriveDefaultScope(projectPath: string): MemoryScope {
  const projectName = extractProjectName(projectPath);
  if (!projectName) {
    throw new Error('Could not derive a default project scope from --project-path');
  }
  return `project:${projectName}`;
}

export function encodeClaudeProjectPath(projectPath: string): string {
  return path.resolve(projectPath).replace(/[\\/]/g, '-');
}

export function resolveClaudeMemoryPath(
  projectPath: string,
  claudeProjectsDir: string = DEFAULT_CLAUDE_PROJECTS_DIR,
): string {
  return path.join(
    path.resolve(claudeProjectsDir),
    encodeClaudeProjectPath(projectPath),
    'MEMORY.md',
  );
}

export function loadFactsJson(filePath: string): ReviewableMemoryFact[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;

  if (Array.isArray(parsed)) {
    return parsed as ReviewableMemoryFact[];
  }

  if (isRecord(parsed) && Array.isArray(parsed.facts)) {
    return parsed.facts as ReviewableMemoryFact[];
  }

  throw new Error('--facts-json must contain a JSON array or an object with a facts array');
}

export function selectReviewedFacts(input: {
  facts: readonly ReviewableMemoryFact[];
  scope: MemoryScope;
  assumeInputReviewed: boolean;
  maxFacts: number;
  maxFactChars: number;
}): {
  scopedFacts: number;
  reviewedFacts: number;
  selectedFacts: SelectedMemoryMdFact[];
} {
  const scopedFacts = input.facts.filter((fact) => fact.scope === input.scope);
  const reviewedFacts = scopedFacts.filter((fact) =>
    isReviewedFact(fact, input.assumeInputReviewed),
  );
  const selectedFacts: SelectedMemoryMdFact[] = [];
  const seenContent = new Set<string>();

  for (const fact of [...reviewedFacts].sort(compareFacts)) {
    const normalized = normalizeFactContent(fact.content);
    if (!normalized) {
      continue;
    }

    const dedupeKey = normalized.toLowerCase();
    if (seenContent.has(dedupeKey)) {
      continue;
    }
    seenContent.add(dedupeKey);

    selectedFacts.push({
      id: fact.id,
      scope: fact.scope,
      entityType: fact.entity_type,
      renderedContent: truncateAtWordBoundary(normalized, input.maxFactChars),
    });

    if (selectedFacts.length >= input.maxFacts) {
      break;
    }
  }

  return {
    scopedFacts: scopedFacts.length,
    reviewedFacts: reviewedFacts.length,
    selectedFacts,
  };
}

export function renderGeneratedMemoryBlock(facts: readonly SelectedMemoryMdFact[]): string {
  const lines = [GENERATED_BLOCK_START, '## Generated Project Memory'];

  if (facts.length === 0) {
    lines.push('- No reviewed facts matched the selected scope yet.');
  } else {
    for (const fact of facts) {
      lines.push(`- ${fact.renderedContent}`);
    }
  }

  lines.push(GENERATED_BLOCK_END);
  return lines.join('\n');
}

export function mergeMemoryContent(
  existingContent: string | null | undefined,
  generatedBlock: string,
): string {
  const existing = normalizeNewlines(existingContent ?? '');
  const hasStart = existing.includes(GENERATED_BLOCK_START);
  const hasEnd = existing.includes(GENERATED_BLOCK_END);

  if (hasStart !== hasEnd) {
    throw new Error(
      'Existing MEMORY.md has an incomplete generated block; reconcile the markers manually before regenerating.',
    );
  }

  if (!hasStart || !hasEnd) {
    return joinSections(stripOuterBlankLines(existing), generatedBlock);
  }

  const startIndex = existing.indexOf(GENERATED_BLOCK_START);
  const endIndex = existing.indexOf(GENERATED_BLOCK_END);
  if (startIndex > endIndex) {
    throw new Error(
      'Existing MEMORY.md has malformed generated block markers; reconcile them manually before regenerating.',
    );
  }

  const lineAfterEnd = existing.indexOf('\n', endIndex + GENERATED_BLOCK_END.length);
  const prefix = existing.slice(0, startIndex);
  const suffix = lineAfterEnd >= 0 ? existing.slice(lineAfterEnd + 1) : '';
  return joinSections(stripOuterBlankLines(prefix), generatedBlock, stripOuterBlankLines(suffix));
}

export function buildUnifiedDiff(
  previousContent: string | null | undefined,
  nextContent: string,
  memoryPath: string,
): string {
  const before = normalizeNewlines(previousContent ?? '');
  const after = normalizeNewlines(nextContent);

  if (before === after) {
    return '';
  }

  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);

  let prefixLength = 0;
  while (
    prefixLength < beforeLines.length &&
    prefixLength < afterLines.length &&
    beforeLines[prefixLength] === afterLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < beforeLines.length - prefixLength &&
    suffixLength < afterLines.length - prefixLength &&
    beforeLines[beforeLines.length - 1 - suffixLength] ===
      afterLines[afterLines.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const deleted = beforeLines.slice(prefixLength, beforeLines.length - suffixLength);
  const added = afterLines.slice(prefixLength, afterLines.length - suffixLength);
  const contextBefore = beforeLines.slice(0, prefixLength);
  const contextAfter = beforeLines.slice(beforeLines.length - suffixLength);

  const diffLines = [
    `--- ${beforeLines.length === 0 ? '/dev/null' : memoryPath}`,
    `+++ ${memoryPath}`,
    `@@ -${beforeLines.length === 0 ? 0 : 1},${beforeLines.length} +${afterLines.length === 0 ? 0 : 1},${afterLines.length} @@`,
    ...contextBefore.map((line) => ` ${line}`),
    ...deleted.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
    ...contextAfter.map((line) => ` ${line}`),
  ];

  return `${diffLines.join('\n')}\n`;
}

export function generateMemoryMdDryRun(
  facts: readonly ReviewableMemoryFact[],
  options: Omit<GenerateMemoryMdCliOptions, 'factsJsonPath' | 'json'> & {
    existingMemoryContent?: string | null;
  },
): MemoryMdDryRunResult {
  const memoryPath = resolveClaudeMemoryPath(options.projectPath, options.claudeProjectsDir);
  const existingMemoryExists = options.existingMemoryContent != null;
  const selection = selectReviewedFacts({
    facts,
    scope: options.scope,
    assumeInputReviewed: options.assumeInputReviewed,
    maxFacts: options.maxFacts,
    maxFactChars: options.maxFactChars,
  });
  const proposedContent = mergeMemoryContent(
    options.existingMemoryContent,
    renderGeneratedMemoryBlock(selection.selectedFacts),
  );

  return {
    dryRun: true,
    projectPath: options.projectPath,
    memoryPath,
    scope: options.scope,
    reviewMode: options.assumeInputReviewed ? 'assume-input-reviewed' : 'explicit-markers',
    existingMemoryExists,
    totalFacts: facts.length,
    scopedFacts: selection.scopedFacts,
    reviewedFacts: selection.reviewedFacts,
    selectedFacts: selection.selectedFacts,
    proposedContent,
    diff: buildUnifiedDiff(options.existingMemoryContent, proposedContent, memoryPath),
    assumptions: buildAssumptions(options.assumeInputReviewed, options.scope, options.projectPath),
  };
}

export function runGenerateMemoryMdDryRun(
  options: GenerateMemoryMdCliOptions,
): MemoryMdDryRunResult {
  const facts = loadFactsJson(options.factsJsonPath);
  const memoryPath = resolveClaudeMemoryPath(options.projectPath, options.claudeProjectsDir);
  const existingMemoryContent = fs.existsSync(memoryPath)
    ? fs.readFileSync(memoryPath, 'utf8')
    : null;

  return generateMemoryMdDryRun(facts, {
    projectPath: options.projectPath,
    claudeProjectsDir: options.claudeProjectsDir,
    scope: options.scope,
    assumeInputReviewed: options.assumeInputReviewed,
    maxFacts: options.maxFacts,
    maxFactChars: options.maxFactChars,
    existingMemoryContent,
  });
}

export function formatMemoryMdDryRun(result: MemoryMdDryRunResult): string {
  const lines = [
    '# MEMORY.md Dry Run',
    '',
    `Project path: ${result.projectPath}`,
    `Target path: ${result.memoryPath}`,
    `Scope: ${result.scope}`,
    `Review mode: ${result.reviewMode}`,
    `Facts considered: ${result.totalFacts}`,
    `Facts in scope: ${result.scopedFacts}`,
    `Reviewed facts in scope: ${result.reviewedFacts}`,
    `Selected facts: ${result.selectedFacts.length}`,
    '',
    'Assumptions:',
    ...result.assumptions.map((assumption) => `- ${assumption}`),
    '',
    '## Diff',
    '',
    result.diff || '(no changes)',
    '## Proposed MEMORY.md',
    '',
    result.proposedContent,
  ];

  return lines.join('\n');
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const result = runGenerateMemoryMdDryRun(options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(formatMemoryMdDryRun(result));
}

function isMemoryScope(value: string): value is MemoryScope {
  return (
    value === 'global' ||
    value.startsWith('project:') ||
    value.startsWith('agent:') ||
    value.startsWith('session:')
  );
}

function parsePositiveInteger(raw: string | undefined, flagName: string): number {
  if (!raw || !/^\d+$/.test(raw)) {
    throw new Error(`${flagName} must be a positive integer`);
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${flagName} must be a positive integer`);
  }

  return parsed;
}

function isReviewedFact(fact: ReviewableMemoryFact, assumeInputReviewed: boolean): boolean {
  if (assumeInputReviewed) {
    return true;
  }

  if (fact.reviewed === true) {
    return true;
  }

  if (isRecord(fact.metadata) && fact.metadata.reviewed === true) {
    return true;
  }

  if (isRecord(fact.source) && fact.source.reviewed === true) {
    return true;
  }

  const tags = Array.isArray(fact.tags) ? fact.tags : [];
  const normalizedTags = tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);

  return normalizedTags.includes('reviewed') || normalizedTags.includes('surface-a-reviewed');
}

function compareFacts(left: ReviewableMemoryFact, right: ReviewableMemoryFact): number {
  const pinnedDiff = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned));
  if (pinnedDiff !== 0) {
    return pinnedDiff;
  }

  const entityDiff = ENTITY_PRIORITY[left.entity_type] - ENTITY_PRIORITY[right.entity_type];
  if (entityDiff !== 0) {
    return entityDiff;
  }

  const confidenceDiff = right.confidence - left.confidence;
  if (confidenceDiff !== 0) {
    return confidenceDiff;
  }

  const strengthDiff = right.strength - left.strength;
  if (strengthDiff !== 0) {
    return strengthDiff;
  }

  const usageCountDiff = (right.usage_count ?? 0) - (left.usage_count ?? 0);
  if (usageCountDiff !== 0) {
    return usageCountDiff;
  }

  const createdAtDiff = right.created_at.localeCompare(left.created_at);
  if (createdAtDiff !== 0) {
    return createdAtDiff;
  }

  return left.id.localeCompare(right.id);
}

function normalizeFactContent(content: string): string {
  return normalizeNewlines(content).replace(/\s+/g, ' ').trim();
}

function truncateAtWordBoundary(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  const clipped = value.slice(0, Math.max(1, maxChars - 3)).trimEnd();
  const splitIndex = clipped.lastIndexOf(' ');
  const safeIndex = splitIndex >= Math.floor((maxChars - 3) * 0.6) ? splitIndex : clipped.length;
  return `${clipped.slice(0, safeIndex).trimEnd()}...`;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function stripOuterBlankLines(value: string): string {
  return normalizeNewlines(value).replace(/^\n+|\n+$/g, '');
}

function joinSections(...sections: Array<string | null | undefined>): string {
  const normalized = sections
    .map((section) => stripOuterBlankLines(section ?? ''))
    .filter((section) => section.length > 0);
  return normalized.length > 0 ? `${normalized.join('\n\n')}\n` : '';
}

function splitLines(value: string): string[] {
  if (!value) {
    return [];
  }

  const lines = normalizeNewlines(value).split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}

function buildAssumptions(
  assumeInputReviewed: boolean,
  scope: MemoryScope,
  projectPath: string,
): string[] {
  const assumptions = [
    assumeInputReviewed
      ? 'The supplied facts file is treated as already reviewed because --assume-input-reviewed was set.'
      : 'Reviewed facts require explicit markers (reviewed=true, metadata.reviewed=true, source.reviewed=true, or reviewed tags).',
  ];

  if (scope === deriveDefaultScope(projectPath)) {
    assumptions.push(`Default project scope derived from the project basename: ${scope}.`);
  } else {
    assumptions.push(`Using the explicit scope override: ${scope}.`);
  }

  assumptions.push(
    'Dry-run only: the script materializes a proposal and diff but never writes MEMORY.md.',
  );
  return assumptions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
