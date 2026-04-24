import { describe, expect, it } from 'vitest';

import { TABLE_SYNC_CONFIG } from './sync.js';

describe('TABLE_SYNC_CONFIG — memory ops tables', () => {
  it('memory_ops_jobs is mesh-synced mutable', () => {
    expect(TABLE_SYNC_CONFIG.memory_ops_jobs).toBe('mutable');
  });

  it('memory_ops_job_events is not in sync config (LOCAL-ONLY)', () => {
    expect(TABLE_SYNC_CONFIG.memory_ops_job_events).toBeUndefined();
  });

  it('memory_ops_audit is not in sync config (LOCAL-ONLY)', () => {
    expect(TABLE_SYNC_CONFIG.memory_ops_audit).toBeUndefined();
  });
});
