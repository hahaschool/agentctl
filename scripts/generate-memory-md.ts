import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ApprovalDecision, ApprovalGate, MemoryFact, MemoryScope } from '@agentctl/shared';

export type ReviewableMemoryFact = MemoryFact & {
  reviewed?: boolean;
  metadata?: Record<string, unknown>;
};

export type GenerateMemoryMdCliOptions = {
  projectPath: string;
  factsJsonPath?: string;
  controlPlaneUrl?: string;
  apiToken?: string;
  claudeProjectsDir: string;
  scope: MemoryScope;
  assumeInputReviewed: boolean;
  maxFacts: number;
  maxFactChars: number;
  factsFetchLimit: number;
  factsFetchTimeoutMs: number;
  requestApproval?: boolean;
  write?: boolean;
  approvalToken?: string;
  approvalGateId?: string;
  approvedBy?: string;
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
  existingContentSha256: string;
  proposedContentSha256: string;
  writeApprovalToken: string;
  approvalGate?: MemoryMdApprovalGate;
  assumptions: string[];
};

export type MemoryMdWriteResult = Omit<MemoryMdDryRunResult, 'dryRun'> & {
  dryRun: false;
  approvedBy: string;
  bytesWritten: number;
  writtenAt: string;
};

export type MemoryMdApprovalGate = ApprovalGate & {
  readonly decisions?: readonly ApprovalDecision[];
};

const GENERATED_BLOCK_START = '<!-- agentctl-memory-md:start -->';
const GENERATED_BLOCK_END = '<!-- agentctl-memory-md:end -->';
const SURFACE_A_WRITE_TASK_DEFINITION_ID = 'memory.surface-a.write';
const DEFAULT_MAX_FACTS = 8;
const DEFAULT_MAX_FACT_CHARS = 140;
const DEFAULT_FACTS_FETCH_LIMIT = 500;
const MAX_FACTS_FETCH_PAGE_SIZE = 500;
const DEFAULT_FACTS_FETCH_TIMEOUT_MS = 10_000;
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
  return `Usage: pnpm tsx scripts/generate-memory-md.ts --project-path <path> (--facts-json <path> | --control-plane-url <url>) [options]

Create a bounded dry-run MEMORY.md proposal for a Claude project path without writing files.

Options:
  --project-path <path>        Absolute or relative project path to materialize.
  --facts-json <path>          JSON file containing MemoryFact rows or { facts: MemoryFact[] }.
  --control-plane-url <url>    Control-plane base URL to fetch /api/memory/facts from.
  --api-token <token>          Optional bearer token. Defaults to AGENTCTL_API_TOKEN.
  --scope <scope>              Memory scope to summarize. Default: project:<basename(project-path)>.
  --claude-projects-dir <dir>  Override Claude projects root. Default: ~/.claude/projects.
  --assume-input-reviewed      Treat the input file as already reviewed.
  --max-facts <count>          Max generated bullets. Default: ${DEFAULT_MAX_FACTS}.
  --max-fact-chars <count>     Max characters per generated bullet. Default: ${DEFAULT_MAX_FACT_CHARS}.
  --api-fetch-limit <count>    Max API facts to fetch. Default: ${DEFAULT_FACTS_FETCH_LIMIT}.
  --facts-fetch-timeout-ms <ms> API fetch timeout. Default: ${DEFAULT_FACTS_FETCH_TIMEOUT_MS}.
  --request-approval           Create a durable approval gate for this proposal.
  --write                      Write the approved proposal to MEMORY.md.
  --approval-token <token>     Required with --write. Must match the current dry-run token.
  --approval-gate-id <id>      Durable approval gate to verify before --write.
  --approved-by <id>           Offline reviewer id when --write is not using an approval gate.
  --json                       Emit the result as JSON.
  --help, -h                   Show this help text.

Reviewed facts are explicit by default: reviewed=true, metadata.reviewed=true, source.reviewed=true,
or tags including "reviewed" / "surface-a-reviewed".`;
}

