import type {
  ConsolidationItem,
  ConsolidationItemType,
  ConsolidationSeverity,
  EntityType,
  FactSource,
  FeedbackSignal,
  MemoryEdge,
  MemoryFact,
  MemoryScope,
  MemoryStats,
  RelationType,
} from '@agentctl/shared';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import type { EmbeddingClient } from './embedding-client.js';

const DEFAULT_CONTENT_MODEL = 'text-embedding-3-small';

export type MemoryStoreOptions = {
  pool: Pool;
  embeddingClient: EmbeddingClient;
  logger: Logger;
};

export type AddFactInput = {
  scope: MemoryScope;
  content: string;
  entity_type: EntityType;
  source: FactSource;
  confidence?: number;
  tags?: string[];
};

export type AddConsolidationItemInput = {
  type: ConsolidationItemType;
  severity: ConsolidationSeverity;
  factIds: string[];
  suggestion: string;
  reason: string;
};

export type AddEdgeInput = {
  source_fact_id: string;
  target_fact_id: string;
  relation: RelationType;
  weight?: number;
};

export type ListFactsInput = {
  visibleScopes?: string[];
  scope?: MemoryScope;
  entityType?: EntityType;
  sessionId?: string;
  agentId?: string;
  machineId?: string;
  minConfidence?: number;
  limit?: number;
  offset?: number;
};

export type UpdateFactInput = {
  scope?: MemoryScope;
  content?: string;
  entity_type?: EntityType;
  confidence?: number;
  strength?: number;
};

export type ListEdgesInput = {
  sourceFactId?: string;
  targetFactId?: string;
  factId?: string;
  factIds?: string[];
};

