import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../db/index.js';
import { extractRows } from '../../db/index.js';
import { computeNextInterval } from '../../sync/peer-health.js';

const DEFAULT_INTERVAL_MS = 30_000;
const HEALTH_TIMEOUT_MS = 5_000;
const MAX_MACHINE_ID_LENGTH = 128;
const MAX_HOSTNAME_LENGTH = 255;
const MAX_TAILSCALE_IP_LENGTH = 64;
const MAX_SYNC_URL_LENGTH = 2_048;
const MAX_PUBLIC_KEY_LENGTH = 2_048;
const MIN_SYNC_INTERVAL_MS = 1_000;
const MAX_SYNC_INTERVAL_MS = 300_000;
const VALID_SYNC_ROLES = new Set(['full']);
const VALID_SYNC_STATUSES = new Set(['unknown', 'reachable', 'unreachable']);
const BLOCKED_SYNC_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'metadata.google.com',
]);

type SyncPeersRoutesOptions = {
  db: Database;
};

type SyncPeerRow = {
  id: string;
  hostname: string;
  tailscale_ip: string | null;
  sync_url: string | null;
  role: string | null;
  sync_status: string | null;
  sync_interval_ms: number | null;
  is_self: boolean | null;
  public_key: string | null;
  last_seen: string | Date | null;
  created_at: string | Date | null;
};

type UpsertSyncPeerBody = {
  machineId?: string;
  hostname?: string;
  tailscaleIp?: string;
  syncUrl?: string;
  role?: string;
  syncStatus?: string;
  syncIntervalMs?: number;
  isSelf?: boolean;
  publicKey?: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

type ValidationFailure = { ok: false; error: string; message: string };
type ValidationResult<T> = { ok: true; value: T } | ValidationFailure;

function validationFailureBody(result: ValidationFailure): { error: string; message: string } {
  return {
    error: result.error,
    message: result.message,
  };
}

function validateRequiredString(
  value: unknown,
  opts: { field: string; error: string; maxLength: number },
): ValidationResult<string> {
  if (!isNonEmptyString(value)) {
    return {
      ok: false,
      error: opts.error,
      message: `A non-empty "${opts.field}" string is required`,
    };
  }

  const trimmed = value.trim();
  if (trimmed.length > opts.maxLength) {
    return {
      ok: false,
      error: opts.error,
      message: `"${opts.field}" must be ${opts.maxLength} characters or fewer`,
    };
  }

  return { ok: true, value: trimmed };
}

function validateOptionalString(
  value: unknown,
  opts: { field: string; error: string; maxLength: number },
): ValidationResult<string | null> {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }

  if (typeof value !== 'string') {
    return {
      ok: false,
      error: opts.error,
      message: `"${opts.field}" must be a string`,
    };
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }

  if (trimmed.length > opts.maxLength) {
    return {
      ok: false,
      error: opts.error,
      message: `"${opts.field}" must be ${opts.maxLength} characters or fewer`,
    };
  }

  return { ok: true, value: trimmed };
}

function parseIpv4Address(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) => {
    if (!/^\d+$/.test(part)) {
      return Number.NaN;
    }
    return Number(part);
  });

  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }

  return octets as [number, number, number, number];
}

function isBlockedIpv4(hostname: string): boolean {
  const octets = parseIpv4Address(hostname);
  if (!octets) {
    return false;
  }

  const [first, second] = octets;
  return first === 0 || first === 127 || (first === 169 && second === 254);
}

function isBlockedIpv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:0.') ||
    normalized.startsWith('::ffff:169.254.') ||
    normalized.startsWith('fe80:')
  );
}

function isBlockedSyncHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');

  if (BLOCKED_SYNC_HOSTNAMES.has(normalized) || normalized.endsWith('.localhost')) {
    return true;
  }

  return isBlockedIpv4(normalized) || isBlockedIpv6(normalized);
}