export function parseArgs(argv: readonly string[]): GenerateMemoryMdCliOptions {
  let projectPath: string | null = null;
  let factsJsonPath: string | null = null;
  let controlPlaneUrl: string | null = null;
  let apiToken: string | null = null;
  let claudeProjectsDir = DEFAULT_CLAUDE_PROJECTS_DIR;
  let scope: MemoryScope | null = null;
  let assumeInputReviewed = false;
  let maxFacts = DEFAULT_MAX_FACTS;
  let maxFactChars = DEFAULT_MAX_FACT_CHARS;
  let factsFetchLimit = DEFAULT_FACTS_FETCH_LIMIT;
  let factsFetchTimeoutMs = DEFAULT_FACTS_FETCH_TIMEOUT_MS;
  let requestApproval = false;
  let write = false;
  let approvalToken: string | null = null;
  let approvalGateId: string | null = null;
  let approvedBy: string | null = null;
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

    if (arg === '--control-plane-url') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--control-plane-url requires a value');
      }
      controlPlaneUrl = value;
      index += 1;
      continue;
    }

    if (arg === '--api-token') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--api-token requires a value');
      }
      apiToken = value;
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

    if (arg === '--api-fetch-limit' || arg === '--facts-fetch-limit') {
      factsFetchLimit = parsePositiveInteger(argv[index + 1], arg);
      index += 1;
      continue;
    }

    if (arg === '--facts-fetch-timeout-ms') {
      factsFetchTimeoutMs = parsePositiveInteger(argv[index + 1], '--facts-fetch-timeout-ms');
      index += 1;
      continue;
    }

    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--write') {
      write = true;
      continue;
    }

    if (arg === '--request-approval') {
      requestApproval = true;
      continue;
    }

    if (arg === '--approval-token') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--approval-token requires a value');
      }
      approvalToken = value.trim();
      index += 1;
      continue;
    }

    if (arg === '--approval-gate-id') {
      approvalGateId = parseBoundedString(argv[index + 1], '--approval-gate-id', 128);
      index += 1;
      continue;
    }

    if (arg === '--approved-by') {
      approvedBy = parseBoundedString(argv[index + 1], '--approved-by', 128);
      index += 1;
      continue;
    }

    if (arg?.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!projectPath) {
    throw new Error('--project-path is required');
  }
  if (Number(Boolean(factsJsonPath)) + Number(Boolean(controlPlaneUrl)) !== 1) {
    throw new Error('Provide exactly one fact source: --facts-json or --control-plane-url');
  }
  if (requestApproval && write) {
    throw new Error('--request-approval cannot be combined with --write');
  }
  if (requestApproval && !controlPlaneUrl) {
    throw new Error('--request-approval requires --control-plane-url');
  }
  if (approvalGateId && !controlPlaneUrl) {
    throw new Error('--approval-gate-id requires --control-plane-url');
  }
  if (write && !approvalToken) {
    throw new Error('--write requires --approval-token from a reviewed dry run');
  }
  if (write && !approvedBy && !approvalGateId) {
    throw new Error('--write requires --approved-by or --approval-gate-id');
  }

  const resolvedApiToken = apiToken ?? process.env.AGENTCTL_API_TOKEN;
  return {
    projectPath,
    ...(factsJsonPath ? { factsJsonPath } : {}),
    ...(controlPlaneUrl ? { controlPlaneUrl } : {}),
    ...(resolvedApiToken ? { apiToken: resolvedApiToken } : {}),
    claudeProjectsDir,
    scope: scope ?? deriveDefaultScope(projectPath),
    assumeInputReviewed,
    maxFacts,
    maxFactChars,
    factsFetchLimit,
    factsFetchTimeoutMs,
    requestApproval,
    write,
    ...(approvalToken ? { approvalToken } : {}),
    ...(approvalGateId ? { approvalGateId } : {}),
    ...(approvedBy ? { approvedBy } : {}),
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
    'memory',
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

export async function fetchFactsFromControlPlane(input: {
  controlPlaneUrl: string;
  apiToken?: string;
  scope: MemoryScope;
  limit: number;
  timeoutMs: number;
}): Promise<ReviewableMemoryFact[]> {
  const facts: ReviewableMemoryFact[] = [];

  while (facts.length < input.limit) {
    const pageLimit = Math.min(MAX_FACTS_FETCH_PAGE_SIZE, input.limit - facts.length);
    const page = await fetchFactsPageFromControlPlane({
      controlPlaneUrl: input.controlPlaneUrl,
      ...(input.apiToken ? { apiToken: input.apiToken } : {}),
      scope: input.scope,
      limit: pageLimit,
      offset: facts.length,
      timeoutMs: input.timeoutMs,
    });

    facts.push(...page);
    if (page.length < pageLimit) {
      break;
    }
  }

  return facts;
}

async function fetchFactsPageFromControlPlane(input: {
  controlPlaneUrl: string;
  apiToken?: string;
  scope: MemoryScope;
  limit: number;
  offset: number;
  timeoutMs: number;
}): Promise<ReviewableMemoryFact[]> {
  const url = new URL('/api/memory/facts', ensureTrailingSlash(input.controlPlaneUrl));
  url.searchParams.set('scope', input.scope);
  url.searchParams.set('limit', String(input.limit));
  url.searchParams.set('offset', String(input.offset));
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (input.apiToken) {
    headers.Authorization = `Bearer ${input.apiToken}`;
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(input.timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch memory facts from control plane: HTTP ${response.status}`);
  }

  const parsed = (await response.json()) as unknown;
  if (!isRecord(parsed) || parsed.ok !== true || !Array.isArray(parsed.facts)) {
    throw new Error('Control-plane memory facts response must contain ok=true and a facts array');
  }

  return parsed.facts as ReviewableMemoryFact[];
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
  options: Omit<
    GenerateMemoryMdCliOptions,
    | 'factsJsonPath'
    | 'controlPlaneUrl'
    | 'apiToken'
    | 'factsFetchLimit'
    | 'factsFetchTimeoutMs'
    | 'write'
    | 'approvalToken'
    | 'approvedBy'
    | 'json'
  > & {
    existingMemoryContent?: string | null;
  },
): MemoryMdDryRunResult {
  const memoryPath = resolveClaudeMemoryPath(options.projectPath, options.claudeProjectsDir);
  const existingMemoryContent = options.existingMemoryContent ?? null;
  const existingMemoryExists = existingMemoryContent != null;
  const selection = selectReviewedFacts({
    facts,
    scope: options.scope,
    assumeInputReviewed: options.assumeInputReviewed,
    maxFacts: options.maxFacts,
    maxFactChars: options.maxFactChars,
  });
  const proposedContent = mergeMemoryContent(
    existingMemoryContent,
    renderGeneratedMemoryBlock(selection.selectedFacts),
  );
  const existingContentSha256 = sha256(existingMemoryContent ?? '');
  const proposedContentSha256 = sha256(proposedContent);
  const writeApprovalToken = computeMemoryMdWriteApprovalToken({
    projectPath: options.projectPath,
    memoryPath,
    scope: options.scope,
    existingMemoryExists,
    existingContentSha256,
    proposedContentSha256,
  });

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
    diff: buildUnifiedDiff(existingMemoryContent, proposedContent, memoryPath),
    existingContentSha256,
    proposedContentSha256,
    writeApprovalToken,
    assumptions: buildAssumptions(options.assumeInputReviewed, options.scope, options.projectPath),
  };
}

export function runGenerateMemoryMdDryRun(
  options: GenerateMemoryMdCliOptions,
): MemoryMdDryRunResult {
  if (!options.factsJsonPath) {
    throw new Error(
      'runGenerateMemoryMdDryRun requires --facts-json; use the async runner for API sources',
    );
  }

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

export async function runGenerateMemoryMdDryRunFromSource(
  options: GenerateMemoryMdCliOptions,
): Promise<MemoryMdDryRunResult> {
  const facts = options.factsJsonPath
    ? loadFactsJson(options.factsJsonPath)
    : await fetchFactsFromControlPlane({
        controlPlaneUrl: requireOption(options.controlPlaneUrl, '--control-plane-url'),
        ...(options.apiToken ? { apiToken: options.apiToken } : {}),
        scope: options.scope,
        limit: options.factsFetchLimit,
        timeoutMs: options.factsFetchTimeoutMs,
      });
  const memoryPath = resolveClaudeMemoryPath(options.projectPath, options.claudeProjectsDir);
  const existingMemoryContent = fs.existsSync(memoryPath)
    ? fs.readFileSync(memoryPath, 'utf8')
    : null;

  const dryRun = generateMemoryMdDryRun(facts, {
    projectPath: options.projectPath,
    claudeProjectsDir: options.claudeProjectsDir,
    scope: options.scope,
    assumeInputReviewed: options.assumeInputReviewed,
    maxFacts: options.maxFacts,
    maxFactChars: options.maxFactChars,
    existingMemoryContent,
  });

  if (!options.requestApproval) {
    return dryRun;
  }

  const approvalGate = await createMemoryMdApprovalGate({
    controlPlaneUrl: requireOption(options.controlPlaneUrl, '--control-plane-url'),
    ...(options.apiToken ? { apiToken: options.apiToken } : {}),
    dryRun,
  });

  return { ...dryRun, approvalGate };
}

export async function runGenerateMemoryMdWriteFromSource(
  options: GenerateMemoryMdCliOptions,
): Promise<MemoryMdWriteResult> {
  const approvalToken = requireOption(options.approvalToken, '--approval-token');
  const dryRun = await runGenerateMemoryMdDryRunFromSource(options);

  if (approvalToken !== dryRun.writeApprovalToken) {
    throw new Error(
      'Write approval token does not match the current MEMORY.md proposal; rerun the dry run and review the latest diff.',
    );
  }

  const approvalGate = options.approvalGateId
    ? await fetchMemoryMdApprovalGate({
        controlPlaneUrl: requireOption(options.controlPlaneUrl, '--control-plane-url'),
        ...(options.apiToken ? { apiToken: options.apiToken } : {}),
        approvalGateId: options.approvalGateId,
      })
    : undefined;
  if (approvalGate) {
    assertApprovalGateMatchesProposal(approvalGate, dryRun);
  }
  const approvedBy = options.approvedBy ?? approvedDecisionActor(approvalGate);
  if (!approvedBy) {
    throw new Error('--write requires --approved-by or an approved gate decision');
  }

  fs.mkdirSync(path.dirname(dryRun.memoryPath), { recursive: true });
  fs.writeFileSync(dryRun.memoryPath, dryRun.proposedContent, 'utf8');

  return {
    ...dryRun,
    dryRun: false,
    approvedBy,
    ...(approvalGate ? { approvalGate } : {}),
    bytesWritten: Buffer.byteLength(dryRun.proposedContent, 'utf8'),
    writtenAt: new Date().toISOString(),
  };
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
    `Write approval token: ${result.writeApprovalToken}`,
    ...(result.approvalGate
      ? [`Approval gate: ${result.approvalGate.id} (${result.approvalGate.status})`]
      : []),
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

export function formatMemoryMdWriteResult(result: MemoryMdWriteResult): string {
  return [
    '# MEMORY.md Write Complete',
    '',
    `Project path: ${result.projectPath}`,
    `Target path: ${result.memoryPath}`,
    `Scope: ${result.scope}`,
    `Approved by: ${result.approvedBy}`,
    `Bytes written: ${result.bytesWritten}`,
    `Written at: ${result.writtenAt}`,
    `Write approval token: ${result.writeApprovalToken}`,
    ...(result.approvalGate
      ? [`Approval gate: ${result.approvalGate.id} (${result.approvalGate.status})`]
      : []),
    '',
  ].join('\n');
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const result = options.write
    ? await runGenerateMemoryMdWriteFromSource(options)
    : await runGenerateMemoryMdDryRunFromSource(options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(result.dryRun ? formatMemoryMdDryRun(result) : formatMemoryMdWriteResult(result));
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

function parseBoundedString(raw: string | undefined, flagName: string, maxLength: number): string {
  const value = raw?.trim();
  if (!value) {
    throw new Error(`${flagName} requires a non-empty value`);
  }
  if (value.length > maxLength) {
    throw new Error(`${flagName} must be at most ${maxLength} characters`);
  }
  return value;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function requireOption<T>(value: T | null | undefined, flagName: string): T {
  if (value == null) {
    throw new Error(`${flagName} is required`);
  }
  return value;
}

async function createMemoryMdApprovalGate(input: {
  controlPlaneUrl: string;
  apiToken?: string;
  dryRun: MemoryMdDryRunResult;
}): Promise<MemoryMdApprovalGate> {
  const url = new URL('/api/approvals', ensureTrailingSlash(input.controlPlaneUrl));
  const response = await fetch(url, {
    method: 'POST',
    headers: buildApprovalHeaders(input.apiToken, true),
    body: JSON.stringify({
      taskDefinitionId: SURFACE_A_WRITE_TASK_DEFINITION_ID,
      taskRunId: input.dryRun.writeApprovalToken,
      threadId: `memory-surface-a:${input.dryRun.writeApprovalToken.slice(0, 32)}`,
      contextArtifactIds: input.dryRun.selectedFacts.map((fact) => fact.id).slice(0, 256),
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create MEMORY.md approval gate: HTTP ${response.status}`);
  }

  return parseApprovalGate(await response.json());
}

async function fetchMemoryMdApprovalGate(input: {
  controlPlaneUrl: string;
  apiToken?: string;
  approvalGateId: string;
}): Promise<MemoryMdApprovalGate> {
  const url = new URL(
    `/api/approvals/${encodeURIComponent(input.approvalGateId)}`,
    ensureTrailingSlash(input.controlPlaneUrl),
  );
  const response = await fetch(url, {
    headers: buildApprovalHeaders(input.apiToken, false),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch MEMORY.md approval gate: HTTP ${response.status}`);
  }

  return parseApprovalGate(await response.json());
}

function buildApprovalHeaders(apiToken: string | undefined, withJsonBody: boolean): HeadersInit {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (withJsonBody) {
    headers['Content-Type'] = 'application/json';
  }
  if (apiToken) {
    headers.Authorization = `Bearer ${apiToken}`;
  }
  return headers;
}

function parseApprovalGate(value: unknown): MemoryMdApprovalGate {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.taskDefinitionId !== 'string' ||
    typeof value.status !== 'string'
  ) {
    throw new Error('Approval gate response must contain id, taskDefinitionId, and status');
  }
  return value as MemoryMdApprovalGate;
}

function assertApprovalGateMatchesProposal(
  gate: MemoryMdApprovalGate,
  dryRun: MemoryMdDryRunResult,
): void {
  if (gate.taskDefinitionId !== SURFACE_A_WRITE_TASK_DEFINITION_ID) {
    throw new Error('Approval gate is not for a MEMORY.md Surface A write');
  }
  if (gate.taskRunId !== dryRun.writeApprovalToken) {
    throw new Error(
      'Approval gate does not match the current MEMORY.md proposal; rerun the dry run and request approval again.',
    );
  }
  if (gate.status !== 'approved') {
    throw new Error(`Approval gate '${gate.id}' is not approved (status: ${gate.status})`);
  }
}

function approvedDecisionActor(gate: MemoryMdApprovalGate | undefined): string | undefined {
  const approvedDecision = gate?.decisions?.find((decision) => decision.action === 'approved');
  return approvedDecision?.decidedBy;
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

function computeMemoryMdWriteApprovalToken(input: {
  projectPath: string;
  memoryPath: string;
  scope: MemoryScope;
  existingMemoryExists: boolean;
  existingContentSha256: string;
  proposedContentSha256: string;
}): string {
  return sha256(
    JSON.stringify({
      version: 1,
      projectPath: input.projectPath,
      memoryPath: input.memoryPath,
      scope: input.scope,
      existingMemoryExists: input.existingMemoryExists,
      existingContentSha256: input.existingContentSha256,
      proposedContentSha256: input.proposedContentSha256,
    }),
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
