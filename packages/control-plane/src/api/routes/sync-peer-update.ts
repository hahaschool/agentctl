// ---------------------------------------------------------------------------
// Mesh peer self-update route — roadmap §33.11.
//
// Flow: operator on CP-A clicks "Update" on a remote peer row → browser
// POSTs to CP-A → CP-A signs and forwards to CP-B → CP-B authenticates,
// spawns `scripts/peer-update.sh` **asynchronously**, and returns a jobId.
// The browser then connects to an SSE endpoint (proxied through CP-A) to
// stream live stdout/stderr from the update script.
//
// The script ends with `pm2 reload` which kills the CP process, so the SSE
// stream will always drop at completion. The frontend detects the disconnect
// and polls the peer's /health to confirm the new version.
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
import type { JobResult, PeerUpdateJobStore } from '../../sync/peer-update-jobs.js';
import { loadKnownPeers } from '../../sync/sync-auth.js';
import { readRateLimitEnv } from '../rate-limit.js';

const CURRENT_FILE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(CURRENT_FILE_DIR, '..', '..', '..');
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const DEFAULT_SCRIPT_PATH = path.join(MONOREPO_ROOT, 'scripts', 'peer-update.sh');
const DEFAULT_PM2_ECOSYSTEM = 'agentctl-beta';
const PROXY_TIMEOUT_MS = 120_000;
const PEER_UPDATE_RATE_LIMIT = {
  max: 10,
  timeWindow: 60_000,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PeerUpdateErrorCode =
  | 'PEER_UPDATE_NOT_LOCAL'
  | 'PEER_UPDATE_IN_PROGRESS'
  | 'PEER_UPDATE_SCRIPT_FAILED'
  | 'PEER_UPDATE_HEALTH_TIMEOUT'
  | 'PEER_UPDATE_PROXY_FAILED'
  | 'PEER_UPDATE_PROXY_NO_URL'
  | 'PEER_UPDATE_PROXY_NO_KEY'
  | 'PEER_UPDATE_JOB_NOT_FOUND';

export type PeerUpdateError = {
  error: PeerUpdateErrorCode;
  message: string;
};

export type PeerUpdateScriptResult = {
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
};

/** Response from POST /:peerId/update — the update runs asynchronously. */
export type PeerUpdateStartedResponse = {
  jobId: string;
  status: 'started';
  previousVersion: string;
};

/** Injectable script runner for tests. */
export type RunScriptFn = (opts: {
  scriptPath: string;
  pm2Ecosystem: string;
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
}) => Promise<PeerUpdateScriptResult>;

export type SyncPeerUpdateRoutesOptions = {
  db: Database;
  selfMachineId: string;
  jobStore: PeerUpdateJobStore;
  signingSecretKey?: string | null;
  fetchImpl?: typeof fetch;
  runScript?: RunScriptFn;
  scriptPath?: string;
  pm2Ecosystem?: string;
};

// Keep the old response type for backward compat (used by tests)
export type PeerUpdateSuccessResponse = {
  status: 'success' | 'failed';
  durationMs: number;
  previousVersion: string;
  newVersion: string;
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const OUTPUT_TAIL_BYTES = 4_096;

// ---------------------------------------------------------------------------
// Default script runner — streams line-by-line via callbacks
// ---------------------------------------------------------------------------

export const defaultRunScript: RunScriptFn = ({ scriptPath, pm2Ecosystem, onStdout, onStderr }) =>
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
    let stdoutBuffer = '';
    let stderrBuffer = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stdout += text;
      if (stdout.length > OUTPUT_TAIL_BYTES * 4) {
        stdout = tailBytes(stdout, OUTPUT_TAIL_BYTES * 2);
      }
      // Buffer and emit complete lines
      stdoutBuffer += text;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.length > 0) onStdout?.(line);
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderr += text;
      if (stderr.length > OUTPUT_TAIL_BYTES * 4) {
        stderr = tailBytes(stderr, OUTPUT_TAIL_BYTES * 2);
      }
      stderrBuffer += text;
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.length > 0) onStderr?.(line);
      }
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      // Flush remaining buffered text
      if (stdoutBuffer.length > 0) onStdout?.(stdoutBuffer);
      if (stderrBuffer.length > 0) onStderr?.(stderrBuffer);
      resolve({
        exitCode: code ?? -1,
        stdoutTail: tailBytes(stdout, OUTPUT_TAIL_BYTES),
        stderrTail: tailBytes(stderr, OUTPUT_TAIL_BYTES),
      });
    });
  });

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Proxy helpers (remote peer update)
// ---------------------------------------------------------------------------

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

    // Attach the remote's syncUrl so the frontend knows where to connect for SSE
    if (upstream.ok && typeof parsed === 'object' && parsed !== null) {
      (parsed as Record<string, unknown>).remoteSyncUrl = peer.sync_url;
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

/** Proxy an SSE log stream from a remote peer to the local frontend. */
async function proxyLogStream(
  peerId: string,
  jobId: string,
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
      .send(errorResponse('PEER_UPDATE_PROXY_NO_KEY', 'Signing key not configured'));
  }

  const result = await db.execute(
    sql`SELECT id, sync_url, is_self FROM sync_nodes WHERE id = ${peerId} AND NOT is_self LIMIT 1`,
  );
  const rows = extractRows<SyncNodeRow>(result);
  const peer = rows[0];

  if (!peer?.sync_url) {
    return reply
      .code(404)
      .send(errorResponse('PEER_UPDATE_PROXY_NO_URL', `Peer '${peerId}' not found`));
  }

  const targetPath = `/api/sync/peers/${encodeURIComponent(peerId)}/update/${encodeURIComponent(jobId)}/log`;
  const authHeader = createPeerSignedHeader(selfMachineId, 'GET', targetPath, '', signingSecretKey);

  const targetUrl = `${peer.sync_url.replace(/\/+$/, '')}${targetPath}`;

  try {
    const upstream = await fetchImpl(targetUrl, {
      headers: { 'X-Sync-Auth': authHeader },
      signal: request.raw.destroyed ? AbortSignal.abort() : AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });

    if (!upstream.ok || !upstream.body) {
      return reply
        .code(upstream.status)
        .send({ error: 'PROXY_FAILED', message: upstream.statusText });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    const pump = async (): Promise<void> => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || reply.raw.destroyed) break;
        reply.raw.write(decoder.decode(value, { stream: true }));
      }
      if (!reply.raw.destroyed) reply.raw.end();
    };

    request.raw.on('close', () => {
      reader.cancel().catch(() => {});
    });

    void pump();
    return reply;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    request.log.error({ err, peerId, targetUrl }, 'peer-update log proxy failed');
    return reply
      .code(502)
      .send(errorResponse('PEER_UPDATE_PROXY_FAILED', `Failed to stream logs: ${message}`));
  }
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export const syncPeerUpdateRoutes: FastifyPluginAsync<SyncPeerUpdateRoutesOptions> = async (
  app,
  opts,
) => {
  const {
    db,
    selfMachineId,
    jobStore,
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

  // ── POST /:peerId/update — kick off update, return jobId ────────────
  app.post<{ Params: { peerId: string } }>(
    '/:peerId/update',
    {
      schema: {
        tags: ['sync'],
        summary: 'Start a peer update — returns jobId for log streaming',
      },
      config: { rateLimit: peerUpdateFastifyRateLimit },
      preHandler: [app.rateLimit(peerUpdateFastifyRateLimit)],
    },
    async (request, reply) => {
      const { peerId } = request.params;

      // ── Remote peer: sign and forward ─────────────────────────────
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

      // ── Local self-update ─────────────────────────────────────────
      const authorized = await authorize(request, reply, db);
      if (!authorized) return reply;

      // Check if an update is already running for this peer
      const existing = jobStore.getActiveJobForPeer(peerId);
      if (existing) {
        return reply.code(409).send({
          ...errorResponse(
            'PEER_UPDATE_IN_PROGRESS',
            'A peer update is already in progress on this node',
          ),
          jobId: existing.id,
        });
      }

      const previousVersion = getAppVersion();
      const job = jobStore.createJob(peerId);

      request.log.info({ jobId: job.id, peerId, previousVersion }, 'peer-update started');

      // Run the script asynchronously — do NOT await
      void (async () => {
        try {
          const result = await runScript({
            scriptPath,
            pm2Ecosystem,
            onStdout: (line) => jobStore.pushLog(job.id, 'stdout', line),
            onStderr: (line) => jobStore.pushLog(job.id, 'stderr', line),
          });

          const newVersion = getAppVersion();
          const jobResult: JobResult = {
            exitCode: result.exitCode,
            durationMs: Date.now() - job.startedAt,
            previousVersion,
            newVersion,
          };

          if (result.exitCode !== 0) {
            jobStore.fail(
              job.id,
              `peer-update script exited with code ${result.exitCode}`,
              jobResult,
            );
          } else {
            jobStore.complete(job.id, jobResult);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          jobStore.fail(job.id, message, {
            exitCode: -1,
            durationMs: Date.now() - job.startedAt,
            previousVersion,
            newVersion: previousVersion,
          });
        }
      })();

      return reply.code(202).send({
        jobId: job.id,
        status: 'started',
        previousVersion,
      } satisfies PeerUpdateStartedResponse);
    },
  );

  // ── GET /:peerId/update/:jobId/log — SSE stream of update logs ──────
  app.get<{ Params: { peerId: string; jobId: string } }>(
    '/:peerId/update/:jobId/log',
    {
      schema: {
        tags: ['sync'],
        summary: 'Stream live update logs via SSE',
      },
    },
    async (request, reply) => {
      const { peerId, jobId } = request.params;

      // Remote peer: proxy SSE
      if (peerId !== selfMachineId) {
        return proxyLogStream(
          peerId,
          jobId,
          db,
          selfMachineId,
          signingSecretKey,
          fetchImpl,
          request,
          reply,
        );
      }

      // Local log streaming — the POST that created the job already required
      // X-Sync-Auth. The log endpoint is read-only and needs to work with
      // EventSource (which doesn't support custom headers), so we authenticate
      // only when an X-Sync-Auth header is present (cross-peer proxy case).
      // Browser-origin requests are implicitly trusted via same-origin policy.
      if (request.headers['x-sync-auth']) {
        const authorized = await authorize(request, reply, db);
        if (!authorized) return reply;
      }

      const job = jobStore.getJob(jobId);
      if (!job) {
        return reply
          .code(404)
          .send(errorResponse('PEER_UPDATE_JOB_NOT_FOUND', `Job '${jobId}' not found`));
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const sendEvent = (eventType: string, data: unknown): void => {
        if (reply.raw.destroyed) return;
        reply.raw.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // Replay existing logs
      for (const line of job.logs) {
        sendEvent('log', line);
      }

      // If already completed, send final status and close
      if (job.status !== 'running') {
        sendEvent('status', {
          status: job.status,
          result: job.result,
          error: job.error,
        });
        reply.raw.end();
        return reply;
      }

      // Subscribe to live events
      const unsubscribe = jobStore.subscribe(jobId, (event) => {
        if (reply.raw.destroyed) {
          unsubscribe();
          return;
        }
        if (event.type === 'log') {
          sendEvent('log', event.line);
        } else {
          sendEvent('status', {
            status: event.status,
            result: event.result,
            error: event.error,
          });
          // Close the SSE stream after final status
          reply.raw.end();
        }
      });

      // Clean up on client disconnect
      request.raw.on('close', () => {
        unsubscribe();
      });

      // Keep-alive ping every 15s so proxies don't kill the connection
      const keepAlive = setInterval(() => {
        if (reply.raw.destroyed) {
          clearInterval(keepAlive);
          return;
        }
        reply.raw.write(': keepalive\n\n');
      }, 15_000);
      keepAlive.unref();

      request.raw.on('close', () => {
        clearInterval(keepAlive);
      });

      return reply;
    },
  );
};

/** Test-only helper — no longer needed since we use jobStore, but kept for compat. */
export function __resetPeerUpdateMutexForTests(): void {
  // no-op — jobs are managed by PeerUpdateJobStore now
}
