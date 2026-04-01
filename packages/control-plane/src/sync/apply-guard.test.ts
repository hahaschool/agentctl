import { describe, expect, it, vi } from 'vitest';

import { withSyncApplyGuard } from './apply-guard.js';

describe('withSyncApplyGuard', () => {
  it('calls the function within a transaction', async () => {
    const mockExecute = vi.fn().mockResolvedValue(undefined);
    const mockTx = { execute: mockExecute } as unknown;
    const mockDb = {
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
    } as unknown;

    const result = await withSyncApplyGuard(
      mockDb as Parameters<typeof withSyncApplyGuard>[0],
      async () => 'done',
    );

    expect(result).toBe('done');
    expect(mockExecute).toHaveBeenCalledOnce();
  });
});
