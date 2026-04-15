import { createHash, timingSafeEqual } from 'node:crypto';

import rateLimit from '@fastify/rate-limit';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';

import type { Database } from '../../db/index.js';
import { extractRows } from '../../db/index.js';
import {
  deriveSyncUrlFromTarget,
  fetchTailscaleMeshPeers,
  type ProbePeerResult,
  probePeerHealth,
  type TailscalePeer,
} from '../../sync/peer-discovery.js';
import {
  computeNextInterval,
  EMPTY_PEER_VERSION_INFO,
  type PeerVersionInfo,
  readPeerVersionInfo,
} from '../../sync/peer-health.js';
import { verifyPeerRegistrationSignature } from '../../sync/peer-registration.js';
import {
  performReverseRegistration,
  type ReverseRegistrationResult,
  type SelfIdentity,
} from '../../sync/peer-reverse-registration.js';
import { readRateLimitEnv } from '../rate-limit.js';

const DEFAULT_INTERVAL_MS = 30_000;
const HEALTH_TIMEOUT_MS = 5_000;
const REGISTRATION_RATE_LIMIT = {
  max: 10,
  windowMs: 60_000,
} as const;
const MAX_MACHINE_ID_LENGTH = 128;
const MAX_HOSTNAME_LENGTH = 255;
const MAX_TAILSCALE_IP_LENGTH = 64;
const MAX_SYNC_URL_LENGTH = 2_048;
const MAX_PUBLIC_KEY_LENGTH = 2_048;
const MIN_SYNC_INTERVAL_MS = 1_000;
const MAX_SYNC_INTERVAL_MS = 300_000;
const VALID_SYNC_ROLES = new Set(['full']);
const VALID_SYNC_STATUSES = new Set(['unknown', 'reachable', 'unreachable']);
const PING_ERROR_CATEGORIES = new Set([
  'bad_url',
  'connect_refused',
  'dns',
  'http_status',
  'timeout',
  'tls_handshake',
  'other',
]);
const BLOCKED_SYNC_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'metadata.google.com',
]);

type PingErrorCategory =
  | 'bad_url'
  | 'connect_refused'
  | 'dns'
  | 'http_status'
  | 'timeout'
  | 'tls_handshake'
  | 'other';

type PingError = {
  category: PingErrorCategory;
  httpStatusCode: number | null;
};

type PingPeerResult =
  | { status: 'reachable'; error: null; version: PeerVersionInfo }
  | { status: 'unreachable'; error: PingError; version: PeerVersionInfo };

type SyncPeersRoutesOptions = {
  db: Database;
  registrationToken?: string;
  /**
   * Identity of THIS control plane — used as the "signer" of outbound reverse
   * registration envelopes when an operator adds a new peer locally (§33.8).
   * When omitted the reverse handshake is skipped (and the new column stays
   * NULL). Callers that know their own machine id / sync URL should pass it.
   */
  selfIdentity?: SelfIdentity | null;
  /**
   * Ed25519 secret key (base64) used to sign outbound registration envelopes.
   * Without it we cannot sign, so the reverse handshake is skipped.
   */
  signingSecretKey?: string | null;
  /** Optional bootstrap token to present to the remote peer. */
  reverseRegistrationToken?: string | null;
  /**
   * Fetch implementation used for outbound reverse registration. Injected for
   * tests so we never hit the real network. Defaults to `globalThis.fetch`.
   */
  fetchImpl?: typeof fetch;
  /** Logger for outbound reverse-registration errors. */
  logger?: Pick<Logger, 'warn' | 'debug'>;
  /**
   * Injectable Tailscale peer source used by `GET /discover` (§33.7).
   * Returns the list of online `tag:mesh-node` peers. When omitted, the real
   * implementation shells out to `tailscale status --json` via
   * `fetchTailscaleMeshPeers`. Tests pass a stub to avoid touching the CLI.
   */
  tailscalePeerSource?: (logger: Pick<Logger, 'debug'>) => Promise<TailscalePeer[]>;
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
  last_ping_error: string | null;
  last_ping_status_code: number | null;
  last_seen: string | Date | null;
  created_at: string | Date | null;
  peer_version: string | null;
  peer_git_sha: string | null;
  peer_schema_version: number | null;
  reverse_registration_status: string | null;
  reverse_registration_error: string | null;
  reverse_registration_at: string | Date | null;
  last_schema_ahead_version: number | null;
  last_schema_ahead_at: string | Date | null;
  schema_ahead_count: number | null;
  /**
   * Cursor timestamps derived from `sync_peer_cursors` (§33.8 mesh health).
   * Populated by the listing endpoint via a LEFT JOIN; individual fetch
   * helpers that do not join leave these `undefined`.
   */
  last_pull_at?: string | Date | null;
  last_ack_at?: string | Date | null;
};

