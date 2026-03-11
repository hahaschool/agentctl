import type {
  EntityType,
  FactSource,
  InjectionBudget,
  MemoryFact,
  MemoryScope,
  MemorySearchResult,
} from '@agentctl/shared';
import { DEFAULT_INJECTION_BUDGET } from '@agentctl/shared';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import type { EmbeddingClient } from './embedding-client.js';

const RRF_K = 60;
const DEFAULT_LIMIT = 10;
const DEFAULT_CANDIDATE_LIMIT = 40;
const DEFAULT_STRENGTH_THRESHOLD = 0.05;

export type MemorySearchOptions = {
  pool: Pool;
  embeddingClient: EmbeddingClient;
  logger: Logger;
};

export type SearchInput = {
  query: string;
  visibleScopes: string[];
  limit?: number;
  entityType?: EntityType;
};

type RankedFact = {
  fact: MemoryFact;
  rank: number;
};

type FusedCandidate = {
  fact: MemoryFact;
  rrfScore: number;
};

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function parseSource(value: unknown): FactSource {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as FactSource;
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
  }) as FactSource;
}

export class MemorySearch {
  private readonly pool: Pool;
  private readonly embeddingClient: EmbeddingClient;
  private readonly logger: Logger;

  constructor(options: MemorySearchOptions) {
    this.pool = options.pool;
    this.embeddingClient = options.embeddingClient;
    this.logger = options.logger;
  }

  async search(input: SearchInput): Promise<MemorySearchResult[]> {
    const limit = input.limit ?? DEFAULT_LIMIT;
    const visibleScopes = input.visibleScopes;

    const vectorResults = await this.vectorSearch(
      input.query,
      visibleScopes,
      DEFAULT_CANDIDATE_LIMIT,
      input.entityType,
    );
    const bm25Results = await this.bm25Search(
      input.query,
      visibleScopes,
      DEFAULT_CANDIDATE_LIMIT,
      input.entityType,
    );
    const graphResults = await this.graphSearch(
      input.query,
      visibleScopes,
      DEFAULT_CANDIDATE_LIMIT,
    );

    const fused = new Map<string, { fact: MemoryFact; rrfScore: number; sources: Set<string> }>();

    const mergeResults = (results: RankedFact[], source: 'vector' | 'bm25' | 'graph') => {
      for (const { fact, rank } of results) {
        const score = 1 / (RRF_K + rank);
        const existing = fused.get(fact.id);
        if (existing) {
          existing.rrfScore += score;
          existing.sources.add(source);
        } else {
          fused.set(fact.id, {
            fact,
            rrfScore: score,
            sources: new Set([source]),
          });
        }
      }
    };

    mergeResults(vectorResults, 'vector');
    mergeResults(bm25Results, 'bm25');
    mergeResults(graphResults, 'graph');

    if (fused.size === 0) {
      return [];
    }

    const ranked = this.boostAndRank(
      [...fused.values()].map((candidate) => ({
        fact: candidate.fact,
        rrfScore: candidate.rrfScore,
      })),
      visibleScopes[0],
      DEFAULT_INJECTION_BUDGET,
    );

    const top = ranked.slice(0, limit);
    const topIds = top.map((entry) => entry.fact.id);
    if (topIds.length > 0) {
      void this.touchFacts(topIds).catch((error: unknown) => {
        this.logger.warn({ err: error, ids: topIds }, 'Failed to touch retrieved memory facts');
      });
    }

    return top.map(({ fact, score }) => {
      const sourceEntry = fused.get(fact.id);
      const sources = sourceEntry?.sources ?? new Set<string>();
      const source_path: MemorySearchResult['source_path'] = sources.has('vector')
        ? 'vector'
        : sources.has('bm25')
          ? 'bm25'
          : 'graph';

      return {
        fact,
        score,
        source_path,
      };
    });
  }

