export type { Database } from './connection.js';
export { createDb } from './connection.js';
export * from './schema.js';
export * from './schema-collaboration.js';
export * from './schema-context-bridge.js';
export * from './schema-deployment.js';
export * from './schema-intelligence.js';
export * from './schema-mobile-push-devices.js';
export * from './schema-permission-requests.js';
export * from './schema-task-graph.js';

/**
 * Extract typed rows from a raw SQL query result.
 *
 * Centralises the single type assertion needed when using `db.execute(sql\`...\`)`
 * with raw SQL (which bypasses Drizzle's type-safe query builders).
 */
export function extractRows<T>(result: { rows: Record<string, unknown>[] }): T[] {
  return result.rows as T[];
}
