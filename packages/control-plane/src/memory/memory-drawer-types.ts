import type {
  MemoryDrawer,
  MemoryDrawerRedactionStatus,
  MemoryDrawerSourceType,
  MemoryDrawerSyncVisibility,
  MemoryScope,
} from '@agentctl/shared';

export type MemoryDrawerChunk = {
  chunkIndex: number;
  content: string;
  startOffset: number;
  endOffset: number;
  overlapStartOffset: number;
  sourceJson: Record<string, unknown>;
};

export type SanitizeMemoryDrawerContentResult = {
  content: string;
  contentSha256: string;
  redactionStatus: MemoryDrawerRedactionStatus;
  redactionCount: number;
};

export type WriteMemoryDrawerSourceInput = {
  scope: MemoryScope;
  topic?: string;
  sourceType: MemoryDrawerSourceType;
  sourceId: string;
  sourceUri?: string | null;
  content: string;
  sourceJson?: Record<string, unknown>;
  syncVisibility?: MemoryDrawerSyncVisibility;
  retentionExpiresAt?: Date | string | null;
  archivedAt?: Date | string | null;
};

export type WriteMemoryDrawerSourceResult = {
  drawers: MemoryDrawer[];
  redactionStatus: MemoryDrawerRedactionStatus;
  redactionCount: number;
};
