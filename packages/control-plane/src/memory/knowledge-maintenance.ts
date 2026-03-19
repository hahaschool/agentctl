// ---------------------------------------------------------------------------
// Knowledge Maintenance / Dreaming -- section 7.4
//
// Four maintenance passes that run on a monthly schedule:
//
//  1. Stale-entry lint -- scan memory facts that reference files/paths
//     no longer present in the codebase. Flag them with `outdated` feedback.
//
//  2. Cross-reference lessons vs. codebase changes -- find facts about
//     deleted files (using `git log --diff-filter=D`), mark them stale.
//
//  3. Synthesis pass -- use the knowledge graph (memory_edges) to identify
//     clusters of related facts (2-hop BFS). Propose higher-level principles
//     for clusters of 3+ facts.
//
//  4. Knowledge coverage -- compare codebase directories against memory
//     facts to identify gaps (modules without lessons/patterns).
// ---------------------------------------------------------------------------

import { execFile as execFileCb } from 'node:child_process';
import type { Dirent } from 'node:fs';
import { realpathSync } from 'node:fs';
import { access, readdir } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import type {
  ConsolidationItem,
  MemoryFact,
  MemoryReport,
  MemoryReportType,
} from '@agentctl/shared';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import type { MemoryStore } from './memory-store.js';

const execFile = promisify(execFileCb);

const STALE_FILE_PATTERN =
  /(?:^|\s|["'`(])([./][\w./-]+\.\w{1,6}|(?:src|packages|lib|test|docs)\/[\w./-]+\.\w{1,6})(?:["'`)\s,]|$)/g;
const MIN_CLUSTER_SIZE = 3;
const MAX_BFS_DEPTH = 2;
const MAX_DELETED_FILES = 200;
const MAX_DIRECTORY_DEPTH = 3;
const EXCLUDED_DIRECTORY_NAMES = new Set(['node_modules', '.git', 'dist']);
const BLOCKED_GIT_ENV_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CONFIG',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CEILING_DIRECTORIES',
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StaleEntryResult = {
  factId: string;
  content: string;
  referencedPaths: string[];
  reason: string;
};

export type DeletedFileResult = {
  factId: string;
  content: string;
  deletedFile: string;
};

export type SynthesisCluster = {
  seedFactId: string;
  factIds: string[];
  factContents: string[];
  proposedPrinciple: string;
};

export type CoverageGap = {
  directory: string;
  factCount: number;
};

export type CoverageEntry = {
  directory: string;
  factCount: number;
};

export type KnowledgeCoverageReport = {
  covered: CoverageEntry[];
  gaps: CoverageGap[];
  totalDirectories: number;
  coveredCount: number;
  gapCount: number;
};

export type MaintenanceResult = {
  staleEntries: StaleEntryResult[];
  deletedFileEntries: DeletedFileResult[];
  synthesisClusters: SynthesisCluster[];
  coverageReport: KnowledgeCoverageReport;
  consolidationItems: ConsolidationItem[];
  report: MemoryReport | null;
};

export type KnowledgeMaintenanceOptions = {
  pool: Pool;
  memoryStore: MemoryStore;
  logger: Logger;
  /** Absolute path to the git repository root. Defaults to cwd. */
  projectRoot?: string;
};

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  const allowedPrefix = rootPath.endsWith(sep) ? rootPath : `${rootPath}${sep}`;
  return candidatePath === rootPath || candidatePath.startsWith(allowedPrefix);
}

function sanitizeGitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized = { ...env };
  for (const key of BLOCKED_GIT_ENV_VARS) {
    delete sanitized[key];
  }
  return sanitized;
}