const SYNC_NODE_COLUMNS = sql`id, hostname, tailscale_ip, sync_url, role, sync_status, sync_interval_ms, is_self, public_key, last_ping_error, last_ping_status_code, last_seen, created_at, peer_version, peer_git_sha, peer_schema_version, reverse_registration_status, reverse_registration_error, reverse_registration_at, last_schema_ahead_version, last_schema_ahead_at, schema_ahead_count`;

/**
 * Prefixed version of `SYNC_NODE_COLUMNS` used when the row is joined with
 * `sync_peer_cursors`. Keeps column names stable (`id`, `hostname`, etc.) so
 * `mapSyncPeerRow` can operate on either shape. The JOIN contributes
 * `last_pull_at` and `last_ack_at` columns derived from `updated_at`.
 */
const SYNC_NODE_JOIN_COLUMNS = sql`sn.id, sn.hostname, sn.tailscale_ip, sn.sync_url, sn.role, sn.sync_status, sn.sync_interval_ms, sn.is_self, sn.public_key, sn.last_ping_error, sn.last_ping_status_code, sn.last_seen, sn.created_at, sn.peer_version, sn.peer_git_sha, sn.peer_schema_version, sn.reverse_registration_status, sn.reverse_registration_error, sn.reverse_registration_at, sn.last_schema_ahead_version, sn.last_schema_ahead_at, sn.schema_ahead_count, spc.updated_at AS last_pull_at, spc.updated_at AS last_ack_at`;

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

type RegisterSyncPeerBody = {
  machineId?: string;
  hostname?: string;
  tailscaleIp?: string;
  syncUrl?: string;
  publicKey?: string;
  registrationSignature?: unknown;
};

