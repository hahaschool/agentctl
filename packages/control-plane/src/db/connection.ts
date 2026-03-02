import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema.js';

export type Database = ReturnType<typeof createDb>;

export type CreateDbOptions = {
  /** Maximum number of connections in the pool. */
  max?: number;
  /** Minimum number of idle connections maintained. */
  min?: number;
  /** Time (ms) a client can sit idle before being closed. */
  idleTimeoutMillis?: number;
  /** Time (ms) to wait for a connection before throwing. */
  connectionTimeoutMillis?: number;
};

export function createDb(databaseUrl: string, options: CreateDbOptions = {}) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: options.max ?? 20,
    min: options.min ?? 2,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 10_000,
  });
  return drizzle(pool, { schema });
}
