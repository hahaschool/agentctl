// ---------------------------------------------------------------------------
// Mesh peer self-update route — roadmap §33.11 slice 1.
//
// Flow: operator on CP-A signs and POSTs `/api/sync/peers/:peerId/update` to
// CP-B. CP-B authenticates the request via the existing mesh peer signature
// (`verifyPeerSignature`), checks that `:peerId` matches its own local
// machineId, and runs `scripts/peer-update.sh` to self-update in place.
//
// Scope of slice 1 is intentionally narrow — no Docker path, no launchd/
// systemd timers, no CLI, no /api/version-compat, no two-node Playwright
// fixture. See docs/ROADMAP.md §33.11 for the deferred items.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import rateLimit from '@fastify/rate-limit';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { getAppVersion } from '../../build-info.js';
import type { Database } from '../../db/index.js';
import { extractRows } from '../../db/index.js';
import { createPeerSignedHeader, verifyPeerSignature } from '../../sync/peer-auth.js';
import { loadKnownPeers } from '../../sync/sync-auth.js';
import { readRateLimitEnv } from '../rate-limit.js';

const CURRENT_FILE_DIR = path.dirname(fileURLToPath(import.meta.url));
// Navigate to the monorepo root from either src/api/routes (dev/vitest)
// or dist/api/routes (compiled JS). Both are inside packages/control-plane/.
const PACKAGE_ROOT = path.resolve(CURRENT_FILE_DIR, '..', '..', '..');
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const DEFAULT_SCRIPT_PATH = path.join(MONOREPO_ROOT, 'scripts', 'peer-update.sh');
const DEFAULT_PM2_ECOSYSTEM = 'agentctl-beta';
const OUTPUT_TAIL_BYTES = 4_096;
const PROXY_TIMEOUT_MS = 120_000;
const PEER_UPDATE_RATE_LIMIT = {
  max: 10,
  timeWindow: 60_000,
} as const;

/**
 * Structured error codes surfaced by the update route. Kept narrow so the
 * frontend can match on them without string parsing.
 */
export type PeerUpdateErrorCode =
  | 'PEER_UPDATE_NOT_LOCAL'
  | 'PEER_UPDATE_IN_PROGRESS'
  | 'PEER_UPDATE_SCRIPT_FAILED'
  | 'PEER_UPDATE_HEALTH_TIMEOUT'
  | 'PEER_UPDATE_PROXY_FAILED'
  | 'PEER_UPDATE_PROXY_NO_URL'
  | 'PEER_UPDATE_PROXY_NO_KEY';

export type PeerUpdateError = {
  error: PeerUpdateErrorCode;
  message: string;
};

export type PeerUpdateScriptResult = {
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
};

/**
 * Injectable script runner. The real implementation shells out to
 * `scripts/peer-update.sh`; tests replace this with a deterministic stub so
 * the suite never mutates the checkout or talks to PM2.
 */
export type RunScriptFn = (opts: {
  scriptPath: string;
  pm2Ecosystem: string;
}) => Promise<PeerUpdateScriptResult>;

export type SyncPeerUpdateRoutesOptions = {
  db: Database;
  selfMachineId: string;
  /** Ed25519 secret key for signing forwarded update requests to remote peers. */
  signingSecretKey?: string | null;
  /** Injected fetch for tests. */
  fetchImpl?: typeof fetch;
  runScript?: RunScriptFn;
  scriptPath?: string;
  pm2Ecosystem?: string;
};

type PeerUpdateStatus = 'success' | 'failed';

export type PeerUpdateSuccessResponse = {
  status: PeerUpdateStatus;
  durationMs: number;
  previousVersion: string;
  newVersion: string;
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
};

// Module-level mutex: ensures only one update may be in flight per process.
// Concurrent requests receive 409 `PEER_UPDATE_IN_PROGRESS`.
let updateInFlight = false;

function errorResponse(code: PeerUpdateErrorCode, message: string): PeerUpdateError {
  return { error: code, message };
}

function tailBytes(value: string, maxBytes: number): string {
  if (value.length <= maxBytes) return value;
  return value.slice(value.length - maxBytes);
}

type SyncNodeRow = {
  id: string;
  sync_url: string | null;
  is_self: boolean;
};

