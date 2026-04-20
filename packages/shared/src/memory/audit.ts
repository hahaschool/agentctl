import type {
  MemoryDrawerRedactionStatus,
  MemoryDrawerSourceType,
  MemoryScope,
} from '../types/memory.js';
import { redactKeys } from './redaction.js';

export const MEMORY_WRITE_AUDIT_KIND = 'memory_write';

const RAW_MEMORY_METADATA_KEYS = new Set([
  'content',
  'rawcontent',
  'sanitizedcontent',
  'chunkcontent',
  'sourcecontent',
  'sourcejsoncontent',
  'text',
  'body',
  'message',
  'messages',
  'narrative',
  'transcript',
]);

export type MemoryWriteAuditInput = {
  timestamp?: string;
  sessionId?: string | null;
  agentId?: string | null;
  machineId?: string | null;
  drawerId?: string | null;
  sourceType: MemoryDrawerSourceType;
  scope: MemoryScope | string;
  chunkIndex: number;
  contentHash: string;
  redactionStatus: MemoryDrawerRedactionStatus;
  success: boolean;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type MemoryWriteAuditEntry = {
  kind: typeof MEMORY_WRITE_AUDIT_KIND;
  timestamp: string;
  sessionId: string | null;
  agentId: string | null;
  machineId: string | null;
  drawerId: string | null;
  sourceType: MemoryDrawerSourceType;
  scope: MemoryScope | string;
  chunkIndex: number;
  contentHash: string;
  redactionStatus: MemoryDrawerRedactionStatus;
  success: boolean;
  error: string | null;
  metadata: Record<string, unknown>;
};

function normalizeMetadataKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '');
}

function stripRawMemoryContentKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripRawMemoryContentKeys(item));
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !RAW_MEMORY_METADATA_KEYS.has(normalizeMetadataKey(key)))
      .map(([key, nestedValue]) => [key, stripRawMemoryContentKeys(nestedValue)]);
    return Object.fromEntries(entries);
  }

  return value;
}

export function redactMemoryWriteMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return stripRawMemoryContentKeys(redactKeys(metadata ?? {})) as Record<string, unknown>;
}

export function buildMemoryWriteAuditEntry(input: MemoryWriteAuditInput): MemoryWriteAuditEntry {
  return {
    kind: MEMORY_WRITE_AUDIT_KIND,
    timestamp: input.timestamp ?? new Date().toISOString(),
    sessionId: input.sessionId ?? null,
    agentId: input.agentId ?? null,
    machineId: input.machineId ?? null,
    drawerId: input.drawerId ?? null,
    sourceType: input.sourceType,
    scope: input.scope,
    chunkIndex: input.chunkIndex,
    contentHash: input.contentHash,
    redactionStatus: input.redactionStatus,
    success: input.success,
    error: input.error ?? null,
    metadata: redactMemoryWriteMetadata(input.metadata),
  };
}
