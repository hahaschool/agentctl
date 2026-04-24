import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('memory ops config', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('defaults MEMORY_OPS_ENABLED to false', async () => {
    delete process.env.MEMORY_OPS_ENABLED;

    const { MEMORY_OPS_ENABLED } = await import('./config.js');

    expect(MEMORY_OPS_ENABLED).toBe(false);
  });

  it('parses enabled job kinds from a comma-separated env var', async () => {
    process.env.MEMORY_OPS_ENABLED_KINDS = 'embedding-backfill, drawer-backfill';

    const { ENABLED_JOB_KINDS } = await import('./config.js');

    expect(ENABLED_JOB_KINDS.has('embedding-backfill')).toBe(true);
    expect(ENABLED_JOB_KINDS.has('drawer-backfill')).toBe(true);
    expect(ENABLED_JOB_KINDS.has('consolidation')).toBe(false);
  });

  it('returns an empty enabled set when MEMORY_OPS_ENABLED_KINDS is blank', async () => {
    process.env.MEMORY_OPS_ENABLED_KINDS = '';

    const { ENABLED_JOB_KINDS } = await import('./config.js');

    expect(ENABLED_JOB_KINDS.size).toBe(0);
  });
});
