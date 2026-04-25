import type {
  EntityType,
  FactSource,
  InjectionBudget,
  MemoryFact,
  MemoryScope,
  MemorySearchResult,
} from '@agentctl/shared';
import { DEFAULT_INJECTION_BUDGET, querySanitizerLogFields, sanitizeQuery } from '@agentctl/shared';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import type { EmbeddingClient } from './embedding-client.js';
import type { EmbeddingClientResolver } from './embedding-client-factory.js';

const RRF_K = 60;
const DEFAULT_LIMIT = 10;
const DEFAULT_CANDIDATE_LIMIT = 40;
const DEFAULT_STRENGTH_THRESHOLD = 0.05;

// Rank-bucket boost constants — additive on RRF score, capped at MAX_BOOST
const BOOST_ENTITY_TYPE = 0.03; // agent or session facts are more relevant in orchestration context
const BOOST_RECENCY_24H = 0.05; // created within the last 24 hours
const BOOST_RECENCY_7D = 0.02; // created within the last 7 days (but not < 24h)
const BOOST_SCOPE_EXACT = 0.02; // fact scope exactly matches the primary visible scope
const MAX_BOOST = 0.1;

export type MemorySearchOptions = {
  pool: Pool;
  embeddingClient?: EmbeddingClient;
  embeddingClientResolver?: EmbeddingClientResolver;
  logger: Logger;
};

export type SearchInput = {
  query: string;
  visibleScopes: string[];
  limit?: number;
  entityType?: EntityType;
  role?: string;
};

type RankedFact = {
  fact: MemoryFact;
  rank: number;
};

type FusedCandidate = {
  fact: MemoryFact;
  rrfScore: number;
};

// RrfCandidate is a public alias so boostScore can be tested without referencing private internals.
export type RrfCandidate = FusedCandidate;

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

/**
 * Compute an additive rank-bucket boost for a fused RRF candidate.
 *
 * The boost is intentionally small (≤ MAX_BOOST = 0.10) so that it nudges
 * relevance without overriding text-match quality. Factors:
 *  - entity_type 'agent' or 'session' (+0.03): most relevant in orchestration
 *  - created within 24 hours             (+0.05): very fresh knowledge
 *  - created within 7 days but not 24h   (+0.02): recently added
 *  - scope exactly matches primary scope  (+0.02): precise context match
 */
export function boostScore(
  candidate: RrfCandidate,
  input: Pick<SearchInput, 'visibleScopes'>,
): number {
  const { fact } = candidate;
  let boost = 0;

  // Entity-type boost — 'agent' and 'session' may appear in rows even though
  // they are not yet in the shared EntityType union (DB can hold any string).
  const entityType = fact.entity_type as string;
  if (entityType === 'agent' || entityType === 'session') {
    boost += BOOST_ENTITY_TYPE;
  }

  // Recency boost
  const createdAt = new Date(fact.created_at).getTime();
  const ageMs = Date.now() - createdAt;
  const msIn24h = 24 * 60 * 60 * 1000;
  const msIn7d = 7 * msIn24h;
  if (ageMs >= 0 && ageMs < msIn24h) {
    boost += BOOST_RECENCY_24H;
  } else if (ageMs >= msIn24h && ageMs < msIn7d) {
    boost += BOOST_RECENCY_7D;
  }

  // Scope exact-match boost (primary scope only — not a broad wildcard pass)
  const primaryScope = input.visibleScopes[0];
  if (primaryScope !== undefined && primaryScope !== '' && fact.scope === primaryScope) {
    boost += BOOST_SCOPE_EXACT;
  }

  return Math.min(boost, MAX_BOOST);
}

function buildScopeCondition(
  scopes: string[],
  startIndex: number,
): { clause: string; params: unknown[] } {
  if (scopes.length === 0) {
    return { clause: '', params: [] };
  }

  const placeholders = scopes.map((_, index) => `$${startIndex + index}`).join(', ');
  return {
    clause: ` AND scope IN (${placeholders})`,
    params: scopes,
  };
}

export class MemorySearch {
  private readonly pool: Pool;
  private readonly embeddingClient: EmbeddingClient | undefined;
  private readonly embeddingClientResolver: EmbeddingClientResolver | undefined;
  private readonly logger: Logger;

  constructor(options: MemorySearchOptions) {
    this.pool = options.pool;
    this.embeddingClient = options.embeddingClient;
    this.embeddingClientResolver = options.embeddingClientResolver;
    this.logger = options.logger;
  }