function validateSyncUrl(value: unknown): ValidationResult<string> {
  const stringResult = validateRequiredString(value, {
    field: 'syncUrl',
    error: 'INVALID_SYNC_URL',
    maxLength: MAX_SYNC_URL_LENGTH,
  });
  if (!stringResult.ok) {
    return stringResult;
  }

  let parsed: URL;
  try {
    parsed = new URL(stringResult.value);
  } catch {
    return {
      ok: false,
      error: 'INVALID_SYNC_URL',
      message: '"syncUrl" must be a valid URL',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      error: 'INVALID_SYNC_URL',
      message: '"syncUrl" must use http or https',
    };
  }

  if (parsed.username || parsed.password) {
    return {
      ok: false,
      error: 'INVALID_SYNC_URL',
      message: '"syncUrl" must not include credentials',
    };
  }

  if (isBlockedSyncHostname(parsed.hostname)) {
    return {
      ok: false,
      error: 'INVALID_SYNC_URL',
      message: '"syncUrl" points to a blocked local or metadata address',
    };
  }

  return { ok: true, value: stringResult.value };
}

function validateSyncRole(value: unknown): ValidationResult<string> {
  if (value === undefined || value === null) {
    return { ok: true, value: 'full' };
  }

  const stringResult = validateRequiredString(value, {
    field: 'role',
    error: 'INVALID_ROLE',
    maxLength: 32,
  });
  if (!stringResult.ok) {
    return stringResult;
  }

  if (!VALID_SYNC_ROLES.has(stringResult.value)) {
    return {
      ok: false,
      error: 'INVALID_ROLE',
      message: '"role" must be one of: full',
    };
  }

  return stringResult;
}

function validateSyncStatus(value: unknown): ValidationResult<string> {
  if (value === undefined || value === null) {
    return { ok: true, value: 'unknown' };
  }

  const stringResult = validateRequiredString(value, {
    field: 'syncStatus',
    error: 'INVALID_SYNC_STATUS',
    maxLength: 32,
  });
  if (!stringResult.ok) {
    return stringResult;
  }

  if (!VALID_SYNC_STATUSES.has(stringResult.value)) {
    return {
      ok: false,
      error: 'INVALID_SYNC_STATUS',
      message: '"syncStatus" must be one of: unknown, reachable, unreachable',
    };
  }

  return stringResult;
}

function validateSyncInterval(value: unknown): ValidationResult<number> {
  if (value === undefined || value === null) {
    return { ok: true, value: DEFAULT_INTERVAL_MS };
  }

  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < MIN_SYNC_INTERVAL_MS ||
    value > MAX_SYNC_INTERVAL_MS
  ) {
    return {
      ok: false,
      error: 'INVALID_SYNC_INTERVAL',
      message: `"syncIntervalMs" must be an integer between ${MIN_SYNC_INTERVAL_MS} and ${MAX_SYNC_INTERVAL_MS}`,
    };
  }

  return { ok: true, value };
}

function toIsoString(value: string | Date | null): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function mapSyncPeerRow(row: SyncPeerRow) {
  return {
    machineId: row.id,
    hostname: row.hostname,
    tailscaleIp: row.tailscale_ip,
    syncUrl: row.sync_url,
    role: row.role ?? 'full',
    syncStatus: row.sync_status ?? 'unknown',
    syncIntervalMs: row.sync_interval_ms ?? DEFAULT_INTERVAL_MS,
    isSelf: row.is_self ?? false,
    publicKey: row.public_key,
    lastSeen: toIsoString(row.last_seen),
    createdAt: toIsoString(row.created_at),
  };
}

async function fetchPeer(db: Database, machineId: string): Promise<SyncPeerRow | null> {
  const result = await db.execute(sql`
    SELECT id, hostname, tailscale_ip, sync_url, role, sync_status, sync_interval_ms, is_self, public_key, last_seen, created_at
    FROM sync_nodes
    WHERE id = ${machineId}
    LIMIT 1
  `);
  const [peer] = extractRows<SyncPeerRow>(result);
  return peer ?? null;
}

