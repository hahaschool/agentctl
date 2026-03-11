// ---------------------------------------------------------------------------
// Knowledge Synthesis — §3.6
//
// Phase 1 (lint): identifies candidate facts that need attention:
//   - near-duplicates: facts with high vector similarity (>0.85) but < 0.9
//     (those above 0.9 trigger contradiction detection instead)
//   - stale: active facts not accessed in 30+ days
//   - orphans: facts with no edges to other facts
//
// Phase 2 (synthesize): groups related facts by entity_type and proposes
//   higher-level principle candidates from those clusters.
//
// No LLM call is made — synthesis candidates are structural proposals that
// a human or separate LLM step can act on.
// ---------------------------------------------------------------------------

import type { Pool } from 'pg';
import type { Logger } from 'pino';

export type NearDuplicateCandidate = {
  factIdA: string;
  factIdB: string;
  similarity: number;
  contentA: string;
  contentB: string;
};

export type StaleFactCandidate = {
  factId: string;
  content: string;
  lastAccessedDaysAgo: number;
};

export type OrphanFactCandidate = {
  factId: string;
  content: string;
  entityType: string;
  createdAt: string;
};

export type SynthesisGroup = {
  entityType: string;
  factIds: string[];
  factContents: string[];
  proposalHint: string;
};

export type SynthesisLintResult = {
  nearDuplicates: NearDuplicateCandidate[];
  staleFacts: StaleFactCandidate[];
  orphanFacts: OrphanFactCandidate[];
};

export type SynthesisResult = {
  lint: SynthesisLintResult;
  synthesisGroups: SynthesisGroup[];
};

const NEAR_DUPLICATE_MIN = 0.85;
const NEAR_DUPLICATE_MAX = 0.9;
const STALE_DAYS = 30;
const MIN_GROUP_SIZE = 3;

export type KnowledgeSynthesisOptions = {
  pool: Pool;
  logger: Logger;
};

export class KnowledgeSynthesis {
  private readonly pool: Pool;
  private readonly logger: Logger;

  constructor(options: KnowledgeSynthesisOptions) {
    this.pool = options.pool;
    this.logger = options.logger;
  }

  async runSynthesis(scope?: string): Promise<SynthesisResult> {
    const [lint, synthesisGroups] = await Promise.all([
      this.runLint(scope),
      this.buildSynthesisGroups(scope),
    ]);

    this.logger.info(
      {
        nearDuplicates: lint.nearDuplicates.length,
        staleFacts: lint.staleFacts.length,
        orphanFacts: lint.orphanFacts.length,
        synthesisGroups: synthesisGroups.length,
      },
      'Knowledge synthesis complete',
    );

    return { lint, synthesisGroups };
  }

  private async runLint(scope?: string): Promise<SynthesisLintResult> {
    const [nearDuplicates, staleFacts, orphanFacts] = await Promise.all([
      this.findNearDuplicates(scope),
      this.findStaleFacts(scope),
      this.findOrphanFacts(scope),
    ]);

    return { nearDuplicates, staleFacts, orphanFacts };
  }

  private async findNearDuplicates(scope?: string): Promise<NearDuplicateCandidate[]> {
    // Self-join on embedding similarity: find pairs in the near-duplicate band
    // Uses pgvector <=> operator (cosine distance); similarity = 1 - distance
    const scopeClause = scope ? `AND a.scope = $3 AND b.scope = $3` : '';
    const params: unknown[] = [1 - NEAR_DUPLICATE_MIN, 1 - NEAR_DUPLICATE_MAX];
    if (scope) {
      params.push(scope);
    }

    const { rows } = await this.pool.query(
      `SELECT
         a.id AS fact_id_a,
         b.id AS fact_id_b,
         1 - (a.embedding <=> b.embedding) AS similarity,
         a.content AS content_a,
         b.content AS content_b
       FROM memory_facts a
       JOIN memory_facts b ON b.id > a.id
       WHERE a.valid_until IS NULL
         AND b.valid_until IS NULL
         AND a.embedding IS NOT NULL
         AND b.embedding IS NOT NULL
         AND (a.embedding <=> b.embedding) <= $1
         AND (a.embedding <=> b.embedding) > $2
         ${scopeClause}
       LIMIT 50`,
      params,
    );

    return (rows as Record<string, unknown>[]).map((row) => ({
      factIdA: String(row.fact_id_a),
      factIdB: String(row.fact_id_b),
      similarity: Number(row.similarity),
      contentA: String(row.content_a),
      contentB: String(row.content_b),
    }));
  }

