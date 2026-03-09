import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureSchemaCompatibility } from './schema-compat.js';

type DbLike = {
  execute: ReturnType<typeof vi.fn>;
};

type LoggerLike = {
  warn: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

function makeDb(): DbLike {
  return {
    execute: vi.fn(),
  };
}

function makeLogger(): LoggerLike {
  return {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  };
}

describe('ensureSchemaCompatibility', () => {
  let db: DbLike;
  let logger: LoggerLike;

  beforeEach(() => {
    db = makeDb();
    logger = makeLogger();
  });

  it('does nothing when agents.runtime already exists', async () => {
    db.execute.mockResolvedValueOnce({ rows: [{ exists: true }] });

    await ensureSchemaCompatibility(db as never, logger as never);

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('applies compatibility patch when agents.runtime is missing', async () => {
    db.execute
      .mockResolvedValueOnce({ rows: [{ exists: false }] }) // pre-check
      .mockResolvedValueOnce({ rows: [] }) // ALTER TABLE
      .mockResolvedValueOnce({ rows: [{ exists: true }] }); // post-check

    await ensureSchemaCompatibility(db as never, logger as never);

    expect(db.execute).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('Schema compatibility patch applied: agents.runtime');
  });

  it('throws when patch execution fails', async () => {
    db.execute
      .mockResolvedValueOnce({ rows: [{ exists: false }] }) // pre-check
      .mockRejectedValueOnce(new Error('permission denied')); // ALTER TABLE

    await expect(ensureSchemaCompatibility(db as never, logger as never)).rejects.toThrow(
      'permission denied',
    );
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('throws when runtime column is still missing after patch', async () => {
    db.execute
      .mockResolvedValueOnce({ rows: [{ exists: false }] }) // pre-check
      .mockResolvedValueOnce({ rows: [] }) // ALTER TABLE
      .mockResolvedValueOnce({ rows: [{ exists: false }] }); // post-check

    await expect(ensureSchemaCompatibility(db as never, logger as never)).rejects.toThrow(
      'Schema compatibility check failed',
    );
  });
});
