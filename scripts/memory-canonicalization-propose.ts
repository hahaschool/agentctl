import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import pg from 'pg';

import type {
  EntityCanonicalizationProposalCandidate,
  EntityCanonicalizationProposalReport,
} from '../packages/control-plane/src/memory/entity-canonicalization-proposals.js';
import {
  buildEntityCanonicalizationProposalReport,
  normalizeCanonicalAliasRecord,
} from '../packages/control-plane/src/memory/entity-canonicalization-proposals.js';
import {
  EntityCanonicalizationStore,
  type MemoryCanonicalAliasRecord,
} from '../packages/control-plane/src/memory/entity-canonicalization-store.js';

const { Pool } = pg;

export type CanonicalizationProposalOutputFormat = 'json' | 'csv';

export type CanonicalizationProposalCliOptions = {
  inputPath: string;
  canonicalAliasesPath?: string;
  databaseUrl?: string;
  outputPath?: string;
  format: CanonicalizationProposalOutputFormat;
};

type JsonRecord = Record<string, unknown>;

function usage(): string {
  return `Usage: pnpm memory:canonicalization:propose --input <path> [--canonical-aliases <path> | --database-url <url>] [--write <path>] [--format json|csv]

Reads candidate fact rows from a local JSON or JSONL file, resolves them against
local canonical entity aliases, and emits a review-only dry-run report.

Options:
  --input <path>                Candidate fact rows in JSON or JSONL form. Required.
  --canonical-aliases <path>    Canonical alias rows in JSON or JSONL form.
  --database-url <url>          Local PostgreSQL URL for reading memory_entity_aliases.
  --write <path>                Write the dry-run report to a file instead of stdout.
  --format <format>             json or csv. Default: json.
  --apply                       Unsupported in this dry-run-only tool.
  --execute                     Unsupported in this dry-run-only tool.
  --help                        Show this message.`;
}