  boostAndRank(
    candidates: FusedCandidate[],
    queryScope: string | undefined,
    budget: InjectionBudget,
  ): Array<{ fact: MemoryFact; score: number }> {
    const now = Date.now();

    return candidates
      .map(({ fact, rrfScore }) => {
        const recencyMs = now - new Date(fact.accessed_at).getTime();
        const recencyDays = recencyMs / (1000 * 60 * 60 * 24);
        const recencyBoost = Math.max(0.1, 1 - recencyDays * 0.01);
        const scopeBoost = this.computeScopeBoost(fact.scope, queryScope);

        const score =
          rrfScore * budget.priorityWeights.relevance +
          recencyBoost * budget.priorityWeights.recency +
          Number(fact.strength) * budget.priorityWeights.strength +
          scopeBoost * budget.priorityWeights.scopeProximity;

        return { fact, score };
      })
      .sort((left, right) => right.score - left.score);
  }

  private computeScopeBoost(factScope: string, queryScope: string | undefined): number {
    if (!queryScope) return 1;
    if (factScope === queryScope) return 1.2;
    if (factScope.startsWith('project:') && queryScope.startsWith('agent:')) return 1.1;
    return 1;
  }

  private async vectorSearch(
    query: string,
    scopes: string[],
    limit: number,
    entityType?: EntityType,
  ): Promise<RankedFact[]> {
    let queryEmbedding: number[];
    try {
      queryEmbedding = await this.embeddingClient.embed(query);
    } catch (error: unknown) {
      this.logger.warn({ err: error }, 'Vector search skipped because embedding generation failed');
      return [];
    }

    const scopePlaceholders = scopes.map((_, index) => `$${index + 2}`).join(', ');
    const params: unknown[] = [`[${queryEmbedding.join(',')}]`, ...scopes];
    let sql = `
      SELECT id, scope, content, content_model, entity_type,
             confidence::real, strength::real, source_json,
             valid_from, valid_until, created_at, accessed_at,
             ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS rank
      FROM memory_facts
      WHERE scope IN (${scopePlaceholders})
        AND valid_until IS NULL
        AND strength > ${DEFAULT_STRENGTH_THRESHOLD}
        AND embedding IS NOT NULL`;

    if (entityType) {
      sql += ` AND entity_type = $${params.length + 1}`;
      params.push(entityType);
    }

    sql += ` ORDER BY embedding <=> $1::vector LIMIT $${params.length + 1}`;
    params.push(limit);

    const { rows } = await this.pool.query(sql, params);
    return (rows as Record<string, unknown>[]).map((row) => ({
      fact: this.rowToFact(row),
      rank: Number(row.rank),
    }));
  }

