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

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { getAppVersion } from '../../build-info.js';
import type { Database } from '../../db/index.js';
import { verifyPeerSignature } from '../../sync/peer-auth.js';
import { loadKnownPeers } from '../../sync/sync-auth.js';

const CURRENT_FILE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_RELATIVE_PATH = '../../../../scripts/peer-update.sh';
const DEFAULT_SCRIPT_PATH = path.resolve(CURRENT_FILE_DIR, SCRIPT_RELATIVE_PATH);
const DEFAULT_PM2_ECOSYSTEM = 'agentctl-beta';
const OUTPUT_TAIL_BYTES = 4_096;

/**
 * Structured error codes surfaced by the update route. Kept narrow so the
 * frontend can match on them without string parsing.
 */
export type PeerUpdateErrorCode =
  | 'PEER_UPDATE_NOT_LOCAL'
  | 'PEER_UPDATE_IN_PROGRESS'
  | 'PEER_UPDATE_SCRIPT_FAILED'
  | 'PEER_UPDATE_HEALTH_TIMEOUT';

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
    runScript = defaultRunScript,
    scriptPath = DEFAULT_SCRIPT_PATH,
    pm2Ecosystem = process.env.AGENTCTL_PM2_ECOSYSTEM ?? DEFAULT_PM2_ECOSYSTEM,
  } = opts;

  app.post<{ Params: { peerId: string } }>(
    '/:peerId/update',
    {
      schema: {
        tags: ['sync'],
        summary: 'Trigger a self-update on the local mesh peer',
      },
    },
    async (request, reply) => {
      const authorized = await authorize(request, reply, db);
      if (!authorized) return;

      const { peerId } = request.params;
      if (peerId !== selfMachineId) {
        return reply
          .code(404)
          .send(
            errorResponse(
              'PEER_UPDATE_NOT_LOCAL',
              `Peer id '${peerId}' does not match the local machine id`,
            ),
          );
      }

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
