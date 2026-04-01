import { sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { extractRows } from '../db/index.js';

import { verifyPeerSignature } from './peer-auth.js';

type KnownPeerRow = {
  id: string;
  public_key: string | null;
};

/**
 * Load the known-peer public key registry from sync_nodes.
 * Returns a machineId -> publicKey mapping suitable for verifyPeerSignature.
 */
export async function loadKnownPeers(db: Database): Promise<Record<string, string>> {
  const result = await db.execute(sql`
    SELECT id, public_key
    FROM sync_nodes
    WHERE public_key IS NOT NULL
      AND COALESCE(is_self, false) = false
  `);

  const peers: Record<string, string> = {};
  for (const row of extractRows<KnownPeerRow>(result)) {
    if (row.public_key) {
      peers[row.id] = row.public_key;
    }
  }

  return peers;
}

/**
 * Create a Fastify preHandler that verifies X-Sync-Auth header against
 * known mesh peers. Attaches the verified machineId to request headers
 * as 'x-verified-peer-id'.
 */
export function createSyncAuthHook(opts: {
  db: Database;
  logger: Logger;
}): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const { db, logger } = opts;

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const authHeader = request.headers['x-sync-auth'];

    if (!authHeader || typeof authHeader !== 'string') {
      logger.debug('Sync request missing X-Sync-Auth header');
      await reply.code(401).send({
        error: 'SYNC_AUTH_MISSING',
        message: 'X-Sync-Auth header is required',
      });
      return;
    }

    const knownPeers = await loadKnownPeers(db);

    // For GET requests, body is empty string; for POST, use the raw body
    const body = request.method === 'GET' ? '' : (request.body ?? '');
    const path = request.url.split('?')[0] ?? request.url;

    const result = verifyPeerSignature(authHeader, request.method, path, body, knownPeers);

    if (!result.valid || !result.machineId) {
      logger.debug({ method: request.method, path }, 'Sync auth verification failed');
      await reply.code(403).send({
        error: 'SYNC_AUTH_INVALID',
        message: 'Peer signature verification failed',
      });
      return;
    }

    // Attach verified peer ID for downstream handlers
    request.headers['x-verified-peer-id'] = result.machineId;
    logger.debug({ peerId: result.machineId, method: request.method, path }, 'Sync auth verified');
  };
}
