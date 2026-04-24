import { describe, expect, it, vi } from 'vitest';

import { MemoryOpsAuditLogger } from './audit-logger.js';

describe('MemoryOpsAuditLogger', () => {
  it('writes a redacted audit entry to memory_ops_audit', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    };
    const audit = new MemoryOpsAuditLogger(pool as never);

    await audit.write({
      actor: 'local:testhost',
      action: 'provider.create',
      target: 'openai/text-embedding-3-small',
      context: { providerId: 'provider-1', apiKey: 'sk-secret' },
    });

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO memory_ops_audit'),
      [
        'local:testhost',
        'provider.create',
        'openai/text-embedding-3-small',
        JSON.stringify({ providerId: 'provider-1', apiKey: '[REDACTED]' }),
      ],
    );
  });
});
