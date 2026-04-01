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
  /** Mesh node ID — set as app.node_id on every new pool connection for sync triggers. */
  sessionNodeId?: string;
};

export function createDb(databaseUrl: string, options: CreateDbOptions = {}) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: options.max ?? 20,
    min: options.min ?? 2,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 10_000,
  });

  // Set mesh node ID on every new physical connection.
  // This allows the sync_capture_change() trigger to identify which node
  // produced each change. Safe to call before sync tables exist.
  if (options.sessionNodeId) {
    const sanitized = options.sessionNodeId.replace(/'/g, "''");
    pool.on('connect', (client: pg.PoolClient) => {
      client.query(`SELECT set_config('app.node_id', '${sanitized}', false)`).catch(() => {
        // Non-fatal — sync triggers will skip if app.node_id is not set
      });
    });
  }

  return drizzle(pool, { schema });
}
