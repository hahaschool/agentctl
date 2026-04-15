import type { ChangeLogEntry, MeshEnvelopeMeta } from '@agentctl/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyChange } from './apply-change.js';
import {
  __resetSchemaVersionCacheForTests,
  __setSchemaVersionForTests,
  MeshEnvelopeSchemaAheadError,
  MeshProtocolUnsupportedError,
} from './mesh-compat.js';

/**
 * Minimal DB mock mirroring apply-change.test.ts. We care about whether
 * apply runs at all — not about which SQL is emitted — so we return an empty
 * existence check and no prior vclock.
 */
function createMockDb() {
  const mockExecute = vi.fn().mockImplementation(async () => ({ rows: [] }));
  return {
    execute: mockExecute,
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { execute: mockExecute };
      return fn(tx);
    }),
  };
}

function createMockLogger() {
  return {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    // `child` returns itself so we stay a shallow stub.
    child: vi.fn(function (this: unknown) {
      return this;
    }),
  } as never;
}

function makeChange(meta?: Partial<MeshEnvelopeMeta>): ChangeLogEntry {
  const base: ChangeLogEntry = {
    id: 1,
    nodeId: 'node-remote',
    tableName: 'session_handoffs', // append-only: cheapest path, single existence check
    rowId: 'handoff-1',
    operation: 'INSERT',
    payload: { id: 'handoff-1', from_agent: 'a', to_agent: 'b' },
    vclock: { 'node-remote': 1 },
    createdAt: new Date(),
    synced: false,
  };

  if (meta === undefined) {
    return base;
  }

  return {
    ...base,
    meta: {
      schemaVersion: meta.schemaVersion ?? 10,
      protocolVersion: meta.protocolVersion ?? 1,
      producerVersion: meta.producerVersion ?? '0.4.0',
    },
  };
}

describe('applyChange — mesh envelope compat gate', () => {
  const LOCAL_SCHEMA = 10;

  beforeEach(() => {
    __setSchemaVersionForTests(LOCAL_SCHEMA);
  });

  afterEach(() => {
    __resetSchemaVersionCacheForTests();
    vi.clearAllMocks();
  });

  it('applies when envelope schemaVersion equals local', async () => {
    const db = createMockDb();
    const logger = createMockLogger();
    const change = makeChange({ schemaVersion: LOCAL_SCHEMA });

    const result = await applyChange(change, db as never, logger);

    expect(result).toBe('applied');
  });

  it('applies when envelope schemaVersion = local + 1 (one-skew tolerated)', async () => {
    const db = createMockDb();
    const logger = createMockLogger();
    const change = makeChange({ schemaVersion: LOCAL_SCHEMA + 1 });

    const result = await applyChange(change, db as never, logger);

    expect(result).toBe('applied');
  });

  it('rejects when envelope schemaVersion = local + 2 with MESH_ENVELOPE_SCHEMA_AHEAD', async () => {
    const db = createMockDb();
    const logger = createMockLogger();
    const change = makeChange({ schemaVersion: LOCAL_SCHEMA + 2 });

    await expect(applyChange(change, db as never, logger)).rejects.toBeInstanceOf(
      MeshEnvelopeSchemaAheadError,
    );

    try {
      await applyChange(change, db as never, logger);
    } catch (err) {
      expect(err).toBeInstanceOf(MeshEnvelopeSchemaAheadError);
      const typed = err as MeshEnvelopeSchemaAheadError;
      expect(typed.code).toBe('MESH_ENVELOPE_SCHEMA_AHEAD');
      expect(typed.context).toMatchObject({
        localSchemaVersion: LOCAL_SCHEMA,
        envelopeSchemaVersion: LOCAL_SCHEMA + 2,
        producerMachineId: 'node-remote',
      });
    }
  });

  it('applies when envelope schemaVersion = local - 1 (backward compat)', async () => {
    const db = createMockDb();
    const logger = createMockLogger();
    const change = makeChange({ schemaVersion: LOCAL_SCHEMA - 1 });

    const result = await applyChange(change, db as never, logger);

    expect(result).toBe('applied');
  });

  it('applies but WARN-logs when envelope is missing meta (legacy producer)', async () => {
    const db = createMockDb();
    const logger = createMockLogger();
    const change = makeChange(); // no meta

    const result = await applyChange(change, db as never, logger);

    expect(result).toBe('applied');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [warnArg] = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(warnArg).toMatchObject({
      producerMachineId: 'node-remote',
      changeId: 1,
      tableName: 'session_handoffs',
    });
  });

  it('rejects when envelope protocolVersion = 2 with MESH_PROTOCOL_UNSUPPORTED', async () => {
    const db = createMockDb();
    const logger = createMockLogger();
    const change = makeChange({ schemaVersion: LOCAL_SCHEMA, protocolVersion: 2 });

    await expect(applyChange(change, db as never, logger)).rejects.toBeInstanceOf(
      MeshProtocolUnsupportedError,
    );

    try {
      await applyChange(change, db as never, logger);
    } catch (err) {
      expect(err).toBeInstanceOf(MeshProtocolUnsupportedError);
      const typed = err as MeshProtocolUnsupportedError;
      expect(typed.code).toBe('MESH_PROTOCOL_UNSUPPORTED');
      expect(typed.context).toMatchObject({
        envelopeProtocolVersion: 2,
        supportedMin: 1,
        supportedMax: 1,
        producerMachineId: 'node-remote',
      });
    }
  });
});
