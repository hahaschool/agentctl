import type { MemoryDrawer } from '@agentctl/shared';
import {
  MEMORY_EMBEDDING_MODEL,
  MEMORY_EMBEDDING_VERSION,
  redactKeys,
  sanitizeName,
} from '@agentctl/shared';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import type { EmbeddingClient } from './embedding-client.js';
import { chunkMemoryDrawerContent } from './memory-drawer-chunker.js';
import { hashMemoryDrawerContent, sanitizeMemoryDrawerContent } from './memory-drawer-sanitizer.js';
import type {
  WriteMemoryDrawerSourceInput,
  WriteMemoryDrawerSourceResult,
} from './memory-drawer-types.js';

export type MemoryDrawerStoreOptions = {
  pool: Pool;
  embeddingClient?: EmbeddingClient;
  logger: Logger;
};

type MemoryDrawerRow = {
  id: string;
  scope: string;
  topic: string;
  source_type: string;
  source_id: string;
  source_uri: string | null;
  chunk_index: number;
  content: string;
  content_sha256: string;
  embedding_model: string;
  embedding_version: number;
  token_count: number;
  source_json: Record<string, unknown>;
  sync_visibility: string;
  retention_expires_at: Date | string | null;
  archived_at: Date | string | null;
  redaction_status: string;
  created_at: Date | string;
  updated_at: Date | string;
};

function generateMemoryDrawerId(): string {
  const timestamp = Date.now().toString(36).padStart(10, '0');
  const random = Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join(
    '',
  );
  return `${timestamp}${random}`;
}

function estimateTokenCount(content: string): number {
  return Math.ceil(content.length / 4);
}

function toIso(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

function rowToDrawer(row: MemoryDrawerRow): MemoryDrawer {
  return {
    id: row.id,
    scope: row.scope as MemoryDrawer['scope'],
    topic: row.topic,
    sourceType: row.source_type as MemoryDrawer['sourceType'],
    sourceId: row.source_id,
    sourceUri: row.source_uri,
    chunkIndex: row.chunk_index,
    content: row.content,
    contentSha256: row.content_sha256,
    embeddingModel: row.embedding_model,
    embeddingVersion: Number(row.embedding_version),
    tokenCount: Number(row.token_count),
    sourceJson: row.source_json ?? {},
    syncVisibility: row.sync_visibility as MemoryDrawer['syncVisibility'],
    retentionExpiresAt: toIso(row.retention_expires_at),
    archivedAt: toIso(row.archived_at),
    redactionStatus: row.redaction_status as MemoryDrawer['redactionStatus'],
    createdAt: toIso(row.created_at) ?? String(row.created_at),
    updatedAt: toIso(row.updated_at) ?? String(row.updated_at),
  };
}

export class MemoryDrawerStore {
  private readonly pool: Pool;
  private readonly embeddingClient: EmbeddingClient | undefined;
  private readonly logger: Logger;

  constructor(options: MemoryDrawerStoreOptions) {
    this.pool = options.pool;
    this.embeddingClient = options.embeddingClient;
    this.logger = options.logger;
  }

  async writeSource(input: WriteMemoryDrawerSourceInput): Promise<WriteMemoryDrawerSourceResult> {
    const sanitizedScope = sanitizeName(input.scope) as WriteMemoryDrawerSourceInput['scope'];
    const sanitizedTopic = sanitizeName(input.topic ?? 'general');
    const sanitized = sanitizeMemoryDrawerContent(input.content);
    const chunks = chunkMemoryDrawerContent(sanitized.content);
    const sourceJson = redactKeys(input.sourceJson ?? {});
    const embeddings = await this.embedChunks(chunks.map((chunk) => chunk.content));
    const drawers: MemoryDrawer[] = [];

    for (const chunk of chunks) {
      const embedding = embeddings[chunk.chunkIndex];
      const embeddingLiteral = embedding ? `[${embedding.join(',')}]` : null;
      const contentSha256 = hashMemoryDrawerContent(chunk.content);

      const result = await this.pool.query(
        `INSERT INTO memory_drawers (
           id, scope, topic, source_type, source_id, source_uri, chunk_index,
           content, content_sha256, embedding, embedding_model, embedding_version,
           token_count, source_json, sync_visibility, retention_expires_at,
           archived_at, redaction_status
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10::vector, $11, $12,
           $13, $14, $15, $16,
           $17, $18
         )
         ON CONFLICT (source_type, source_id, chunk_index)
         DO UPDATE SET
           scope = EXCLUDED.scope,
           topic = EXCLUDED.topic,
           source_uri = EXCLUDED.source_uri,
           content = EXCLUDED.content,
           content_sha256 = EXCLUDED.content_sha256,
           embedding = EXCLUDED.embedding,
           embedding_model = EXCLUDED.embedding_model,
           embedding_version = EXCLUDED.embedding_version,
           token_count = EXCLUDED.token_count,
           source_json = EXCLUDED.source_json,
           sync_visibility = EXCLUDED.sync_visibility,
           retention_expires_at = EXCLUDED.retention_expires_at,
           archived_at = EXCLUDED.archived_at,
           redaction_status = EXCLUDED.redaction_status,
           updated_at = now()
         RETURNING id, scope, topic, source_type, source_id, source_uri, chunk_index,
           content, content_sha256, embedding_model, embedding_version, token_count,
           source_json, sync_visibility, retention_expires_at, archived_at,
           redaction_status, created_at, updated_at`,
        [
          generateMemoryDrawerId(),
          sanitizedScope,
          sanitizedTopic,
          input.sourceType,
          input.sourceId,
          input.sourceUri ?? null,
          chunk.chunkIndex,
          chunk.content,
          contentSha256,
          embeddingLiteral,
          MEMORY_EMBEDDING_MODEL,
          MEMORY_EMBEDDING_VERSION,
          estimateTokenCount(chunk.content),
          sourceJson,
          input.syncVisibility ?? 'local',
          input.retentionExpiresAt ?? null,
          input.archivedAt ?? null,
          sanitized.redactionStatus,
        ],
      );

      const row = result.rows[0] as MemoryDrawerRow | undefined;
      if (row) {
        drawers.push(rowToDrawer(row));
      }
    }

    return {
      drawers,
      redactionStatus: sanitized.redactionStatus,
      redactionCount: sanitized.redactionCount,
    };
  }

  private async embedChunks(chunks: string[]): Promise<number[][]> {
    if (!this.embeddingClient || chunks.length === 0) {
      return [];
    }

    try {
      return await this.embeddingClient.embedBatch(chunks);
    } catch (error: unknown) {
      this.logger.warn({ err: error }, 'Failed to generate drawer embeddings');
      return [];
    }
  }
}