function generateMemoryId(): string {
  const timestamp = Date.now().toString(36).padStart(10, '0');
  const random = Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join(
    '',
  );
  return `${timestamp}${random}`;
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function toDateKey(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
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

export class MemoryStore {
  private readonly pool: Pool;
  private readonly embeddingClient: EmbeddingClient;
  private readonly logger: Logger;

  constructor(options: MemoryStoreOptions) {
    this.pool = options.pool;
    this.embeddingClient = options.embeddingClient;
    this.logger = options.logger;
  }

  async addFact(input: AddFactInput): Promise<MemoryFact> {
    const id = generateMemoryId();
    const now = new Date().toISOString();
    const tags = input.tags ?? [];

    let embeddingLiteral: string | null = null;
    try {
      const embedding = await this.embeddingClient.embed(input.content);
      embeddingLiteral = `[${embedding.join(',')}]`;
    } catch (error: unknown) {
      this.logger.warn(
        { err: error, factId: id },
        'Failed to generate embedding; storing fact without vector',
      );
    }

    await this.pool.query(
      `INSERT INTO memory_facts (
         id, scope, content, embedding, content_model, entity_type,
         confidence, strength, source_json, valid_from, created_at, accessed_at,
         tags
       ) VALUES (
         $1, $2, $3, $4::vector, $5, $6, $7, $8, $9, $10, $10, $10,
         $11
       )`,
      [
        id,
        input.scope,
        input.content,
        embeddingLiteral,
        DEFAULT_CONTENT_MODEL,
        input.entity_type,
        input.confidence ?? 0.8,
        1.0,
        input.source,
        now,
        tags,
      ],
    );

    await this.detectAndFlagContradictions(id);

    return {
      id,
      scope: input.scope,
      content: input.content,
      content_model: DEFAULT_CONTENT_MODEL,
      entity_type: input.entity_type,
      confidence: input.confidence ?? 0.8,
      strength: 1.0,
      source: input.source,
      valid_from: now,
      valid_until: null,
      created_at: now,
      accessed_at: now,
      tags,
      usage_count: 0,
    };
  }

  async addEdge(input: AddEdgeInput): Promise<MemoryEdge> {
    const id = generateMemoryId();
    const now = new Date().toISOString();

    await this.pool.query(
      `INSERT INTO memory_edges (id, source_fact_id, target_fact_id, relation, weight, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (source_fact_id, target_fact_id, relation)
       DO UPDATE SET weight = EXCLUDED.weight`,
      [id, input.source_fact_id, input.target_fact_id, input.relation, input.weight ?? 0.5, now],
    );

    if (input.relation === 'contradicts') {
      await this.addConsolidationItem({
        type: 'contradiction',
        severity: 'high',
        factIds: [input.source_fact_id, input.target_fact_id],
        suggestion: 'Review and resolve contradicting facts',
        reason: `Facts ${input.source_fact_id} and ${input.target_fact_id} are marked as contradicting each other`,
      });
    }

    return {
      id,
      source_fact_id: input.source_fact_id,
      target_fact_id: input.target_fact_id,
      relation: input.relation,
      weight: input.weight ?? 0.5,
      created_at: now,
    };
  }

  async recordFeedback(id: string, signal: FeedbackSignal): Promise<MemoryFact | null> {
    if (signal === 'used') {
      await this.pool.query(
        `UPDATE memory_facts
         SET usage_count = usage_count + 1,
             strength = LEAST(1.0, strength + 0.1),
             accessed_at = now()
         WHERE id = $1`,
        [id],
      );
    } else if (signal === 'irrelevant') {
      await this.pool.query(
        `UPDATE memory_facts
         SET strength = GREATEST(0.0, strength - 0.1),
             accessed_at = now()
         WHERE id = $1`,
        [id],
      );
    } else if (signal === 'outdated') {
      await this.pool.query(
        `UPDATE memory_facts
         SET confidence = GREATEST(0.0, confidence - 0.2),
             accessed_at = now()
         WHERE id = $1`,
        [id],
      );
      await this.addConsolidationItem({
        type: 'stale',
        severity: 'medium',
        factIds: [id],
        suggestion: 'Review and update or invalidate this outdated fact',
        reason: `Fact ${id} was flagged as outdated via feedback signal`,
      });
    }

    return this.getFact(id);
  }

  async addConsolidationItem(input: AddConsolidationItemInput): Promise<ConsolidationItem> {
    const id = generateMemoryId();
    const now = new Date().toISOString();

    await this.pool.query(
      `INSERT INTO memory_consolidation_items
         (id, type, severity, fact_ids, suggestion, reason, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
      [id, input.type, input.severity, input.factIds, input.suggestion, input.reason, now],
    );

    return {
      id,
      type: input.type,
      severity: input.severity,
      factIds: input.factIds,
      suggestion: input.suggestion,
      reason: input.reason,
      status: 'pending',
      createdAt: now,
    };
  }

  async getFact(id: string): Promise<MemoryFact | null> {
    const { rows } = await this.pool.query(
      `SELECT id, scope, content, content_model, entity_type,
              confidence::real, strength::real, source_json,
              valid_from, valid_until, created_at, accessed_at,
              tags, usage_count
       FROM memory_facts
       WHERE id = $1`,
      [id],
    );

    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? this.rowToFact(row) : null;
  }

  async listFacts(input: ListFactsInput = {}): Promise<MemoryFact[]> {
    const params: unknown[] = [];
    const conditions = ['valid_until IS NULL'];

    if (input.visibleScopes && input.visibleScopes.length > 0) {
      const placeholders = input.visibleScopes.map((_, index) => `$${params.length + index + 1}`);
      params.push(...input.visibleScopes);
      conditions.push(`scope IN (${placeholders.join(', ')})`);
    }

    if (input.scope) {
      params.push(input.scope);
      conditions.push(`scope = $${params.length}`);
    }

    if (input.entityType) {
      params.push(input.entityType);
      conditions.push(`entity_type = $${params.length}`);
    }

    if (input.sessionId) {
      params.push(input.sessionId);
      conditions.push(`source_json->>'session_id' = $${params.length}`);
    }

    if (input.agentId) {
      params.push(input.agentId);
      conditions.push(`source_json->>'agent_id' = $${params.length}`);
    }

    if (input.machineId) {
      params.push(input.machineId);
      conditions.push(`source_json->>'machine_id' = $${params.length}`);
    }

    if (input.minConfidence !== undefined) {
      params.push(input.minConfidence);
      conditions.push(`confidence >= $${params.length}`);
    }

    const limit = input.limit ?? 100;
    const offset = input.offset ?? 0;
    params.push(limit);
    params.push(offset);

    const { rows } = await this.pool.query(
      `SELECT id, scope, content, content_model, entity_type,
              confidence::real, strength::real, source_json,
              valid_from, valid_until, created_at, accessed_at,
              tags, usage_count
       FROM memory_facts
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1}
       OFFSET $${params.length}`,
      params,
    );

    return (rows as Record<string, unknown>[]).map((row) => this.rowToFact(row));
  }

  async deleteFact(id: string): Promise<void> {
    await this.pool.query('DELETE FROM memory_facts WHERE id = $1', [id]);
  }

  async updateStrength(id: string, strength: number): Promise<void> {
    await this.pool.query(
      'UPDATE memory_facts SET strength = $2, accessed_at = now() WHERE id = $1',
      [id, strength],
    );
  }

  async invalidateFact(id: string): Promise<void> {
    await this.pool.query('UPDATE memory_facts SET valid_until = now() WHERE id = $1', [id]);
  }

  async updateFact(id: string, input: UpdateFactInput): Promise<MemoryFact | null> {
    const params: unknown[] = [id];
    const assignments: string[] = [];

    if (input.scope) {
      params.push(input.scope);
      assignments.push(`scope = $${params.length}`);
    }

    if (input.content !== undefined) {
      params.push(input.content);
      assignments.push(`content = $${params.length}`);

      let embeddingLiteral: string | null = null;
      try {
        const embedding = await this.embeddingClient.embed(input.content);
        embeddingLiteral = `[${embedding.join(',')}]`;
      } catch (error: unknown) {
        this.logger.warn(
          { err: error, factId: id },
          'Failed to regenerate embedding while updating memory fact',
        );
      }

      params.push(embeddingLiteral);
      assignments.push(`embedding = $${params.length}::vector`);
      params.push(DEFAULT_CONTENT_MODEL);
      assignments.push(`content_model = $${params.length}`);
    }

    if (input.entity_type) {
      params.push(input.entity_type);
      assignments.push(`entity_type = $${params.length}`);
    }

    if (input.confidence !== undefined) {
      params.push(input.confidence);
      assignments.push(`confidence = $${params.length}`);
    }

    if (input.strength !== undefined) {
      params.push(input.strength);
      assignments.push(`strength = $${params.length}`);
    }

    if (assignments.length === 0) {
      return this.getFact(id);
    }

    assignments.push('accessed_at = now()');

    await this.pool.query(
      `UPDATE memory_facts
       SET ${assignments.join(', ')}
       WHERE id = $1`,
      params,
    );

    return this.getFact(id);
  }

  async listEdges(input: ListEdgesInput = {}): Promise<MemoryEdge[]> {
    if (input.factIds && input.factIds.length === 0) {
      return [];
    }

    const params: unknown[] = [];
    const conditions: string[] = [];

    if (input.sourceFactId) {
      params.push(input.sourceFactId);
      conditions.push(`source_fact_id = $${params.length}`);
    }

    if (input.targetFactId) {
      params.push(input.targetFactId);
      conditions.push(`target_fact_id = $${params.length}`);
    }

    if (input.factId) {
      params.push(input.factId);
      conditions.push(`(source_fact_id = $${params.length} OR target_fact_id = $${params.length})`);
    }

    if (input.factIds && input.factIds.length > 0) {
      params.push(input.factIds);
      conditions.push(
        `(source_fact_id = ANY($${params.length}::text[]) OR target_fact_id = ANY($${params.length}::text[]))`,
      );
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await this.pool.query(
      `SELECT id, source_fact_id, target_fact_id, relation, weight::real, created_at
       FROM memory_edges
       ${whereClause}
       ORDER BY created_at DESC`,
      params,
    );

    return (rows as Record<string, unknown>[]).map((row) => this.rowToEdge(row));
  }

  async deleteEdge(id: string): Promise<void> {
    await this.pool.query('DELETE FROM memory_edges WHERE id = $1', [id]);
  }

  async getStats(): Promise<MemoryStats> {
    const [summaryResult, scopeResult, entityTypeResult, strengthResult, growthResult] =
      await Promise.all([
        this.pool.query(
          `SELECT COUNT(*)::int AS total_facts,
                  COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS new_this_week,
                  COALESCE(AVG(confidence), 0)::real AS avg_confidence
           FROM memory_facts
           WHERE valid_until IS NULL`,
        ),
        this.pool.query(
          `SELECT scope AS key, COUNT(*)::int AS count
           FROM memory_facts
           WHERE valid_until IS NULL
           GROUP BY scope`,
        ),
        this.pool.query(
          `SELECT entity_type AS key, COUNT(*)::int AS count
           FROM memory_facts
           WHERE valid_until IS NULL
           GROUP BY entity_type`,
        ),
        this.pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE strength > 0.5)::int AS active,
             COUNT(*) FILTER (WHERE strength > 0.05 AND strength <= 0.5)::int AS decaying,
             COUNT(*) FILTER (WHERE strength <= 0.05)::int AS archived
           FROM memory_facts
           WHERE valid_until IS NULL`,
        ),
        this.pool.query(
          `SELECT DATE(created_at) AS date, COUNT(*)::int AS count
           FROM memory_facts
           WHERE valid_until IS NULL
             AND created_at >= now() - interval '30 days'
           GROUP BY DATE(created_at)
           ORDER BY DATE(created_at)`,
        ),
      ]);

    const summaryRow = (summaryResult.rows[0] ?? {}) as Record<string, unknown>;
    const strengthRow = (strengthResult.rows[0] ?? {}) as Record<string, unknown>;

    return {
      totalFacts: Number(summaryRow.total_facts ?? 0),
      newThisWeek: Number(summaryRow.new_this_week ?? 0),
      avgConfidence: Number(summaryRow.avg_confidence ?? 0),
      pendingConsolidation: 0,
      byScope: Object.fromEntries(
        (scopeResult.rows as Record<string, unknown>[]).map((row) => [
          String(row.key),
          Number(row.count ?? 0),
        ]),
      ),
      byEntityType: Object.fromEntries(
        (entityTypeResult.rows as Record<string, unknown>[]).map((row) => [
          String(row.key),
          Number(row.count ?? 0),
        ]),
      ),
      strengthDistribution: {
        active: Number(strengthRow.active ?? 0),
        decaying: Number(strengthRow.decaying ?? 0),
        archived: Number(strengthRow.archived ?? 0),
      },
      growthTrend: (growthResult.rows as Record<string, unknown>[]).map((row) => ({
        date: toDateKey(row.date),
        count: Number(row.count ?? 0),
      })),
    };
  }

  resolveVisibleScopes(agentScope?: string, projectScope?: string): string[] {
    const scopes = [agentScope, projectScope, 'global'].filter(
      (scope): scope is string => typeof scope === 'string' && scope.length > 0,
    );
    return [...new Set(scopes)];
  }

  private async detectAndFlagContradictions(newFactId: string): Promise<void> {
    // Phase 1: flag pre-existing contradicts edges
    const { rows } = await this.pool.query(
      `SELECT source_fact_id, target_fact_id
       FROM memory_edges
       WHERE relation = 'contradicts'
         AND (source_fact_id = $1 OR target_fact_id = $1)`,
      [newFactId],
    );

    for (const row of rows as Array<{ source_fact_id: string; target_fact_id: string }>) {
      await this.addConsolidationItem({
        type: 'contradiction',
        severity: 'high',
        factIds: [row.source_fact_id, row.target_fact_id],
        suggestion: 'Review and resolve contradicting facts',
        reason: `New fact ${newFactId} has pre-existing contradicts relationship`,
      });
    }

    // Phase 2: detect semantic contradictions via vector similarity (>0.9 cosine similarity)
    await this.detectSemanticContradictions(newFactId);
  }

  private async detectSemanticContradictions(newFactId: string): Promise<void> {
    // Fetch the new fact's embedding
    const factResult = await this.pool.query(
      `SELECT content, embedding
       FROM memory_facts
       WHERE id = $1 AND embedding IS NOT NULL`,
      [newFactId],
    );

    const factRow = factResult.rows[0] as Record<string, unknown> | undefined;
    if (!factRow) {
      return;
    }

    const newContent = String(factRow.content);
    const embeddingRaw = factRow.embedding;
    if (!embeddingRaw) {
      return;
    }

    // Find facts with cosine similarity > 0.9 but different content
    const SIMILARITY_THRESHOLD = 0.9;
    const { rows: similarRows } = await this.pool.query(
      `SELECT id, content,
              1 - (embedding <=> $1::vector) AS cosine_similarity
       FROM memory_facts
       WHERE id <> $2
         AND valid_until IS NULL
         AND embedding IS NOT NULL
         AND 1 - (embedding <=> $1::vector) > $3`,
      [embeddingRaw, newFactId, SIMILARITY_THRESHOLD],
    );

    for (const row of similarRows as Array<{
      id: string;
      content: string;
      cosine_similarity: number;
    }>) {
      // Only flag as contradictions when content differs meaningfully
      if (row.content === newContent) {
        continue;
      }

      // Check if a contradicts edge already exists between these facts
      const { rows: existingEdge } = await this.pool.query(
        `SELECT id FROM memory_edges
         WHERE relation = 'contradicts'
           AND (
             (source_fact_id = $1 AND target_fact_id = $2)
             OR (source_fact_id = $2 AND target_fact_id = $1)
           )`,
        [newFactId, row.id],
      );

      if ((existingEdge as unknown[]).length > 0) {
        continue;
      }

      // Create a contradicts edge between the two facts
      await this.addEdge({
        source_fact_id: newFactId,
        target_fact_id: row.id,
        relation: 'contradicts',
        weight: Number(row.cosine_similarity),
      });
    }
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

  private rowToEdge(row: Record<string, unknown>): MemoryEdge {
    return {
      id: String(row.id),
      source_fact_id: String(row.source_fact_id),
      target_fact_id: String(row.target_fact_id),
      relation: row.relation as RelationType,
      weight: Number(row.weight),
      created_at: toIsoString(row.created_at),
    };
  }
}
