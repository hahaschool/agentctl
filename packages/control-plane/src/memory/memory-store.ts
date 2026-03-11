import type {
  EntityType,
  FactSource,
  MemoryEdge,
  MemoryFact,
  MemoryScope,
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
};

export type AddEdgeInput = {
  source_fact_id: string;
  target_fact_id: string;
  relation: RelationType;
  weight?: number;
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
         confidence, strength, source_json, valid_from, created_at, accessed_at
       ) VALUES (
         $1, $2, $3, $4::vector, $5, $6, $7, $8, $9, $10, $10, $10
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
      ],
    );

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

    return {
      id,
      source_fact_id: input.source_fact_id,
      target_fact_id: input.target_fact_id,
      relation: input.relation,
      weight: input.weight ?? 0.5,
      created_at: now,
    };
  }

  async getFact(id: string): Promise<MemoryFact | null> {
    const { rows } = await this.pool.query(
      `SELECT id, scope, content, content_model, entity_type,
              confidence::real, strength::real, source_json,
              valid_from, valid_until, created_at, accessed_at
       FROM memory_facts
       WHERE id = $1`,
      [id],
    );

    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? this.rowToFact(row) : null;
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

  resolveVisibleScopes(agentScope?: string, projectScope?: string): string[] {
    const scopes = [agentScope, projectScope, 'global'].filter(
      (scope): scope is string => typeof scope === 'string' && scope.length > 0,
    );
    return [...new Set(scopes)];
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