  async search(input: SearchInput): Promise<MemorySearchResult[]> {
    const limit = input.limit ?? DEFAULT_LIMIT;
    const visibleScopes = input.visibleScopes;
    const sanitizedQuery = sanitizeQuery(input.query);
    this.logger.debug(querySanitizerLogFields(sanitizedQuery), 'Sanitized memory search query');
    if (sanitizedQuery.stage === 'empty') {
      return [];
    }

    const vectorResults = await this.vectorSearch(
      sanitizedQuery.query,
      visibleScopes,
      DEFAULT_CANDIDATE_LIMIT,
      input.entityType,
    );
    const bm25Results = await this.bm25Search(
      sanitizedQuery.query,
      visibleScopes,
      DEFAULT_CANDIDATE_LIMIT,
      input.entityType,
    );
    const graphResults = await this.graphSearch(
      sanitizedQuery.query,
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
      [...fused.values()].map((candidate) => {
        const base: RrfCandidate = { fact: candidate.fact, rrfScore: candidate.rrfScore };
        const boosted = boostScore(base, input);
        return { fact: candidate.fact, rrfScore: candidate.rrfScore + boosted };
      }),
      visibleScopes[0],
      DEFAULT_INJECTION_BUDGET,
      input.role,
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
    role?: string,
  ): Array<{ fact: MemoryFact; score: number }> {
    const now = Date.now();

    return candidates
      .map(({ fact, rrfScore }) => {
        const recencyMs = now - new Date(fact.accessed_at).getTime();
        const recencyDays = recencyMs / (1000 * 60 * 60 * 24);
        const recencyBoost = Math.max(0.1, 1 - recencyDays * 0.01);
        const scopeBoost = this.computeScopeBoost(fact.scope, queryScope);
        const roleAffinityMultiplier = this.computeRoleAffinityMultiplier(fact, role);

        const baseScore =
          rrfScore * budget.priorityWeights.relevance +
          recencyBoost * budget.priorityWeights.recency +
          Number(fact.strength) * budget.priorityWeights.strength +
          scopeBoost * budget.priorityWeights.scopeProximity;

        const score = baseScore * roleAffinityMultiplier;

        return { fact, score };
      })
      .sort((left, right) => right.score - left.score);
  }

  private computeRoleAffinityMultiplier(fact: MemoryFact, role: string | undefined): number {
    if (!role) return 1.0;
    if (Array.isArray(fact.tags) && fact.tags.includes(role)) return 1.5;
    return 1.0;
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
    let queryModel: string;
    try {
      const resolved = await this.resolveEmbeddingClientForSearch();
      if (!resolved) {
        return [];
      }
      queryModel = resolved.model;
      queryEmbedding = await resolved.client.embed(query);
    } catch (error: unknown) {
      this.logger.warn({ err: error }, 'Vector search skipped because embedding generation failed');
      return [];
    }

    const scopeCondition = buildScopeCondition(scopes, 3);
    const params: unknown[] = [
      `[${queryEmbedding.join(',')}]`,
      queryModel,
      ...scopeCondition.params,
    ];
    let sql = `
      SELECT id, scope, content, content_model, entity_type,
             confidence::real, strength::real, source_json,
             valid_from, valid_until, created_at, accessed_at,
             tags, usage_count,
             ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS rank
      FROM memory_facts
      WHERE valid_until IS NULL
        AND strength > ${DEFAULT_STRENGTH_THRESHOLD}
        AND embedding IS NOT NULL
        AND content_model = $2${scopeCondition.clause}`;

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

  private async resolveEmbeddingClientForSearch(): Promise<
    { client: EmbeddingClient; model: string } | undefined
  > {
    if (this.embeddingClientResolver) {
      return this.embeddingClientResolver();
    }
    if (!this.embeddingClient) {
      return undefined;
    }
    return { client: this.embeddingClient, model: 'text-embedding-3-small' };
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

    const scopeCondition = buildScopeCondition(scopes, 2);
    const params: unknown[] = [tsQuery, ...scopeCondition.params];
    let sql = `
      SELECT id, scope, content, content_model, entity_type,
             confidence::real, strength::real, source_json,
             valid_from, valid_until, created_at, accessed_at,
             tags, usage_count,
             ROW_NUMBER() OVER (
               ORDER BY ts_rank(content_tsv, to_tsquery('english', $1)) DESC
             ) AS rank
      FROM memory_facts
      WHERE content_tsv @@ to_tsquery('english', $1)
        AND valid_until IS NULL
        AND strength > ${DEFAULT_STRENGTH_THRESHOLD}${scopeCondition.clause}`;

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

    const scopeCondition = buildScopeCondition(scopes, 1);
    const keywordPattern = keywords.join('|');
    const seedSql = `
      SELECT id
      FROM memory_facts
      WHERE valid_until IS NULL
        AND strength > ${DEFAULT_STRENGTH_THRESHOLD}
        AND content ~* $${scopeCondition.params.length + 1}${scopeCondition.clause}
      LIMIT 10`;

    const seedResult = await this.pool.query(seedSql, [...scopeCondition.params, keywordPattern]);
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
             tags, usage_count,
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
      tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
      usage_count: Number(row.usage_count ?? 0),
    };
  }
}