async function pingPeer(syncUrl: string): Promise<'reachable' | 'unreachable'> {
  try {
    const response = await fetch(`${syncUrl}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.ok ? 'reachable' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

export const syncPeersRoutes: FastifyPluginAsync<SyncPeersRoutesOptions> = async (app, opts) => {
  const { db } = opts;

  app.get(
    '/',
    {
      schema: {
        tags: ['sync'],
        summary: 'List mesh sync peers',
      },
    },
    async () => {
      const result = await db.execute(sql`
        SELECT id, hostname, tailscale_ip, sync_url, role, sync_status, sync_interval_ms, is_self, public_key, last_seen, created_at
        FROM sync_nodes
        ORDER BY hostname ASC, id ASC
      `);

      return {
        peers: extractRows<SyncPeerRow>(result).map(mapSyncPeerRow),
      };
    },
  );

  app.post<{ Body: UpsertSyncPeerBody }>(
    '/',
    {
      schema: {
        tags: ['sync'],
        summary: 'Create or update a mesh sync peer',
      },
    },
    async (request, reply) => {
      const {
        machineId,
        hostname,
        tailscaleIp,
        syncUrl,
        role,
        syncStatus,
        syncIntervalMs,
        isSelf,
        publicKey,
      } = request.body ?? {};

      const machineIdResult = validateRequiredString(machineId, {
        field: 'machineId',
        error: 'INVALID_MACHINE_ID',
        maxLength: MAX_MACHINE_ID_LENGTH,
      });
      if (!machineIdResult.ok) {
        return reply.code(400).send(validationFailureBody(machineIdResult));
      }

      const hostnameResult = validateRequiredString(hostname, {
        field: 'hostname',
        error: 'INVALID_HOSTNAME',
        maxLength: MAX_HOSTNAME_LENGTH,
      });
      if (!hostnameResult.ok) {
        return reply.code(400).send(validationFailureBody(hostnameResult));
      }

      const tailscaleIpResult = validateOptionalString(tailscaleIp, {
        field: 'tailscaleIp',
        error: 'INVALID_TAILSCALE_IP',
        maxLength: MAX_TAILSCALE_IP_LENGTH,
      });
      if (!tailscaleIpResult.ok) {
        return reply.code(400).send(validationFailureBody(tailscaleIpResult));
      }

      const syncUrlResult = validateSyncUrl(syncUrl);
      if (!syncUrlResult.ok) {
        return reply.code(400).send(validationFailureBody(syncUrlResult));
      }

      const roleResult = validateSyncRole(role);
      if (!roleResult.ok) {
        return reply.code(400).send(validationFailureBody(roleResult));
      }

      const syncStatusResult = validateSyncStatus(syncStatus);
      if (!syncStatusResult.ok) {
        return reply.code(400).send(validationFailureBody(syncStatusResult));
      }

      const syncIntervalResult = validateSyncInterval(syncIntervalMs);
      if (!syncIntervalResult.ok) {
        return reply.code(400).send(validationFailureBody(syncIntervalResult));
      }

      const publicKeyResult = validateOptionalString(publicKey, {
        field: 'publicKey',
        error: 'INVALID_PUBLIC_KEY',
        maxLength: MAX_PUBLIC_KEY_LENGTH,
      });
      if (!publicKeyResult.ok) {
        return reply.code(400).send(validationFailureBody(publicKeyResult));
      }

      const result = await db.execute(sql`
        INSERT INTO sync_nodes (id, hostname, tailscale_ip, sync_url, role, sync_status, sync_interval_ms, is_self, public_key)
        VALUES (
          ${machineIdResult.value},
          ${hostnameResult.value},
          ${tailscaleIpResult.value},
          ${syncUrlResult.value},
          ${roleResult.value},
          ${syncStatusResult.value},
          ${syncIntervalResult.value},
          ${isSelf ?? false},
          ${publicKeyResult.value}
        )
        ON CONFLICT (id) DO UPDATE SET
          hostname = EXCLUDED.hostname,
          tailscale_ip = EXCLUDED.tailscale_ip,
          sync_url = EXCLUDED.sync_url,
          role = EXCLUDED.role,
          sync_status = EXCLUDED.sync_status,
          sync_interval_ms = EXCLUDED.sync_interval_ms,
          is_self = EXCLUDED.is_self,
          public_key = EXCLUDED.public_key
        RETURNING id, hostname, tailscale_ip, sync_url, role, sync_status, sync_interval_ms, is_self, public_key, last_seen, created_at
      `);
      const [peer] = extractRows<SyncPeerRow>(result);

      return reply.code(201).send({
        ok: true,
        peer: peer ? mapSyncPeerRow(peer) : null,
      });
    },
  );

  app.delete<{ Params: { machineId: string } }>(
    '/:machineId',
    {
      schema: {
        tags: ['sync'],
        summary: 'Delete a mesh sync peer',
      },
    },
    async (request, reply) => {
      const { machineId } = request.params;

      if (!isNonEmptyString(machineId)) {
        return reply.code(400).send({
          error: 'INVALID_MACHINE_ID',
          message: 'A non-empty "machineId" path parameter is required',
        });
      }

      const result = await db.execute(sql`
        DELETE FROM sync_nodes
        WHERE id = ${machineId.trim()}
        RETURNING id, hostname, tailscale_ip, sync_url, role, sync_status, sync_interval_ms, is_self, public_key, last_seen, created_at
      `);
      const [peer] = extractRows<SyncPeerRow>(result);

      if (!peer) {
        return reply.code(404).send({
          error: 'SYNC_PEER_NOT_FOUND',
          message: `Sync peer '${machineId}' not found`,
        });
      }

      return {
        ok: true,
        peer: mapSyncPeerRow(peer),
      };
    },
  );

  app.post<{ Params: { machineId: string } }>(
    '/:machineId/ping',
    {
      schema: {
        tags: ['sync'],
        summary: 'Ping a mesh sync peer via /health',
      },
    },
    async (request, reply) => {
      const { machineId } = request.params;

      if (!isNonEmptyString(machineId)) {
        return reply.code(400).send({
          error: 'INVALID_MACHINE_ID',
          message: 'A non-empty "machineId" path parameter is required',
        });
      }

      const peer = await fetchPeer(db, machineId.trim());
      if (!peer) {
        return reply.code(404).send({
          error: 'SYNC_PEER_NOT_FOUND',
          message: `Sync peer '${machineId}' not found`,
        });
      }

      if (!isNonEmptyString(peer.sync_url)) {
        return reply.code(400).send({
          error: 'SYNC_PEER_MISSING_URL',
          message: `Sync peer '${machineId}' does not have a syncUrl configured`,
        });
      }

      const syncUrlResult = validateSyncUrl(peer.sync_url);
      if (!syncUrlResult.ok) {
        return reply.code(400).send(validationFailureBody(syncUrlResult));
      }

      const status = await pingPeer(syncUrlResult.value);
      const nextInterval = computeNextInterval(
        peer.sync_interval_ms ?? DEFAULT_INTERVAL_MS,
        status,
      );

      const updateResult =
        status === 'reachable'
          ? await db.execute(sql`
              UPDATE sync_nodes
              SET sync_status = 'reachable',
                  sync_interval_ms = ${nextInterval},
                  last_seen = now()
              WHERE id = ${machineId.trim()}
              RETURNING id, hostname, tailscale_ip, sync_url, role, sync_status, sync_interval_ms, is_self, public_key, last_seen, created_at
            `)
          : await db.execute(sql`
              UPDATE sync_nodes
              SET sync_status = 'unreachable',
                  sync_interval_ms = ${nextInterval}
              WHERE id = ${machineId.trim()}
              RETURNING id, hostname, tailscale_ip, sync_url, role, sync_status, sync_interval_ms, is_self, public_key, last_seen, created_at
            `);

      const [updatedPeer] = extractRows<SyncPeerRow>(updateResult);

      return {
        ok: true,
        status,
        peer: updatedPeer ? mapSyncPeerRow(updatedPeer) : mapSyncPeerRow(peer),
      };
    },
  );
};
