import { describe, expect, it, vi } from 'vitest';

import { markSyncedEntries } from './synced-marker.js';

describe('markSyncedEntries', () => {
  it('returns the count of entries marked as synced', async () => {
    const db = {
      execute: vi.fn().mockResolvedValue({
        rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
      }),
    };

    const count = await markSyncedEntries(db as never, 'node-self');

    expect(count).toBe(3);
    expect(db.execute).toHaveBeenCalledOnce();
  });

  it('returns 0 when no entries need marking', async () => {
    const db = {
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    };

    const count = await markSyncedEntries(db as never, 'node-self');

    expect(count).toBe(0);
  });
});
