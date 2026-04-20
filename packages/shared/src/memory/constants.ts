export const MEMORY_EMBEDDING_MODEL = 'text-embedding-3-small';
export const MEMORY_EMBEDDING_VERSION = 1;

export const MEMORY_DRAWER_CHUNK_TARGET_CHARS = 1200;
export const MEMORY_DRAWER_CHUNK_MIN_CHARS = 300;
export const MEMORY_DRAWER_CHUNK_MAX_CHARS = 2000;
export const MEMORY_DRAWER_OVERLAP_CHARS = 160;
export const MEMORY_DRAWER_MAX_TOOL_OUTPUT_CHARS_PER_TURN = 8000;
export const MEMORY_DRAWER_MAX_CHECKPOINT_CHARS = 40000;

export const MEMORY_DRAWER_SOURCE_TYPES = [
  'session-jsonl',
  'runtime-checkpoint',
  'claude-mem-observation',
  'claude-mem-session-summary',
  'manual',
  'document',
  'diary',
] as const;

export const MEMORY_DRAWER_SYNC_VISIBILITIES = ['local', 'project', 'global'] as const;

export const MEMORY_DRAWER_REDACTION_STATUSES = [
  'unreviewed',
  'sanitized',
  'quarantined',
  'approved',
] as const;