/**
 * Proxy a `/:peerId/update` request to a remote peer by signing it with
 * `createPeerSignedHeader` and forwarding to the peer's `syncUrl`.
 * This is the path taken when the local web UI clicks "Update" on a
 * remote peer row — the browser calls the local CP, which then signs
 * and forwards to the remote CP.
 */
async function proxyUpdateToRemotePeer(
  peerId: string,
  db: Database,
  selfMachineId: string,
  signingSecretKey: string | null,
  fetchImpl: typeof fetch,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (!signingSecretKey) {
    return reply
      .code(503)
      .send(
        errorResponse(
          'PEER_UPDATE_PROXY_NO_KEY',
          'Cannot forward update — signing key not configured on this node',
        ),
      );
  }

  const result = await db.execute(
    sql`SELECT id, sync_url, is_self FROM sync_nodes WHERE id = ${peerId} AND NOT is_self LIMIT 1`,
  );
  const rows = extractRows<SyncNodeRow>(result);
  const peer = rows[0];

  if (!peer?.sync_url) {
    return reply
      .code(404)
      .send(
        errorResponse(
          'PEER_UPDATE_PROXY_NO_URL',
          `Peer '${peerId}' not found or has no syncUrl configured`,
        ),
      );
  }

  const targetPath = `/api/sync/peers/${encodeURIComponent(peerId)}/update`;
  // Sign with the parsed object so the body hash matches what the remote
  // Fastify handler sees after JSON parsing (stableStringify({}) = "{}").
  const bodyObj = {};
  const authHeader = createPeerSignedHeader(
    selfMachineId,
    'POST',
    targetPath,
    bodyObj,
    signingSecretKey,
  );

  const targetUrl = `${peer.sync_url.replace(/\/+$/, '')}${targetPath}`;

  try {
    const upstream = await fetchImpl(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sync-Auth': authHeader,
      },
      body: JSON.stringify(bodyObj),
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });

    const responseBody = await upstream.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(responseBody);
    } catch {
      parsed = { raw: responseBody };
    }

    return reply.code(upstream.status).send(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    request.log.error({ err, peerId, targetUrl }, 'peer-update proxy failed');
    return reply
      .code(502)
      .send(errorResponse('PEER_UPDATE_PROXY_FAILED', `Failed to reach peer: ${message}`));
  }
}

/**
 * Default implementation of {@link RunScriptFn}. Spawns the peer-update
 * shell script with the configured PM2 ecosystem name and captures tail
 * portions of stdout/stderr for structured logging.
 */
export const defaultRunScript: RunScriptFn = ({ scriptPath, pm2Ecosystem }) =>
  new Promise((resolve, reject) => {
    const child = spawn('/bin/bash', [scriptPath], {
      env: {
        ...process.env,
        AGENTCTL_PM2_ECOSYSTEM: pm2Ecosystem,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > OUTPUT_TAIL_BYTES * 4) {
        stdout = tailBytes(stdout, OUTPUT_TAIL_BYTES * 2);
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > OUTPUT_TAIL_BYTES * 4) {
        stderr = tailBytes(stderr, OUTPUT_TAIL_BYTES * 2);
      }
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      resolve({
        exitCode: code ?? -1,
        stdoutTail: tailBytes(stdout, OUTPUT_TAIL_BYTES),
        stderrTail: tailBytes(stderr, OUTPUT_TAIL_BYTES),
      });
    });
  });

async function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  db: Database,
): Promise<boolean> {
  const authHeader = request.headers['x-sync-auth'];
  if (!authHeader || typeof authHeader !== 'string') {
    await reply.code(401).send({
      error: 'SYNC_AUTH_MISSING',
      message: 'X-Sync-Auth header is required',
    });
    return false;
  }

  const knownPeers = await loadKnownPeers(db);
  const body = request.method === 'GET' ? '' : (request.body ?? '');
  const urlPath = request.url.split('?')[0] ?? request.url;
  const verification = verifyPeerSignature(authHeader, request.method, urlPath, body, knownPeers);

  if (!verification.valid || !verification.machineId) {
    await reply.code(401).send({
      error: 'SYNC_AUTH_INVALID',
      message: 'Peer signature verification failed',
    });
    return false;
  }

  return true;
}

