import { describe, expect, it, vi } from 'vitest';

import { listFactSourceDrawers } from './memory-fact-source-drawers.js';

describe('listFactSourceDrawers', () => {
  it('lists available drawer content and archived markers for a fact', async () => {
    const createdAt = new Date('2026-03-11T00:00:00.000Z');
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          drawer_id: 'drawer-1',
          drawer_scope: 'agent:agent-1',
          drawer_topic: 'tooling',
          drawer_chunk_index: 0,
          drawer_source_type: 'manual',
          drawer_source_id: 'source-1',
          start_offset: 5,
          end_offset: 15,
          drawer_content: '01234abcdefghij67890',
          drawer_token_count: 6,
          drawer_archived_at: null,
          created_at: createdAt,
        },
        {
          drawer_id: 'drawer-2',
          drawer_scope: 'global',
          drawer_topic: 'archived-tooling',
          drawer_chunk_index: 1,
          drawer_source_type: 'manual',
          drawer_source_id: 'source-2',
          start_offset: 0,
          end_offset: 10,
          drawer_content: 'should-not-inject',
          drawer_token_count: 4,
          drawer_archived_at: createdAt,
          created_at: createdAt,
        },
      ],
      rowCount: 2,
    });

    const drawers = await listFactSourceDrawers({ query } as never, 'fact-1');

    expect(drawers).toEqual([
      {
        drawer_id: 'drawer-1',
        drawer_scope: 'agent:agent-1',
        drawer_topic: 'tooling',
        drawer_chunk_index: 0,
        drawer_source_type: 'manual',
        drawer_source_id: 'source-1',
        start_offset: 5,
        end_offset: 15,
        drawer_content: '01234abcdefghij67890',
        drawer_token_count: 6,
        status: 'available',
        created_at: '2026-03-11T00:00:00.000Z',
      },
      {
        drawer_id: 'drawer-2',
        drawer_scope: 'global',
        drawer_topic: 'archived-tooling',
        drawer_chunk_index: 1,
        drawer_source_type: 'manual',
        drawer_source_id: 'source-2',
        start_offset: 0,
        end_offset: 10,
        drawer_content: null,
        drawer_token_count: 4,
        status: 'archived',
        created_at: '2026-03-11T00:00:00.000Z',
      },
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM memory_fact_sources mfs'), [
      'fact-1',
    ]);
  });
});
