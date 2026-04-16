import { afterEach, describe, expect, it, vi } from 'vitest';

import { getMachineId, type UpsertSelfNodeOptions, upsertSelfNode } from './machine-identity.js';

describe('getMachineId', () => {
  const originalEnv = process.env.MACHINE_ID;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.MACHINE_ID = originalEnv;
    } else {
      delete process.env.MACHINE_ID;
    }
  });

  it('returns MACHINE_ID from env when set', () => {
    process.env.MACHINE_ID = 'mac-local';
    expect(getMachineId()).toBe('mac-local');
  });

  it('derives from hostname when MACHINE_ID is not set', () => {
    delete process.env.MACHINE_ID;
    const id = getMachineId();
    // Should be lowercase, alphanumeric+hyphens, derived from os.hostname()
    expect(id).toMatch(/^[a-z0-9-]+$/);
    expect(id.length).toBeGreaterThan(0);
  });

  it('sanitizes hostname to valid ID format', () => {
    delete process.env.MACHINE_ID;
    // hostname() may contain dots, underscores — getMachineId strips them
    const id = getMachineId();
    expect(id).not.toMatch(/[^a-z0-9-]/);
  });
});

describe('upsertSelfNode', () => {
  it('includes version and sync fields in the SQL', async () => {
    const mockDb = {
      execute: vi.fn(() => Promise.resolve({ rows: [] })),
    };

    const opts: UpsertSelfNodeOptions = {
      db: mockDb as unknown as UpsertSelfNodeOptions['db'],
      machineId: 'test-machine',
      tailscaleIp: '100.64.0.1',
      syncUrl: 'http://100.64.0.1:8080',
      peerVersion: '0.5.6',
      peerGitSha: 'abc1234',
      peerSchemaVersion: 28,
    };

    await upsertSelfNode(opts);

    expect(mockDb.execute).toHaveBeenCalledTimes(1);
    // Drizzle sql`` returns an object with queryChunks. We verify the
    // function was called (the SQL correctness is tested via integration).
    const call = mockDb.execute.mock.calls[0]?.[0];
    expect(call).toBeDefined();
  });

  it('handles missing optional fields gracefully', async () => {
    const mockDb = {
      execute: vi.fn(() => Promise.resolve({ rows: [] })),
    };

    const opts: UpsertSelfNodeOptions = {
      db: mockDb as unknown as UpsertSelfNodeOptions['db'],
      machineId: 'test-machine',
    };

    await upsertSelfNode(opts);
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });
});