  private async bm25Search(
    query: string,
    scopes: string[],
    limit: number,
    entityType?: EntityType,
  ): Promise<RankedFact[]> {
    const tsQuery = query
      .split(/\s+/)
      .map((token) => token.replace(/[^a-zA-Z0-9]/g, ''))
      .filter((token) => token.length > 1)
      .join(' & ');

    if (!tsQuery) {
      return [];
    }

    const scopePlaceholders = scopes.map((_, index) => `$${index + 2}`).join(', ');
    const params: unknown[] = [tsQuery, ...scopes];
    let sql = `
      SELECT id, scope, content, content_model, entity_type,
             confidence::real, strength::real, source_json,
             valid_from, valid_until, created_at, accessed_at,
             ROW_NUMBER() OVER (
               ORDER BY ts_rank(content_tsv, to_tsquery('english', $1)) DESC
             ) AS rank
      FROM memory_facts
      WHERE content_tsv @@ to_tsquery('english', $1)
        AND scope IN (${scopePlaceholders})
        AND valid_until IS NULL
        AND strength > ${DEFAULT_STRENGTH_THRESHOLD}`;

    if (entityType) {
      sql += ` AND entity_type = $${params.length + 1}`;
      params.push(entityType);
    }

    sql += ` ORDER BY ts_rank(content_tsv, to_tsquery('english', $1)) DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const { rows } = await this.pool.query(sql, params);
    return (rows as Record<string, unknown>[]).map((row) => ({
      fact: this.rowToFact(row),
      rank: Number(row.rank),
    }));
  }

  private async graphSearch(query: string, scopes: string[], limit: number): Promise<RankedFact[]> {
    const keywords = query
      .split(/\s+/)
      .map((token) => token.replace(/[^a-zA-Z0-9_-]/g, ''))
      .filter((token) => token.length > 2)
      .slice(0, 5);

    if (keywords.length === 0) {
      return [];
    }

    const scopePlaceholders = scopes.map((_, index) => `$${index + 1}`).join(', ');
    const keywordPattern = keywords.join('|');
    const seedSql = `
      SELECT id
      FROM memory_facts
      WHERE scope IN (${scopePlaceholders})
        AND valid_until IS NULL
        AND strength > ${DEFAULT_STRENGTH_THRESHOLD}
        AND content ~* $${scopes.length + 1}
      LIMIT 10`;

    const seedResult = await this.pool.query(seedSql, [...scopes, keywordPattern]);
    const seedIds = (seedResult.rows as Array<{ id: string }>).map((row) => row.id);
    if (seedIds.length === 0) {
      return [];
    }

    const seedPlaceholders = seedIds.map((_, index) => `$${index + 1}`).join(', ');
    const traversalSql = `
      WITH RECURSIVE traversal AS (
        SELECT target_fact_id AS fact_id, 1 AS depth
        FROM memory_edges
        WHERE source_fact_id IN (${seedPlaceholders})
        UNION
        SELECT edge.target_fact_id, traversal.depth + 1
        FROM memory_edges AS edge
        JOIN traversal ON edge.source_fact_id = traversal.fact_id
        WHERE traversal.depth < 2
      )
      SELECT DISTINCT fact_id AS target_fact_id
      FROM traversal`;

    const traversalResult = await this.pool.query(traversalSql, seedIds);
    const graphFactIds = (traversalResult.rows as Array<{ target_fact_id: string }>).map(
      (row) => row.target_fact_id,
    );
    if (graphFactIds.length === 0) {
      return [];
    }

    const factIds = graphFactIds.slice(0, limit);
    const factPlaceholders = factIds.map((_, index) => `$${index + 1}`).join(', ');
    const factSql = `
      SELECT id, scope, content, content_model, entity_type,
             confidence::real, strength::real, source_json,
             valid_from, valid_until, created_at, accessed_at,
             ROW_NUMBER() OVER (ORDER BY strength DESC, created_at DESC) AS rank
      FROM memory_facts
      WHERE id IN (${factPlaceholders})
        AND valid_until IS NULL
        AND strength > ${DEFAULT_STRENGTH_THRESHOLD}`;

    const factResult = await this.pool.query(factSql, factIds);
    return (factResult.rows as Record<string, unknown>[]).map((row) => ({
      fact: this.rowToFact(row),
      rank: Number(row.rank),
    }));
  }

  private async touchFacts(ids: string[]): Promise<void> {
    const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ');
    await this.pool.query(
      `UPDATE memory_facts
       SET accessed_at = now(),
           strength = LEAST(1.0, strength + 0.05)
       WHERE id IN (${placeholders})`,
      ids,
    );
  }

  private rowToFact(row: Record<string, unknown>): MemoryFact {
    return {
      id: String(row.id),
      scope: row.scope as MemoryScope,
      content: String(row.content),
      content_model: String(row.content_model),
      entity_type: row.entity_type as EntityType,
      confidence: Number(row.confidence),
      strength: Number(row.strength),
      source: parseSource(row.source_json),
      valid_from: toIsoString(row.valid_from),
      valid_until: row.valid_until == null ? null : toIsoString(row.valid_until),
      created_at: toIsoString(row.created_at),
      accessed_at: toIsoString(row.accessed_at),
    };
  }
}