export function parseArgs(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): CanonicalizationProposalCliOptions {
  const options: CanonicalizationProposalCliOptions = {
    inputPath: '',
    databaseUrl: env.DATABASE_URL,
    format: 'json',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg || arg === '--') {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }

    if (arg === '--input') {
      options.inputPath = path.resolve(readOptionValue(argv, index, arg));
      index += 1;
      continue;
    }

    if (arg === '--canonical-aliases') {
      options.canonicalAliasesPath = path.resolve(readOptionValue(argv, index, arg));
      index += 1;
      continue;
    }

    if (arg === '--database-url') {
      options.databaseUrl = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--write') {
      options.outputPath = path.resolve(readOptionValue(argv, index, arg));
      index += 1;
      continue;
    }

    if (arg === '--format') {
      options.format = parseOutputFormat(readOptionValue(argv, index, arg));
      index += 1;
      continue;
    }

    if (arg === '--apply') {
      throw new Error('--apply is not supported in this dry-run-only tool');
    }

    if (arg === '--execute') {
      throw new Error('--execute is not supported in this dry-run-only tool');
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (!options.inputPath) {
    throw new Error('--input is required');
  }

  if (!options.canonicalAliasesPath && !options.databaseUrl) {
    throw new Error('--canonical-aliases or --database-url is required');
  }

  return options;
}

export async function loadProposalCandidatesFromFile(
  inputPath: string,
): Promise<EntityCanonicalizationProposalCandidate[]> {
  const rows = loadJsonRecordsFromFile(inputPath, ['rows', 'candidates']);
  return rows.map((row, index) => normalizeProposalCandidateRecord(row, index));
}

export async function loadCanonicalAliasRecordsFromFile(
  inputPath: string,
): Promise<MemoryCanonicalAliasRecord[]> {
  const rows = loadJsonRecordsFromFile(inputPath, ['rows', 'aliases']);
  return rows.map((row, index) => normalizeAliasRecordFromUnknown(row, index));
}

export async function buildCanonicalizationProposalReport(
  options: CanonicalizationProposalCliOptions,
): Promise<EntityCanonicalizationProposalReport> {
  const [candidates, aliases] = await Promise.all([
    loadProposalCandidatesFromFile(options.inputPath),
    loadCanonicalAliasRecords(options),
  ]);

  return buildEntityCanonicalizationProposalReport({
    candidates,
    aliases,
  });
}

export function renderProposalReport(
  report: Pick<EntityCanonicalizationProposalReport, 'dryRun' | 'summary' | 'proposals'> &
    Partial<Pick<EntityCanonicalizationProposalReport, 'generatedAt'>>,
  format: CanonicalizationProposalOutputFormat,
): string {
  if (format === 'json') {
    return JSON.stringify(
      {
        generatedAt: report.generatedAt ?? null,
        dryRun: report.dryRun,
        summary: report.summary,
        proposals: report.proposals,
      },
      null,
      2,
    );
  }

  const columns = [
    'factId',
    'scope',
    'entityType',
    'entityName',
    'normalizedEntityName',
    'status',
    'resolutionReason',
    'proposalAction',
    'canonicalId',
    'canonicalName',
    'proposedAlias',
    'aliasAlreadyExists',
    'matchedCanonicalIds',
    'matchedCanonicalNames',
    'sessionId',
    'agentId',
    'machineId',
    'turnIndex',
    'importSourceId',
    'importJobId',
    'contentPreview',
  ];

  const lines = [
    columns.join(','),
    ...report.proposals.map((proposal) =>
      [
        proposal.factId,
        proposal.scope ?? '',
        proposal.entityType,
        proposal.entityName,
        proposal.normalizedEntityName,
        proposal.status,
        proposal.resolutionReason,
        proposal.proposalAction,
        proposal.canonicalId ?? '',
        proposal.canonicalName ?? '',
        proposal.proposedAlias ?? '',
        String(proposal.aliasAlreadyExists),
        proposal.matchedCanonicalIds.join('|'),
        proposal.matchedCanonicalNames.join('|'),
        proposal.reviewSource.sessionId ?? '',
        proposal.reviewSource.agentId ?? '',
        proposal.reviewSource.machineId ?? '',
        proposal.reviewSource.turnIndex === null ? '' : String(proposal.reviewSource.turnIndex),
        proposal.reviewSource.importSourceId ?? '',
        proposal.reviewSource.importJobId ?? '',
        proposal.contentPreview ?? '',
      ]
        .map(escapeCsvValue)
        .join(','),
    ),
  ];

  return lines.join('\n');
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const report = await buildCanonicalizationProposalReport(options);
  const rendered = renderProposalReport(report, options.format);

  if (options.outputPath) {
    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    fs.writeFileSync(options.outputPath, rendered, 'utf8');
    return;
  }

  console.log(rendered);
}

function loadJsonRecordsFromFile(inputPath: string, arrayKeys: readonly string[]): JsonRecord[] {
  const absolutePath = path.resolve(inputPath);
  const content = fs.readFileSync(absolutePath, 'utf8');
  const trimmed = content.trim();

  if (!trimmed) {
    return [];
  }

  const parsedJson = tryParseJson(trimmed);
  if (parsedJson !== undefined) {
    return coerceRecordArray(parsedJson, arrayKeys, absolutePath);
  }

  return trimmed
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      const parsed = tryParseJson(line);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new Error(`Invalid JSONL object at ${absolutePath}:${index + 1}`);
      }
      return parsed as JsonRecord;
    });
}

async function loadCanonicalAliasRecords(
  options: CanonicalizationProposalCliOptions,
): Promise<MemoryCanonicalAliasRecord[]> {
  if (options.canonicalAliasesPath) {
    return loadCanonicalAliasRecordsFromFile(options.canonicalAliasesPath);
  }

  const databaseUrl = options.databaseUrl;
  if (!databaseUrl) {
    return [];
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const store = new EntityCanonicalizationStore({ pool: pool as never });
    return await store.listAliases();
  } finally {
    await pool.end();
  }
}

function coerceRecordArray(
  value: unknown,
  arrayKeys: readonly string[],
  inputPath: string,
): JsonRecord[] {
  if (Array.isArray(value)) {
    return value.map((entry, index) => coerceJsonRecord(entry, `${inputPath}[${index}]`));
  }

  if (value && typeof value === 'object') {
    for (const key of arrayKeys) {
      const candidate = (value as Record<string, unknown>)[key];
      if (Array.isArray(candidate)) {
        return candidate.map((entry, index) =>
          coerceJsonRecord(entry, `${inputPath}.${key}[${index}]`),
        );
      }
    }

    return [coerceJsonRecord(value, inputPath)];
  }

  throw new Error(`Expected an array or object with ${arrayKeys.join('/')} in ${inputPath}`);
}