export const syncPeerUpdateRoutes: FastifyPluginAsync<SyncPeerUpdateRoutesOptions> = async (
  app,
  opts,
) => {
  const {
    db,
    selfMachineId,
    signingSecretKey = null,
    fetchImpl = globalThis.fetch,
    runScript = defaultRunScript,
    scriptPath = DEFAULT_SCRIPT_PATH,
    pm2Ecosystem = process.env.AGENTCTL_PM2_ECOSYSTEM ?? DEFAULT_PM2_ECOSYSTEM,
  } = opts;
  const peerUpdateRateLimitError = () => ({
    statusCode: 429,
    error: 'RATE_LIMITED',
    message: 'Too many peer update requests',
  });
  const peerUpdateFastifyRateLimit = {
    max: readRateLimitEnv('PEER_UPDATE_RATE_LIMIT_MAX', PEER_UPDATE_RATE_LIMIT.max),
    timeWindow: readRateLimitEnv(
      'PEER_UPDATE_RATE_LIMIT_WINDOW_MS',
      PEER_UPDATE_RATE_LIMIT.timeWindow,
    ),
    errorResponseBuilder: peerUpdateRateLimitError,
  } as const;

  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) =>
      request.ip ??
      (typeof request.headers['x-forwarded-for'] === 'string'
        ? request.headers['x-forwarded-for']
        : 'unknown'),
    errorResponseBuilder: peerUpdateRateLimitError,
  });

  app.post<{ Params: { peerId: string } }>(
    '/:peerId/update',
    {
      schema: {
        tags: ['sync'],
        summary:
          'Trigger a peer update — runs locally when peerId matches self, proxies to remote peer otherwise',
      },
      config: { rateLimit: peerUpdateFastifyRateLimit },
      preHandler: [app.rateLimit(peerUpdateFastifyRateLimit)],
    },
    async (request, reply) => {
      const { peerId } = request.params;

      // ── Remote peer: sign and forward ───────────────────────────────
      if (peerId !== selfMachineId) {
        return proxyUpdateToRemotePeer(
          peerId,
          db,
          selfMachineId,
          signingSecretKey,
          fetchImpl,
          request,
          reply,
        );
      }

      // ── Local self-update: verify X-Sync-Auth first ─────────────────
      const authorized = await authorize(request, reply, db);
      if (!authorized) return reply;

      if (updateInFlight) {
        return reply
          .code(409)
          .send(
            errorResponse(
              'PEER_UPDATE_IN_PROGRESS',
              'A peer update is already in progress on this node',
            ),
          );
      }

      updateInFlight = true;
      const startedAt = Date.now();
      const previousVersion = getAppVersion();

      try {
        const result = await runScript({ scriptPath, pm2Ecosystem });
        const durationMs = Date.now() - startedAt;

        if (result.exitCode !== 0) {
          request.log.error(
            {
              peerId,
              exitCode: result.exitCode,
              durationMs,
            },
            'peer-update script exited non-zero',
          );
          return reply.code(500).send({
            ...errorResponse(
              'PEER_UPDATE_SCRIPT_FAILED',
              `peer-update script exited with code ${result.exitCode}`,
            ),
            exitCode: result.exitCode,
            durationMs,
            stdoutTail: result.stdoutTail,
            stderrTail: result.stderrTail,
          });
        }

        // getAppVersion() caches its result, so after the rebuild the fresh
        // process will re-read package.json; in this process we report the
        // value it exposes right now (tests flip this between calls).
        const newVersion = getAppVersion();
        const response: PeerUpdateSuccessResponse = {
          status: 'success',
          durationMs,
          previousVersion,
          newVersion,
          exitCode: result.exitCode,
          stdoutTail: result.stdoutTail,
          stderrTail: result.stderrTail,
        };
        return reply.code(200).send(response);
      } catch (err) {
        const durationMs = Date.now() - startedAt;
        request.log.error({ err, peerId, durationMs }, 'peer-update script threw');
        return reply.code(500).send({
          ...errorResponse(
            'PEER_UPDATE_SCRIPT_FAILED',
            err instanceof Error ? err.message : 'peer-update script failed',
          ),
          exitCode: -1,
          durationMs,
          stdoutTail: '',
          stderrTail: err instanceof Error ? err.message : String(err),
        });
      } finally {
        updateInFlight = false;
      }
    },
  );
};

/** Test-only helper — resets the module-level mutex between specs. */
export function __resetPeerUpdateMutexForTests(): void {
  updateInFlight = false;
}