type PeerRegistrationRequestContext = {
  peerRegistration?: {
    machineId: string;
    hostname: string;
    tailscaleIp: string | null;
    syncUrl: string;
    publicKey: string;
  };
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

function readHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function tokensEqual(actual: string, expected: string): boolean {
  const actualHash = createHash('sha256').update(actual).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

function getRegistrationToken(configuredToken: string | undefined): string | null {
  const token = configuredToken ?? process.env.SYNC_PEER_REGISTRATION_TOKEN;
  return typeof token === 'string' && token.trim().length > 0 ? token.trim() : null;
}

function getRateLimitKey(request: {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}): string {
  return (
    request.ip ??
    (typeof request.headers['x-forwarded-for'] === 'string'
      ? request.headers['x-forwarded-for']
      : 'unknown')
  );
}

function readPeerRegistrationContext(request: FastifyRequest) {
  const context = request as FastifyRequest & PeerRegistrationRequestContext;
  if (!context.peerRegistration) {
    throw new Error('Peer registration context missing after authorization');
  }
  return context.peerRegistration;
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

function normalizeReverseRegistrationStatus(
  value: string | null,
): 'pending' | 'ok' | 'failed' | null {
  if (value === 'pending' || value === 'ok' || value === 'failed') {
    return value;
  }
  return null;
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
    lastPingError: normalizePingErrorCategory(row.last_ping_error),
    lastPingStatusCode: row.last_ping_status_code ?? null,
    lastSeen: toIsoString(row.last_seen),
    createdAt: toIsoString(row.created_at),
    // §33.9: peer version observability captured on successful /health pings.
    peerVersion: row.peer_version ?? null,
    peerGitSha: row.peer_git_sha ?? null,
    peerSchemaVersion: row.peer_schema_version ?? null,
    // §33.8: outbound reverse registration outcome.
    reverseRegistrationStatus: normalizeReverseRegistrationStatus(row.reverse_registration_status),
    reverseRegistrationError: row.reverse_registration_error ?? null,
    reverseRegistrationAt: toIsoString(row.reverse_registration_at),
    // §33.10: schema-ahead envelope rejection tracking. When non-zero, the
    // apply-side compat gate has rejected one or more envelopes from this peer
    // because their `schemaVersion` exceeds the local CP by more than 1.
    lastSchemaAheadVersion: row.last_schema_ahead_version ?? null,
    lastSchemaAheadAt: toIsoString(row.last_schema_ahead_at),
    schemaAheadCount: row.schema_ahead_count ?? 0,
    // §33.8: cursor timestamps derived from sync_peer_cursors. Both fields
    // share the single `updated_at` column — the /cursors endpoint returns
    // the raw pulledCursor / ackedCursor values for deeper inspection.
    lastPullAt: toIsoString(row.last_pull_at ?? null),
    lastAckAt: toIsoString(row.last_ack_at ?? null),
  };
}

async function fetchPeer(db: Database, machineId: string): Promise<SyncPeerRow | null> {
  const result = await db.execute(sql`
    SELECT ${SYNC_NODE_COLUMNS}
    FROM sync_nodes
    WHERE id = ${machineId}
    LIMIT 1
  `);
  const [peer] = extractRows<SyncPeerRow>(result);
  return peer ?? null;
}

async function updateReverseRegistration(
  db: Database,
  machineId: string,
  outcome: ReverseRegistrationResult,
): Promise<SyncPeerRow | null> {
  const result = await db.execute(sql`
    UPDATE sync_nodes
    SET reverse_registration_status = ${outcome.status},
        reverse_registration_error = ${outcome.error},
        reverse_registration_at = now()
    WHERE id = ${machineId}
    RETURNING ${SYNC_NODE_COLUMNS}
  `);
  const [row] = extractRows<SyncPeerRow>(result);
  return row ?? null;
}

function normalizePingErrorCategory(value: string | null): PingErrorCategory | null {
  if (!value || !PING_ERROR_CATEGORIES.has(value)) {
    return null;
  }

  return value as PingErrorCategory;
}

function describeUnknownError(value: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = value;

  for (let depth = 0; current && depth < 4 && !seen.has(current); depth += 1) {
    seen.add(current);

    if (current instanceof Error) {
      parts.push(current.name, current.message);
      current = (current as Error & { cause?: unknown }).cause;
      continue;
    }

    if (typeof current === 'object') {
      const record = current as Record<string, unknown>;
      for (const key of ['name', 'code', 'message']) {
        const part = record[key];
        if (typeof part === 'string') {
          parts.push(part);
        }
      }
      current = record.cause;
      continue;
    }

    parts.push(String(current));
    break;
  }

  return parts.join(' ').toLowerCase();
}

function classifyPingError(error: unknown): PingErrorCategory {
  const details = describeUnknownError(error);

  if (details.includes('timeout') || details.includes('aborterror')) {
    return 'timeout';
  }

  if (details.includes('econnrefused') || details.includes('connection refused')) {
    return 'connect_refused';
  }

  if (
    details.includes('enotfound') ||
    details.includes('eai_again') ||
    details.includes('getaddrinfo')
  ) {
    return 'dns';
  }

  if (
    details.includes('eproto') ||
    details.includes('tls') ||
    details.includes('ssl') ||
    details.includes('certificate') ||
    details.includes('wrong version number')
  ) {
    return 'tls_handshake';
  }

  return 'other';
}

async function pingPeer(syncUrl: string): Promise<PingPeerResult> {
  try {
    const response = await fetch(`${syncUrl}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (response.ok) {
      // §33.9: capture peer version observability fields from the /health body.
      // Malformed JSON or missing fields must not fail the ping — the helper
      // returns EMPTY_PEER_VERSION_INFO in that case.
      const version = await readPeerVersionInfo(response);
      return { status: 'reachable', error: null, version };
    }

    return {
      status: 'unreachable',
      error: { category: 'http_status', httpStatusCode: response.status },
      version: EMPTY_PEER_VERSION_INFO,
    };
  } catch (error) {
    return {
      status: 'unreachable',
      error: { category: classifyPingError(error), httpStatusCode: null },
      version: EMPTY_PEER_VERSION_INFO,
    };
  }
}

function pingErrorResponse(error: PingError | null) {
  if (!error) {
    return null;
  }

  return {
    category: error.category,
    httpStatusCode: error.httpStatusCode,
  };
}

async function updatePingResult(
  db: Database,
  machineId: string,
  currentPeer: SyncPeerRow,
  result: PingPeerResult,
): Promise<SyncPeerRow | null> {
  const nextInterval = computeNextInterval(
    currentPeer.sync_interval_ms ?? DEFAULT_INTERVAL_MS,
    result.status,
  );

  const updateResult =
    result.status === 'reachable'
      ? await db.execute(sql`
          UPDATE sync_nodes
          SET sync_status = 'reachable',
              sync_interval_ms = ${nextInterval},
              last_ping_error = NULL,
              last_ping_status_code = NULL,
              last_seen = now(),
              peer_version = ${result.version.appVersion},
              peer_git_sha = ${result.version.gitSha},
              peer_schema_version = ${result.version.schemaVersion}
          WHERE id = ${machineId}
          RETURNING ${SYNC_NODE_COLUMNS}
        `)
      : await db.execute(sql`
          UPDATE sync_nodes
          SET sync_status = 'unreachable',
              sync_interval_ms = ${nextInterval},
              last_ping_error = ${result.error.category},
              last_ping_status_code = ${result.error.httpStatusCode}
          WHERE id = ${machineId}
          RETURNING ${SYNC_NODE_COLUMNS}
        `);

  const [updatedPeer] = extractRows<SyncPeerRow>(updateResult);
  return updatedPeer ?? null;
}

export const syncPeersRoutes: FastifyPluginAsync<SyncPeersRoutesOptions> = async (app, opts) => {
  const { db } = opts;

  /**
   * Attempt reverse registration against a newly-added peer and persist the
   * outcome. Returns the refreshed row when update succeeds, or null when the
   * feature is disabled (no self identity / signing key) or the row disappeared
   * between calls.
   */
  async function tryReverseRegistration(
    peer: SyncPeerRow,
  ): Promise<{ row: SyncPeerRow | null; result: ReverseRegistrationResult } | null> {
    const { selfIdentity, signingSecretKey } = opts;
    if (!selfIdentity || !signingSecretKey || !peer.sync_url || peer.is_self) {
      return null;
    }

    const outcome = await performReverseRegistration({
      targetSyncUrl: peer.sync_url,
      self: selfIdentity,
      signingSecretKey,
      registrationToken: opts.reverseRegistrationToken ?? null,
      fetchImpl: opts.fetchImpl,
      logger: opts.logger,
    });

    const row = await updateReverseRegistration(db, peer.id, outcome);
    return { row, result: outcome };
  }
  const registrationRateLimitMax = readRateLimitEnv(
    'SYNC_PEER_REGISTRATION_RATE_LIMIT_MAX',
    REGISTRATION_RATE_LIMIT.max,
  );
  const registrationRateLimitWindowMs = readRateLimitEnv(
    'SYNC_PEER_REGISTRATION_RATE_LIMIT_WINDOW_MS',
    REGISTRATION_RATE_LIMIT.windowMs,
  );
  const registrationRateLimitConfig = {
    max: registrationRateLimitMax,
    timeWindow: registrationRateLimitWindowMs,
    keyGenerator: getRateLimitKey,
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'RATE_LIMITED',
      message: 'Too many registration attempts',
    }),
  } as const;

  await app.register(rateLimit, {
    global: false,
    keyGenerator: getRateLimitKey,
    errorResponseBuilder: registrationRateLimitConfig.errorResponseBuilder,
  });

  const authorizePeerRegistration = async (
    request: FastifyRequest<{ Body: RegisterSyncPeerBody }>,
    reply: FastifyReply,
  ) => {
    const registrationToken = getRegistrationToken(opts.registrationToken);
    if (!registrationToken) {
      return reply.code(503).send({
        error: 'PEER_REGISTRATION_DISABLED',
        message: 'Peer registration requires SYNC_PEER_REGISTRATION_TOKEN',
      });
    }

    const suppliedToken = readHeaderValue(request.headers['x-sync-registration-token']);
    if (!suppliedToken) {
      return reply.code(401).send({
        error: 'PEER_REGISTRATION_TOKEN_MISSING',
        message: 'X-Sync-Registration-Token header is required',
      });
    }

    if (!tokensEqual(suppliedToken, registrationToken)) {
      return reply.code(403).send({
        error: 'PEER_REGISTRATION_TOKEN_INVALID',
        message: 'Peer registration token is invalid',
      });
    }

    const { machineId, hostname, tailscaleIp, syncUrl, publicKey, registrationSignature } =
      request.body ?? {};

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

    const publicKeyResult = validateRequiredString(publicKey, {
      field: 'publicKey',
      error: 'INVALID_PUBLIC_KEY',
      maxLength: MAX_PUBLIC_KEY_LENGTH,
    });
    if (!publicKeyResult.ok) {
      return reply.code(400).send(validationFailureBody(publicKeyResult));
    }

    const registrationFields = {
      machineId: machineIdResult.value,
      hostname: hostnameResult.value,
      syncUrl: syncUrlResult.value,
      tailscaleIp: tailscaleIpResult.value,
      publicKey: publicKeyResult.value,
    };
    if (!verifyPeerRegistrationSignature(registrationSignature, registrationFields)) {
      return reply.code(403).send({
        error: 'PEER_REGISTRATION_INVALID_SIGNATURE',
        message: 'Peer registration signature verification failed',
      });
    }

    (request as FastifyRequest & PeerRegistrationRequestContext).peerRegistration =
      registrationFields;
  };

  app.get(
    '/',
    {
      schema: {
        tags: ['sync'],
        summary: 'List mesh sync peers',
      },
    },
    async () => {
      // §33.8: LEFT JOIN sync_peer_cursors so each peer row carries its
      // `lastPullAt`/`lastAckAt` timestamps. The cursor row is keyed by the
      // local node's own sync_nodes.id (`is_self = true`); peers without any
      // pull/ack activity leave the joined columns NULL, which the UI renders
      // as "stale (no sync in >10 min)".
      const result = await db.execute(sql`
        SELECT ${SYNC_NODE_JOIN_COLUMNS}
        FROM sync_nodes sn
        LEFT JOIN sync_peer_cursors spc
          ON spc.remote_node_id = sn.id
         AND spc.local_node_id = (
           SELECT id FROM sync_nodes WHERE is_self = true LIMIT 1
         )
        ORDER BY sn.hostname ASC, sn.id ASC
      `);

      return {
        peers: extractRows<SyncPeerRow>(result).map(mapSyncPeerRow),
      };
    },
  );

  /**
   * §33.8 — Return the raw `sync_peer_cursors` row for a peer so the mesh
   * health panel can reveal last-pull / last-ack state on row expansion.
   *
   * 404 when no peer exists with that id, 404 when no cursor row has been
   * materialized yet (no sync has taken place), and 200 with the full row
   * otherwise.
   */
  app.get<{ Params: { machineId: string } }>(
    '/:machineId/cursors',
    {
      schema: {
        tags: ['sync'],
        summary: 'Return sync cursor state for a peer (§33.8)',
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

      const trimmed = machineId.trim();
      const peer = await fetchPeer(db, trimmed);
      if (!peer) {
        return reply.code(404).send({
          error: 'SYNC_PEER_NOT_FOUND',
          message: `Sync peer '${trimmed}' not found`,
        });
      }

      const cursorResult = await db.execute(sql`
        SELECT local_node_id, remote_node_id, pulled_cursor, acked_cursor, updated_at
        FROM sync_peer_cursors
        WHERE remote_node_id = ${trimmed}
          AND local_node_id = (
            SELECT id FROM sync_nodes WHERE is_self = true LIMIT 1
          )
        LIMIT 1
      `);
      const [row] = extractRows<{
        local_node_id: string;
        remote_node_id: string;
        pulled_cursor: number | string | null;
        acked_cursor: number | string | null;
        updated_at: string | Date | null;
      }>(cursorResult);

      if (!row) {
        return reply.code(404).send({
          error: 'SYNC_PEER_CURSORS_NOT_FOUND',
          message: `No cursor state recorded for peer '${trimmed}' yet`,
        });
      }

      const updatedAt = toIsoString(row.updated_at ?? null);
      return reply.send({
        machineId: trimmed,
        localNodeId: row.local_node_id,
        remoteNodeId: row.remote_node_id,
        pulledCursor: Number(row.pulled_cursor ?? 0),
        ackedCursor: Number(row.acked_cursor ?? 0),
        // Both share the same `updated_at` column; the aliasing keeps the
        // response compatible with the summary panel's peer payload.
        lastPullAt: updatedAt,
        lastAckAt: updatedAt,
        updatedAt,
      });
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
        RETURNING ${SYNC_NODE_COLUMNS}
      `);
      const [peer] = extractRows<SyncPeerRow>(result);

      // §33.8: fire a reverse registration handshake so the remote peer also
      // knows about us. Failures do NOT roll back — operator can retry from
      // the UI via POST /:peerId/register-reverse.
      let refreshed: SyncPeerRow | null = peer ?? null;
      if (peer) {
        const reverse = await tryReverseRegistration(peer);
        if (reverse?.row) {
          refreshed = reverse.row;
        }
      }

      return reply.code(201).send({
        ok: true,
        peer: refreshed ? mapSyncPeerRow(refreshed) : null,
      });
    },
  );

  app.post<{ Params: { machineId: string } }>(
    '/:machineId/register-reverse',
    {
      schema: {
        tags: ['sync'],
        summary: 'Retry reverse registration against an existing peer (§33.8)',
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

      if (peer.is_self) {
        return reply.code(400).send({
          error: 'REVERSE_REGISTRATION_NOT_APPLICABLE',
          message: 'Cannot reverse-register with self',
        });
      }

      if (!isNonEmptyString(peer.sync_url)) {
        return reply.code(400).send({
          error: 'SYNC_PEER_MISSING_URL',
          message: `Sync peer '${machineId}' does not have a syncUrl configured`,
        });
      }

      if (!opts.selfIdentity || !opts.signingSecretKey) {
        return reply.code(503).send({
          error: 'REVERSE_REGISTRATION_DISABLED',
          message: 'Reverse registration requires self identity and signing key',
        });
      }

      const attempt = await tryReverseRegistration(peer);
      const refreshed = attempt?.row ?? peer;
      if (!attempt || attempt.result.status === 'ok') {
        return reply.code(200).send({
          ok: true,
          status: 'ok',
          peer: mapSyncPeerRow(refreshed),
        });
      }

      // Failed outcome — return 502 so the UI can render a distinct error,
      // while still including the persisted row for the inline badge.
      return reply.code(502).send({
        ok: false,
        error: 'REVERSE_REGISTRATION_FAILED',
        message: attempt.result.error ?? 'Reverse registration failed',
        peer: mapSyncPeerRow(refreshed),
      });
    },
  );

  app.post<{ Body: RegisterSyncPeerBody }>(
    '/register',
    {
      config: { rateLimit: registrationRateLimitConfig },
      schema: {
        tags: ['sync'],
        summary: 'Register a reverse mesh sync peer',
      },
      preHandler: [app.rateLimit(registrationRateLimitConfig), authorizePeerRegistration],
    },
    // @fastify/rate-limit runs before bootstrap token and register-peer signature verification;
    // CodeQL only models legacy fastify-rate-limit for this rule.
    // codeql[js/missing-rate-limiting]
    async (request, reply) => {
      const registrationFields = readPeerRegistrationContext(request);

      const result = await db.execute(sql`
        INSERT INTO sync_nodes (id, hostname, tailscale_ip, sync_url, role, sync_status, sync_interval_ms, is_self, public_key)
        VALUES (
          ${registrationFields.machineId},
          ${registrationFields.hostname},
          ${registrationFields.tailscaleIp},
          ${registrationFields.syncUrl},
          'full',
          'unknown',
          ${DEFAULT_INTERVAL_MS},
          false,
          ${registrationFields.publicKey}
        )
        ON CONFLICT (id) DO UPDATE SET
          hostname = EXCLUDED.hostname,
          tailscale_ip = EXCLUDED.tailscale_ip,
          sync_url = EXCLUDED.sync_url,
          role = EXCLUDED.role,
          sync_status = EXCLUDED.sync_status,
          sync_interval_ms = EXCLUDED.sync_interval_ms,
          is_self = false,
          public_key = EXCLUDED.public_key
        RETURNING ${SYNC_NODE_COLUMNS}
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
        RETURNING ${SYNC_NODE_COLUMNS}
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
        const result: PingPeerResult = {
          status: 'unreachable',
          error: { category: 'bad_url', httpStatusCode: null },
          version: EMPTY_PEER_VERSION_INFO,
        };
        const updatedPeer = await updatePingResult(db, machineId.trim(), peer, result);

        return reply.code(400).send({
          ...validationFailureBody(syncUrlResult),
          pingError: pingErrorResponse(result.error),
          peer: updatedPeer ? mapSyncPeerRow(updatedPeer) : mapSyncPeerRow(peer),
        });
      }

      const result = await pingPeer(syncUrlResult.value);
      const updatedPeer = await updatePingResult(db, machineId.trim(), peer, result);

      return {
        ok: true,
        status: result.status,
        pingError: pingErrorResponse(result.error),
        peer: updatedPeer ? mapSyncPeerRow(updatedPeer) : mapSyncPeerRow(peer),
      };
    },
  );

  /**
   * §33.7 — List Tailscale mesh-node peers that are not yet registered in
   * `sync_nodes`. Shells out to `tailscale status --json`, filters to
   * `Online && tag:mesh-node`, probes each candidate's `/health` on port 8080,
   * and returns an enriched list the operator can bulk-add.
   *
   * Never throws — missing Tailscale, unreachable peers, and /health without
   * `machineId` all degrade into `reachable: false` entries so the UI can
   * still render something meaningful.
   */
  app.get(
    '/discover',
    {
      schema: {
        tags: ['sync'],
        summary: 'Discover Tailscale mesh-node peer candidates (§33.7)',
      },
    },
    async (_request, reply) => {
      const source = opts.tailscalePeerSource ?? fetchTailscaleMeshPeers;
      const discoveryLogger = opts.logger ?? { debug: () => undefined, warn: () => undefined };
      const candidates = await source(discoveryLogger);

      if (candidates.length === 0) {
        return reply.code(200).send({ peers: [], source: 'none' });
      }

      const existingResult = await db.execute(sql`SELECT id FROM sync_nodes`);
      const existingIds = new Set(
        extractRows<{ id: string }>(existingResult)
          .map((row) => row.id)
          .filter(isNonEmptyString),
      );

      const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
      const probed = await Promise.all(
        candidates.map(async (candidate) => {
          const syncUrl = `http://${candidate.tailscaleIp}:8080`;
          const probe = await probePeerHealth(syncUrl, fetchImpl);
          return { candidate, probe };
        }),
      );

      const peers = probed
        .filter(({ probe }) => {
          // Drop already-registered peers (by machineId reported from /health).
          // Unreachable candidates still surface so the operator can see them.
          if (probe.reachable && probe.identity.machineId) {
            return !existingIds.has(probe.identity.machineId);
          }
          return true;
        })
        .map(({ candidate, probe }) => ({
          hostname: candidate.hostname,
          tailscaleIp: candidate.tailscaleIp,
          syncUrl: probe.syncUrl,
          reachable: probe.reachable,
          machineId: probe.reachable ? probe.identity.machineId : null,
          nodePublicKey: probe.reachable ? probe.identity.nodePublicKey : null,
          appVersion: probe.reachable ? probe.identity.appVersion : null,
          schemaVersion: probe.reachable ? probe.identity.schemaVersion : null,
          error: probe.reachable ? null : probe.error,
        }));

      return reply.code(200).send({ peers, source: 'tailscale' });
    },
  );

  /**
   * §33.7 — Probe a single candidate target (hostname, IP literal, or full
   * http/https URL) and return `/health` identity + version metadata. Used by
   * the add-peer dialog's "Probe" button so the operator can auto-fill
   * `machineId` / `publicKey` / `syncUrl` before saving.
   *
   * SSRF-validated via `deriveSyncUrlFromTarget` (same block-list as
   * `validateSyncUrl`). Rate-limited implicitly via the plugin-scoped limiter
   * already registered for `/register`.
   */
  app.get<{ Querystring: { target?: string } }>(
    '/probe',
    {
      schema: {
        tags: ['sync'],
        summary: 'Probe a candidate mesh peer /health endpoint (§33.7)',
      },
    },
    async (request, reply) => {
      const derived = deriveSyncUrlFromTarget(request.query.target);
      if (!derived.ok) {
        return reply.code(400).send({ error: 'INVALID_TARGET', message: derived.error });
      }

      const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
      const probe: ProbePeerResult = await probePeerHealth(derived.syncUrl, fetchImpl);

      if (!probe.reachable) {
        return reply.code(200).send({
          reachable: false,
          syncUrl: probe.syncUrl,
          statusCode: probe.statusCode,
          error: probe.error,
        });
      }

      return reply.code(200).send({
        reachable: true,
        syncUrl: probe.syncUrl,
        statusCode: probe.statusCode,
        machineId: probe.identity.machineId,
        nodePublicKey: probe.identity.nodePublicKey,
        appVersion: probe.identity.appVersion,
        gitSha: probe.identity.gitSha,
        schemaVersion: probe.identity.schemaVersion,
      });
    },
  );
};