  private async findStaleFacts(scope?: string): Promise<StaleFactCandidate[]> {
    const scopeClause = scope ? 'AND scope = $1' : '';
    const params: unknown[] = scope ? [scope] : [];

    const { rows } = await this.pool.query(
      `SELECT
         id AS fact_id,
         content,
         EXTRACT(EPOCH FROM (now() - accessed_at)) / 86400 AS days_since_access
       FROM memory_facts
       WHERE valid_until IS NULL
         AND accessed_at < now() - interval '${STALE_DAYS} days'
         AND strength > 0.05
         ${scopeClause}
       ORDER BY accessed_at ASC
       LIMIT 100`,
      params,
    );

    return (rows as Record<string, unknown>[]).map((row) => ({
      factId: String(row.fact_id),
      content: String(row.content),
      lastAccessedDaysAgo: Math.round(Number(row.days_since_access)),
    }));
  }

  private async findOrphanFacts(scope?: string): Promise<OrphanFactCandidate[]> {
    const scopeClause = scope ? 'AND f.scope = $1' : '';
    const params: unknown[] = scope ? [scope] : [];

    const { rows } = await this.pool.query(
      `SELECT
         f.id AS fact_id,
         f.content,
         f.entity_type,
         f.created_at
       FROM memory_facts f
       WHERE f.valid_until IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM memory_edges e
           WHERE e.source_fact_id = f.id OR e.target_fact_id = f.id
         )
         ${scopeClause}
       ORDER BY f.created_at ASC
       LIMIT 100`,
      params,
    );

    return (rows as Record<string, unknown>[]).map((row) => ({
      factId: String(row.fact_id),
      content: String(row.content),
      entityType: String(row.entity_type),
      createdAt:
        row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    }));
  }

  private async buildSynthesisGroups(scope?: string): Promise<SynthesisGroup[]> {
    // Group facts by entity_type; surface clusters with >= MIN_GROUP_SIZE facts
    // as synthesis candidates (potential higher-level principles)
    const scopeClause = scope ? 'AND scope = $1' : '';
    const params: unknown[] = scope ? [scope] : [];

    const { rows } = await this.pool.query(
      `SELECT
         entity_type,
         array_agg(id ORDER BY created_at DESC) AS fact_ids,
         array_agg(content ORDER BY created_at DESC) AS fact_contents,
         COUNT(*)::int AS fact_count
       FROM memory_facts
       WHERE valid_until IS NULL
         ${scopeClause}
       GROUP BY entity_type
       HAVING COUNT(*) >= ${MIN_GROUP_SIZE}
       ORDER BY fact_count DESC`,
      params,
    );

    return (rows as Record<string, unknown>[]).map((row) => {
      const entityType = String(row.entity_type);
      const factIds = Array.isArray(row.fact_ids) ? (row.fact_ids as unknown[]).map(String) : [];
      const factContents = Array.isArray(row.fact_contents)
        ? (row.fact_contents as unknown[]).map(String)
        : [];

      return {
        entityType,
        factIds: factIds.slice(0, 20),
        factContents: factContents.slice(0, 20),
        proposalHint: `Consider synthesising ${factIds.length} ${entityType} facts into a higher-level principle`,
      };
    });
  }
}
