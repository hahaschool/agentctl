import type { MemoryDrawer } from '@agentctl/shared';
import {
  MEMORY_EMBEDDING_MODEL,
  MEMORY_EMBEDDING_VERSION,
  type MemoryWriteAuditInput,
  redactMemoryWriteMetadata,
  sanitizeName,
} from '@agentctl/shared';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import type { EmbeddingClient } from './embedding-client.js';
import type { EmbeddingClientResolver } from './embedding-client-factory.js';
import { chunkMemoryDrawerContent } from './memory-drawer-chunker.js';
import { hashMemoryDrawerContent, sanitizeMemoryDrawerContent } from './memory-drawer-sanitizer.js';
import type {
  WriteMemoryDrawerSourceInput,
  WriteMemoryDrawerSourceResult,
} from './memory-drawer-types.js';

export type MemoryDrawerStoreOptions = {
  pool: Pool;
  embeddingClient?: EmbeddingClient;
  embeddingClientResolver?: EmbeddingClientResolver;
  auditLogger?: MemoryWriteAuditLogger;
  logger: Logger;
};

export type MemoryWriteAuditLogger = {
  writeMemoryWrite(input: MemoryWriteAuditInput): Promise<void>;
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
  private readonly embeddingClientResolver: EmbeddingClientResolver | undefined;
  private readonly auditLogger: MemoryWriteAuditLogger | undefined;
  private readonly logger: Logger;

  constructor(options: MemoryDrawerStoreOptions) {
    this.pool = options.pool;
    this.embeddingClient = options.embeddingClient;
    this.embeddingClientResolver = options.embeddingClientResolver;
    this.auditLogger = options.auditLogger;
    this.logger = options.logger;
  }

  async writeSource(input: WriteMemoryDrawerSourceInput): Promise<WriteMemoryDrawerSourceResult> {
    const sanitizedScope = sanitizeName(input.scope) as WriteMemoryDrawerSourceInput['scope'];
    const sanitizedTopic = sanitizeName(input.topic ?? 'general');
    const sanitized = sanitizeMemoryDrawerContent(input.content);
    const chunks = chunkMemoryDrawerContent(sanitized.content);
    const sourceJson = redactMemoryWriteMetadata(input.sourceJson ?? {});
    const auditContext = getMemoryWriteAuditContext(input, sourceJson);
    const embeddingResult = await this.embedChunks(chunks.map((chunk) => chunk.content));
    const drawers: MemoryDrawer[] = [];

    for (const chunk of chunks) {
      const drawerId = generateMemoryDrawerId();
      const embedding = embeddingResult.embeddings[chunk.chunkIndex];
      const embeddingLiteral = embedding ? `[${embedding.join(',')}]` : null;
      const contentSha256 = hashMemoryDrawerContent(chunk.content);
      const auditBase = {
        ...auditContext,
        sourceType: input.sourceType,
        scope: sanitizedScope,
        chunkIndex: chunk.chunkIndex,
        contentHash: contentSha256,
        redactionStatus: sanitized.redactionStatus,
        metadata: sourceJson,
      };

      let row: MemoryDrawerRow | undefined;
      try {
        const result = await this.pool.query<MemoryDrawerRow>(
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
            drawerId,
            sanitizedScope,
            sanitizedTopic,
            input.sourceType,
            input.sourceId,
            input.sourceUri ?? null,
            chunk.chunkIndex,
            chunk.content,
            contentSha256,
            embeddingLiteral,
            embeddingResult.model,
            MEMORY_EMBEDDING_VERSION,
            estimateTokenCount(chunk.content),
            sourceJson,
            input.syncVisibility ?? 'local',
            input.retentionExpiresAt ?? null,
            input.archivedAt ?? null,
            sanitized.redactionStatus,
          ],
        );
        row = result.rows[0];
      } catch (error) {
        await this.emitMemoryWriteAudit({
          ...auditBase,
          drawerId: null,
          success: false,
          error: summarizeMemoryWriteError(error),
        });
        throw error;
      }

      if (row) {
        const drawer = rowToDrawer(row);
        drawers.push(drawer);
        await this.emitMemoryWriteAudit({
          ...auditBase,
          drawerId: drawer.id,
          success: true,
        });
      }
    }

    return {
      drawers,
      redactionStatus: sanitized.redactionStatus,
      redactionCount: sanitized.redactionCount,
    };
  }

  private async embedChunks(chunks: string[]): Promise<{ embeddings: number[][]; model: string }> {
    if (chunks.length === 0) {
      return { embeddings: [], model: MEMORY_EMBEDDING_MODEL };
    }

    try {
      if (this.embeddingClientResolver) {
        const resolved = await this.embeddingClientResolver();
        return { embeddings: await resolved.client.embedBatch(chunks), model: resolved.model };
      }
      if (this.embeddingClient) {
        return {
          embeddings: await this.embeddingClient.embedBatch(chunks),
          model: MEMORY_EMBEDDING_MODEL,
        };
      }
    } catch (error: unknown) {
      this.logger.warn({ err: error }, 'Failed to generate drawer embeddings');
    }
    return { embeddings: [], model: MEMORY_EMBEDDING_MODEL };
  }

  private async emitMemoryWriteAudit(input: MemoryWriteAuditInput): Promise<void> {
    if (!this.auditLogger) {
      return;
    }

    try {
      await this.auditLogger.writeMemoryWrite(input);
    } catch {
      this.logger.warn(
        {
          drawerId: input.drawerId,
          sourceType: input.sourceType,
          chunkIndex: input.chunkIndex,
        },
        'Failed to write memory drawer audit entry',
      );
    }
  }
}

function readContextValue(sourceJson: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = sourceJson[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return null;
}

function getMemoryWriteAuditContext(
  input: WriteMemoryDrawerSourceInput,
  sourceJson: Record<string, unknown>,
): Pick<MemoryWriteAuditInput, 'sessionId' | 'agentId' | 'machineId'> {
  return {
    sessionId: input.sessionId ?? readContextValue(sourceJson, ['sessionId', 'session_id']),
    agentId: input.agentId ?? readContextValue(sourceJson, ['agentId', 'agent_id']),
    machineId: input.machineId ?? readContextValue(sourceJson, ['machineId', 'machine_id']),
  };
}

function summarizeMemoryWriteError(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) {
      return code;
    }
  }

  if (error instanceof Error && error.name.length > 0) {
    return error.name;
  }

  return 'unknown_error';
}