function coerceJsonRecord(value: unknown, label: string): JsonRecord {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`Expected ${label} to be an object`);
  }

  return value as JsonRecord;
}

function normalizeProposalCandidateRecord(
  record: JsonRecord,
  _index: number,
): EntityCanonicalizationProposalCandidate {
  const factId = readRequiredString(record, ['factId', 'fact_id', 'id'], 'factId');
  const entityType = readRequiredString(record, ['entityType', 'entity_type'], 'entityType');
  const entityName = readRequiredString(record, ['entityName', 'entity_name'], 'entityName');
  const source = normalizeSourceRecord(record.source ?? record.sourceJson ?? record.source_json);

  return {
    factId,
    scope: readOptionalString(record, ['scope']),
    entityType,
    entityName,
    content: readOptionalString(record, ['content', 'text']),
    source,
  };
}

function normalizeAliasRecordFromUnknown(
  record: JsonRecord,
  index: number,
): MemoryCanonicalAliasRecord {
  return normalizeCanonicalAliasRecord(
    {
      id: readOptionalString(record, ['id']),
      canonicalId: readRequiredString(record, ['canonicalId', 'canonical_id'], 'canonicalId'),
      entityType: readRequiredString(record, ['entityType', 'entity_type'], 'entityType'),
      canonicalName: readRequiredString(
        record,
        ['canonicalName', 'canonical_name'],
        'canonicalName',
      ),
      normalizedCanonicalName: readOptionalString(record, [
        'normalizedCanonicalName',
        'normalized_canonical_name',
      ]),
      alias: readRequiredString(record, ['alias'], 'alias'),
      normalizedAlias: readOptionalString(record, ['normalizedAlias', 'normalized_alias']),
      sourceJson: normalizeObjectRecord(record.sourceJson ?? record.source_json),
      createdAt: readOptionalString(record, ['createdAt', 'created_at']),
    },
    index,
  );
}

function normalizeSourceRecord(value: unknown): EntityCanonicalizationProposalCandidate['source'] {
  const record = normalizeObjectRecord(value);
  if (record === undefined) {
    return undefined;
  }

  const normalized = {
    sessionId: readOptionalString(record, ['sessionId', 'session_id']) ?? undefined,
    agentId: readOptionalString(record, ['agentId', 'agent_id']) ?? undefined,
    machineId: readOptionalString(record, ['machineId', 'machine_id']) ?? undefined,
    turnIndex: readOptionalInteger(record, ['turnIndex', 'turn_index']) ?? undefined,
    importSourceId: readOptionalString(record, ['importSourceId', 'import_source_id']) ?? undefined,
    importJobId: readOptionalString(record, ['importJobId', 'import_job_id']) ?? undefined,
  };

  if (Object.values(normalized).every((entry) => entry === undefined)) {
    return undefined;
  }

  return normalized;
}

function normalizeObjectRecord(value: unknown): JsonRecord | undefined {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return undefined;
  }

  return value as JsonRecord;
}

function readRequiredString(
  record: JsonRecord,
  keys: readonly string[],
  fieldName: string,
): string {
  const value = readOptionalString(record, keys);
  if (value === null) {
    throw new Error(`Missing ${fieldName}`);
  }
  return value;
}

function readOptionalString(record: JsonRecord, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return null;
}

function readOptionalInteger(record: JsonRecord, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (Number.isInteger(value)) {
      return value as number;
    }
  }

  return null;
}

function parseOutputFormat(value: string): CanonicalizationProposalOutputFormat {
  if (value === 'json' || value === 'csv') {
    return value;
  }

  throw new Error('--format must be json or csv');
}

function readOptionValue(argv: readonly string[], index: number, arg: string): string {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`${arg} requires a value`);
  }
  return value;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function escapeCsvValue(value: string): string {
  const spreadsheetSafeValue = /^[=+\-@]/u.test(value) ? `'${value}` : value;
  if (/[",\n\r]/u.test(spreadsheetSafeValue)) {
    return `"${spreadsheetSafeValue.replace(/"/gu, '""')}"`;
  }
  return spreadsheetSafeValue;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