function tryRealpathSync(targetPath: string): string | null {
  try {
    return resolve(normalize(realpathSync.native(targetPath)));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class KnowledgeMaintenance {
  private readonly pool: Pool;
  private readonly memoryStore: MemoryStore;
  private readonly logger: Logger;
  private readonly projectRoot: string;

  constructor(options: KnowledgeMaintenanceOptions) {
    this.pool = options.pool;
    this.memoryStore = options.memoryStore;
    this.logger = options.logger;
    const workspaceRoot = tryRealpathSync(process.cwd()) ?? resolve(normalize(process.cwd()));
    const requestedRoot = resolve(normalize(options.projectRoot ?? workspaceRoot));
    const canonicalRequestedRoot = tryRealpathSync(requestedRoot) ?? requestedRoot;

    if (isWithinRoot(canonicalRequestedRoot, workspaceRoot)) {
      this.projectRoot = canonicalRequestedRoot;
    } else {
      this.projectRoot = workspaceRoot;
      this.logger.warn(
        { requestedRoot, canonicalRequestedRoot, workspaceRoot },
        'Ignoring projectRoot outside the current working tree',
      );
    }
  }

  /** Run all four maintenance passes and return a combined result. */
  async run(scope?: string): Promise<MaintenanceResult> {
    const [staleEntries, deletedFileEntries, synthesisClusters, coverageReport] = await Promise.all(
      [
        this.lintStaleEntries(scope),
        this.crossReferenceDeletedFiles(scope),
        this.synthesisPass(scope),
        this.knowledgeCoverage(scope),
      ],
    );

    // Emit consolidation items for each stale finding
    const consolidationItems: ConsolidationItem[] = [];

    for (const stale of staleEntries) {
      const item = await this.memoryStore.addConsolidationItem({
        type: 'stale',
        severity: 'medium',
        factIds: [stale.factId],
        suggestion: 'Review and update or remove this fact — referenced paths no longer exist',
        reason: stale.reason,
      });
      consolidationItems.push(item);
    }

    for (const deleted of deletedFileEntries) {
      const item = await this.memoryStore.addConsolidationItem({
        type: 'stale',
        severity: 'medium',
        factIds: [deleted.factId],
        suggestion: `Archive this fact — the file "${deleted.deletedFile}" was deleted from the codebase`,
        reason: `Fact references deleted file: ${deleted.deletedFile}`,
      });
      consolidationItems.push(item);
    }

    // Flag stale + deleted facts with reduced confidence
    const staleFactIds = [
      ...staleEntries.map((s) => s.factId),
      ...deletedFileEntries.map((d) => d.factId),
    ];

    for (const factId of [...new Set(staleFactIds)]) {
      await this.memoryStore.recordFeedback(factId, 'outdated');
    }

    // Store knowledge-health report
    const report = await this.storeReport(
      scope ?? 'global',
      staleEntries,
      deletedFileEntries,
      synthesisClusters,
      coverageReport,
    );

    this.logger.info(
      {
        staleEntries: staleEntries.length,
        deletedFileEntries: deletedFileEntries.length,
        synthesisClusters: synthesisClusters.length,
        coveredDirs: coverageReport.coveredCount,
        gapDirs: coverageReport.gapCount,
      },
      'Knowledge maintenance complete',
    );

    return {
      staleEntries,
      deletedFileEntries,
      synthesisClusters,
      coverageReport,
      consolidationItems,
      report,
    };
  }

  // -------------------------------------------------------------------------
  // Pass 1: Lint stale entries (facts referencing non-existent files)
  // -------------------------------------------------------------------------

  async lintStaleEntries(scope?: string): Promise<StaleEntryResult[]> {
    const facts = await this.fetchCodeArtifactFacts(scope);
    const results: StaleEntryResult[] = [];

    for (const fact of facts) {
      const paths = extractFilePaths(fact.content);
      if (paths.length === 0) {
        continue;
      }

      const missingPaths: string[] = [];
      for (const p of paths) {
        const exists = await this.fileExists(p);
        if (!exists) {
          missingPaths.push(p);
        }
      }

      if (missingPaths.length > 0) {
        results.push({
          factId: fact.id,
          content: fact.content,
          referencedPaths: missingPaths,
          reason: `Referenced paths no longer exist: ${missingPaths.join(', ')}`,
        });
      }
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Pass 2: Cross-reference lessons against codebase changes (deleted files)
  // -------------------------------------------------------------------------

  async crossReferenceDeletedFiles(scope?: string): Promise<DeletedFileResult[]> {
    const deletedFiles = await this.getDeletedFiles();
    if (deletedFiles.length === 0) {
      return [];
    }

    const facts = await this.fetchCodeArtifactFacts(scope);
    const results: DeletedFileResult[] = [];

    for (const fact of facts) {
      for (const deleted of deletedFiles) {
        if (fact.content.includes(deleted)) {
          results.push({
            factId: fact.id,
            content: fact.content,
            deletedFile: deleted,
          });
          break; // One match per fact is enough
        }
      }
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Pass 3: Synthesis — identify clusters via 2-hop BFS, propose principles
  // -------------------------------------------------------------------------

  async synthesisPass(scope?: string): Promise<SynthesisCluster[]> {
    const facts = await this.fetchActiveFacts(scope);
    if (facts.length === 0) {
      return [];
    }

    // Build adjacency list from edges
    const factIds = facts.map((f) => f.id);
    const edges = await this.fetchEdgesForFacts(factIds);
    const adjacency = buildAdjacencyList(edges);

    // BFS from each fact to find clusters
    const visited = new Set<string>();
    const clusters: SynthesisCluster[] = [];
    const factMap = new Map(facts.map((f) => [f.id, f]));

    for (const fact of facts) {
      if (visited.has(fact.id)) {
        continue;
      }

      const clusterIds = bfs(fact.id, adjacency, MAX_BFS_DEPTH);
      if (clusterIds.length < MIN_CLUSTER_SIZE) {
        continue;
      }

      for (const id of clusterIds) {
        visited.add(id);
      }

      const clusterFacts = clusterIds
        .map((id) => factMap.get(id))
        .filter((f): f is MemoryFact => f !== undefined);

      clusters.push({
        seedFactId: fact.id,
        factIds: clusterFacts.map((f) => f.id),
        factContents: clusterFacts.map((f) => f.content),
        proposedPrinciple: generatePrincipleHint(clusterFacts),
      });
    }

    // Store proposed principles as new facts with low confidence
    for (const cluster of clusters) {
      await this.memoryStore.addFact({
        scope: scope ? (scope as `project:${string}`) : 'global',
        content: cluster.proposedPrinciple,
        entity_type: 'principle',
        source: {
          session_id: null,
          agent_id: null,
          machine_id: null,
          turn_index: null,
          extraction_method: 'rule',
        },
        confidence: 0.3,
        tags: ['auto-synthesized', 'needs-review'],
      });
    }

    return clusters;
  }

  // -------------------------------------------------------------------------
  // Pass 4: Knowledge coverage — directories with vs. without memory facts
  // -------------------------------------------------------------------------

  async knowledgeCoverage(scope?: string): Promise<KnowledgeCoverageReport> {
    const directories = await this.listCodebaseDirectories();
    const factsByDirectory = await this.countFactsByDirectory(scope);

    const covered: CoverageEntry[] = [];
    const gaps: CoverageGap[] = [];

    for (const dir of directories) {
      const count = factsByDirectory.get(dir) ?? 0;
      if (count > 0) {
        covered.push({ directory: dir, factCount: count });
      } else {
        gaps.push({ directory: dir, factCount: 0 });
      }
    }

    return {
      covered,
      gaps,
      totalDirectories: directories.length,
      coveredCount: covered.length,
      gapCount: gaps.length,
    };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private async fetchCodeArtifactFacts(scope?: string): Promise<MemoryFact[]> {
    const scopeClause = scope ? 'AND scope = $1' : '';
    const params: unknown[] = scope ? [scope] : [];

    const { rows } = await this.pool.query(
      `SELECT id, scope, content, content_model, entity_type,
              confidence::real, strength::real, source_json,
              valid_from, valid_until, created_at, accessed_at,
              tags, usage_count
       FROM memory_facts
       WHERE valid_until IS NULL
         AND entity_type IN ('code_artifact', 'pattern')
         ${scopeClause}
       ORDER BY created_at DESC
       LIMIT 500`,
      params,
    );

    return (rows as Record<string, unknown>[]).map(rowToFact);
  }

  private async fetchActiveFacts(scope?: string): Promise<MemoryFact[]> {
    const scopeClause = scope ? 'AND scope = $1' : '';
    const params: unknown[] = scope ? [scope] : [];

    const { rows } = await this.pool.query(
      `SELECT id, scope, content, content_model, entity_type,
              confidence::real, strength::real, source_json,
              valid_from, valid_until, created_at, accessed_at,
              tags, usage_count
       FROM memory_facts
       WHERE valid_until IS NULL
         AND strength > 0.05
         ${scopeClause}
       ORDER BY created_at DESC
       LIMIT 500`,
      params,
    );

    return (rows as Record<string, unknown>[]).map(rowToFact);
  }

  private async fetchEdgesForFacts(
    factIds: string[],
  ): Promise<Array<{ source: string; target: string }>> {
    if (factIds.length === 0) {
      return [];
    }

    const { rows } = await this.pool.query(
      `SELECT source_fact_id, target_fact_id
       FROM memory_edges
       WHERE source_fact_id = ANY($1::text[])
          OR target_fact_id = ANY($1::text[])`,
      [factIds],
    );

    return (rows as Array<{ source_fact_id: string; target_fact_id: string }>).map((row) => ({
      source: row.source_fact_id,
      target: row.target_fact_id,
    }));
  }

  /**
   * Check whether a file exists, with path traversal prevention.
   *
   * Security: validates that the joined path stays within projectRoot
   * to prevent path traversal attacks (js/path-injection).
   */
  private async fileExists(relativePath: string): Promise<boolean> {
    const joined = this.resolveProjectPath(relativePath);
    if (!joined) {
      return false;
    }

    try {
      await access(joined);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List files deleted from the git repository in the last 90 days.
   *
   * Security: resolves the real path of projectRoot and verifies
   * a .git directory exists before passing it to execFile, preventing
   * shell-command-injection-from-environment (js/shell-command-injection-from-environment).
   */
  private async getDeletedFiles(): Promise<string[]> {
    try {
      const gitDir = this.resolveProjectPath('.git');
      if (!gitDir) {
        return [];
      }

      try {
        await access(gitDir);
      } catch {
        this.logger.debug(
          { projectRoot: this.projectRoot },
          'No .git directory found — skipping deleted-file scan',
        );
        return [];
      }

      const { stdout } = await execFile(
        'git',
        ['log', '--diff-filter=D', '--name-only', '--pretty=format:', '--since=90 days ago'],
        {
          cwd: this.projectRoot,
          env: sanitizeGitEnv(process.env),
        },
      );

      return Array.from(
        new Set(
          stdout
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0),
        ),
      ).slice(0, MAX_DELETED_FILES);
    } catch (error: unknown) {
      this.logger.warn({ err: error }, 'Failed to list deleted files from git log');
      return [];
    }
  }

  private async listCodebaseDirectories(): Promise<string[]> {
    const packagesRoot = this.resolveProjectPath('packages');
    if (!packagesRoot) {
      return [];
    }

    try {
      const directories = await this.walkDirectories('packages', 0);
      return directories.sort();
    } catch (error: unknown) {
      this.logger.warn({ err: error }, 'Failed to list codebase directories');
      return [];
    }
  }

  private async walkDirectories(relativeDirectoryPath: string, depth: number): Promise<string[]> {
    const directoryPath = this.resolveProjectPath(relativeDirectoryPath);
    if (!directoryPath) {
      return [];
    }

    let entries: Dirent[];
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    const directories =
      relativeDirectoryPath.length > 0 ? [relativeDirectoryPath.replaceAll('\\', '/')] : [];

    if (depth >= MAX_DIRECTORY_DEPTH) {
      return directories;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
        continue;
      }
      const childRelativePath = join(relativeDirectoryPath, entry.name);
      directories.push(...(await this.walkDirectories(childRelativePath, depth + 1)));
    }

    return directories;
  }

  private resolveProjectPath(relativePath: string): string | null {
    const joined = resolve(join(this.projectRoot, relativePath));
    return isWithinRoot(joined, this.projectRoot) ? joined : null;
  }

  private async countFactsByDirectory(scope?: string): Promise<Map<string, number>> {
    const scopeClause = scope ? 'AND scope = $1' : '';
    const params: unknown[] = scope ? [scope] : [];

    const { rows } = await this.pool.query(
      `SELECT content, COUNT(*)::int AS cnt
       FROM memory_facts
       WHERE valid_until IS NULL
         AND entity_type IN ('code_artifact', 'pattern', 'decision', 'error')
         ${scopeClause}
       GROUP BY content`,
      params,
    );

    const dirCounts = new Map<string, number>();

    for (const row of rows as Array<{ content: string; cnt: number }>) {
      const paths = extractFilePaths(row.content);
      for (const p of paths) {
        // Extract directory from the path
        const dir = p.includes('/') ? p.substring(0, p.lastIndexOf('/')) : p;
        if (dir.startsWith('packages/')) {
          dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + row.cnt);
        }
      }
    }

    return dirCounts;
  }

  private async storeReport(
    scope: string,
    staleEntries: StaleEntryResult[],
    deletedFileEntries: DeletedFileResult[],
    synthesisClusters: SynthesisCluster[],
    coverageReport: KnowledgeCoverageReport,
  ): Promise<MemoryReport | null> {
    const now = new Date().toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const reportType: MemoryReportType = 'knowledge-health';

    const content = [
      `# Knowledge Health Report`,
      ``,
      `## Stale Entries: ${staleEntries.length}`,
      ...staleEntries.slice(0, 10).map((s) => `- Fact ${s.factId}: ${s.reason}`),
      ``,
      `## Deleted File References: ${deletedFileEntries.length}`,
      ...deletedFileEntries
        .slice(0, 10)
        .map((d) => `- Fact ${d.factId}: references deleted ${d.deletedFile}`),
      ``,
      `## Synthesis Clusters: ${synthesisClusters.length}`,
      ...synthesisClusters
        .slice(0, 5)
        .map((c) => `- Cluster of ${c.factIds.length} facts: "${c.proposedPrinciple}"`),
      ``,
      `## Knowledge Coverage`,
      `- Total directories: ${coverageReport.totalDirectories}`,
      `- Covered: ${coverageReport.coveredCount}`,
      `- Gaps: ${coverageReport.gapCount}`,
      ...coverageReport.gaps.slice(0, 10).map((g) => `- Gap: ${g.directory}`),
    ].join('\n');

    const id = generateReportId();

    try {
      await this.pool.query(
        `INSERT INTO memory_reports (id, type, scope, period_start, period_end, content, metadata, generated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          reportType,
          scope,
          thirtyDaysAgo,
          now,
          content,
          JSON.stringify({
            factCount: staleEntries.length + deletedFileEntries.length,
            newFacts: synthesisClusters.length,
            topEntities: ['code_artifact', 'pattern'],
          }),
          now,
        ],
      );

      return {
        id,
        type: reportType,
        scope,
        periodStart: thirtyDaysAgo,
        periodEnd: now,
        content,
        metadata: {
          factCount: staleEntries.length + deletedFileEntries.length,
          newFacts: synthesisClusters.length,
          topEntities: ['code_artifact', 'pattern'],
        },
        generatedAt: now,
      };
    } catch (error: unknown) {
      this.logger.warn(
        { err: error },
        'Failed to store knowledge-health report (table may not exist yet)',
      );
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

export function extractFilePaths(content: string): string[] {
  const matches = new Set<string>();

  // Reset regex state
  STALE_FILE_PATTERN.lastIndex = 0;

  let match = STALE_FILE_PATTERN.exec(content);
  while (match !== null) {
    const path = match[1];
    if (path && !path.startsWith('//') && !path.startsWith('/*')) {
      matches.add(path);
    }
    match = STALE_FILE_PATTERN.exec(content);
  }

  return [...matches];
}

export function buildAdjacencyList(
  edges: ReadonlyArray<{ source: string; target: string }>,
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();

  for (const edge of edges) {
    if (!adj.has(edge.source)) {
      adj.set(edge.source, new Set());
    }
    if (!adj.has(edge.target)) {
      adj.set(edge.target, new Set());
    }
    adj.get(edge.source)?.add(edge.target);
    adj.get(edge.target)?.add(edge.source);
  }

  return adj;
}

export function bfs(
  startId: string,
  adjacency: Map<string, Set<string>>,
  maxDepth: number,
): string[] {
  const visited = new Set<string>([startId]);
  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
  const result: string[] = [startId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    if (current.depth >= maxDepth) {
      continue;
    }

    const neighbors = adjacency.get(current.id);
    if (!neighbors) {
      continue;
    }

    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        result.push(neighbor);
        queue.push({ id: neighbor, depth: current.depth + 1 });
      }
    }
  }

  return result;
}

export function generatePrincipleHint(facts: ReadonlyArray<MemoryFact>): string {
  const entityTypes = [...new Set(facts.map((f) => f.entity_type))];
  const typeLabel = entityTypes.length === 1 ? entityTypes[0] : 'mixed';
  const summaries = facts
    .slice(0, 5)
    .map((f) => f.content.slice(0, 80))
    .join('; ');

  return `[Auto-proposed principle from ${facts.length} ${typeLabel} facts] Synthesize: ${summaries}`;
}

function generateReportId(): string {
  const timestamp = Date.now().toString(36).padStart(10, '0');
  const random = Array.from({ length: 12 }, () => Math.floor(Math.random() * 36).toString(36)).join(
    '',
  );
  return `rpt_${timestamp}${random}`;
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function parseSource(value: unknown): MemoryFact['source'] {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as MemoryFact['source'];
    } catch {
      return {
        session_id: null,
        agent_id: null,
        machine_id: null,
        turn_index: null,
        extraction_method: 'manual',
      };
    }
  }

  return (value ?? {
    session_id: null,
    agent_id: null,
    machine_id: null,
    turn_index: null,
    extraction_method: 'manual',
  }) as MemoryFact['source'];
}

function rowToFact(row: Record<string, unknown>): MemoryFact {
  return {
    id: String(row.id),
    scope: row.scope as MemoryFact['scope'],
    content: String(row.content),
    content_model: String(row.content_model),
    entity_type: row.entity_type as MemoryFact['entity_type'],
    confidence: Number(row.confidence),
    strength: Number(row.strength),
    source: parseSource(row.source_json),
    valid_from: toIsoString(row.valid_from),
    valid_until: row.valid_until == null ? null : toIsoString(row.valid_until),
    created_at: toIsoString(row.created_at),
    accessed_at: toIsoString(row.accessed_at),
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    usage_count: Number(row.usage_count ?? 0),
  };
}
