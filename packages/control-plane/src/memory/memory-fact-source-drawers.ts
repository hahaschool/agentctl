import type { MemoryFactSourcePreview, MemoryScope } from '@agentctl/shared';
import type { Pool } from 'pg';

export type MemoryFactSourceDrawer = Omit<MemoryFactSourcePreview, 'quote_preview'> & {
  drawer_content: string | null;
  drawer_token_count: number;
};

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

export async function listFactSourceDrawers(
  pool: Pool,
  factId: string,
): Promise<MemoryFactSourceDrawer[]> {
  const { rows } = await pool.query(
    `SELECT
       mfs.drawer_id,
       md.scope AS drawer_scope,
       md.topic AS drawer_topic,
       md.chunk_index AS drawer_chunk_index,
       md.source_type AS drawer_source_type,
       md.source_id AS drawer_source_id,
       mfs.start_offset,
       mfs.end_offset,
       md.content AS drawer_content,
       md.token_count AS drawer_token_count,
       md.archived_at AS drawer_archived_at,
       mfs.created_at
     FROM memory_fact_sources mfs
     INNER JOIN memory_drawers md ON md.id = mfs.drawer_id
     WHERE mfs.fact_id = $1
     ORDER BY mfs.created_at ASC, mfs.start_offset ASC`,
    [factId],
  );

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    drawer_id: String(row.drawer_id),
    drawer_scope: row.drawer_scope as MemoryScope,
    drawer_topic: String(row.drawer_topic),
    drawer_chunk_index: Number(row.drawer_chunk_index),
    drawer_source_type: row.drawer_source_type as MemoryFactSourceDrawer['drawer_source_type'],
    drawer_source_id: String(row.drawer_source_id),
    start_offset: Number(row.start_offset),
    end_offset: Number(row.end_offset),
    drawer_content: row.drawer_archived_at == null ? String(row.drawer_content ?? '') : null,
    drawer_token_count: Number(row.drawer_token_count ?? 0),
    status: row.drawer_archived_at == null ? 'available' : 'archived',
    created_at: toIsoString(row.created_at),
  }));
}
