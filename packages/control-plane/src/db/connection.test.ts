import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — set up before importing the module under test
// ---------------------------------------------------------------------------

const mockPool = { connect: vi.fn(), query: vi.fn(), end: vi.fn() };

vi.mock('pg', () => {
  const Pool = vi.fn(() => mockPool);
  return { default: { Pool }, Pool };
});

const mockDrizzleReturn = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  query: {},
};

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn(() => mockDrizzleReturn),
}));

// Import after mocks are in place
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createDb } from './connection.js';
import type { Database } from './connection.js';

describe('connection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createDb', () => {
    it('is exported as a function', () => {
      expect(createDb).toBeDefined();
      expect(typeof createDb).toBe('function');
    });

    it('creates a pg.Pool with the provided connection string', () => {
      const connectionString = 'postgresql://user:pass@localhost:5432/agentctl';

      createDb(connectionString);

      expect(pg.Pool).toHaveBeenCalledOnce();
      expect(pg.Pool).toHaveBeenCalledWith(expect.objectContaining({ connectionString }));
    });

    it('passes the pool and schema to drizzle', () => {
      const connectionString = 'postgresql://user:pass@localhost:5432/agentctl';

      createDb(connectionString);

      expect(drizzle).toHaveBeenCalledOnce();
      expect(drizzle).toHaveBeenCalledWith(mockPool, { schema: expect.any(Object) });
    });

    it('returns the drizzle instance with expected methods', () => {
      const db = createDb('postgresql://user:pass@localhost:5432/agentctl');

      expect(db).toBe(mockDrizzleReturn);
      expect(db.select).toBeDefined();
      expect(db.insert).toBeDefined();
      expect(db.update).toBeDefined();
      expect(db.delete).toBeDefined();
    });

    it('returns a value that satisfies the Database type', () => {
      const db: Database = createDb('postgresql://user:pass@localhost:5432/agentctl');

      // The Database type is a ReturnType of createDb — this assignment
      // verifies the type export is usable at compile time.
      expect(db).toBeDefined();
    });

    it('creates a new pool for each invocation', () => {
      createDb('postgresql://localhost/db1');
      createDb('postgresql://localhost/db2');

      expect(pg.Pool).toHaveBeenCalledTimes(2);
      expect(pg.Pool).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ connectionString: 'postgresql://localhost/db1' }),
      );
      expect(pg.Pool).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ connectionString: 'postgresql://localhost/db2' }),
      );
    });
  });

  describe('Database type', () => {
    it('is exported and usable as a type annotation', () => {
      // This is primarily a compile-time check. If `Database` were not
      // properly exported the TypeScript compiler would reject this file.
      const db: Database = createDb('postgresql://localhost/test');
      expect(db).toBeDefined();
    });
  });

  describe('error scenarios', () => {
    it('propagates Pool constructor errors', () => {
      const poolError = new Error('invalid connection string');
      vi.mocked(pg.Pool).mockImplementationOnce(() => {
        throw poolError;
      });

      expect(() => createDb('not-a-valid-url')).toThrow('invalid connection string');
    });

    it('propagates drizzle initialization errors', () => {
      const drizzleError = new Error('drizzle init failed');
      vi.mocked(drizzle).mockImplementationOnce(() => {
        throw drizzleError;
      });

      expect(() => createDb('postgresql://localhost/test')).toThrow('drizzle init failed');
    });
  });
});
