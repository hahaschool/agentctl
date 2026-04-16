import { readFileSync } from 'node:fs';
import { generateDispatchSigningKeyPair } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as buildInfo from '../../build-info.js';
import type { Database } from '../../db/index.js';
import { createPeerSignedHeader } from '../../sync/peer-auth.js';
import {
  __resetPeerUpdateMutexForTests,
  type RunScriptFn,
  syncPeerUpdateRoutes,
} from './sync-peer-update.js';

const SELF_MACHINE_ID = 'machine-local';
const REMOTE_MACHINE_ID = 'machine-remote';

function createMockDb(knownPeers: Record<string, string>): Database {
  return {
    execute: vi.fn(async () => ({
      rows: Object.entries(knownPeers).map(([id, publicKey]) => ({
        id,
        public_key: publicKey,
      })),
    })),
  } as unknown as Database;
}

async function buildApp(opts: {
  db: Database;
  runScript?: RunScriptFn;
  signingSecretKey?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(syncPeerUpdateRoutes, {
    prefix: '/api/sync/peers',
    db: opts.db,
    selfMachineId: SELF_MACHINE_ID,
    runScript: opts.runScript,
    scriptPath: '/fake/peer-update.sh',
    pm2Ecosystem: 'agentctl-test',
    signingSecretKey: opts.signingSecretKey ?? undefined,
    fetchImpl: opts.fetchImpl,
  });
  await app.ready();
  return app;
}

function signRequest(
  keyPair: { publicKey: string; secretKey: string },
  machineId: string,
  peerIdParam: string,
  body: unknown,
): string {
  return createPeerSignedHeader(
    machineId,
    'POST',
    `/api/sync/peers/${peerIdParam}/update`,
    body,
    keyPair.secretKey,
  );
}

describe('syncPeerUpdateRoutes', () => {
  let app: FastifyInstance | null = null;

  beforeEach(() => {
    __resetPeerUpdateMutexForTests();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('returns 401 when the X-Sync-Auth header is missing', async () => {
    const db = createMockDb({});
    app = await buildApp({ db, runScript: vi.fn() });

    const response = await app.inject({
      method: 'POST',
      url: `/api/sync/peers/${SELF_MACHINE_ID}/update`,
      payload: {},
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('SYNC_AUTH_MISSING');
  });

  it('returns 401 when the signature is not from a known peer', async () => {
    const db = createMockDb({});
    const keyPair = generateDispatchSigningKeyPair();
    const runScript = vi.fn<RunScriptFn>();
    app = await buildApp({ db, runScript });

    const body = {};
    const header = signRequest(keyPair, REMOTE_MACHINE_ID, SELF_MACHINE_ID, body);

    const response = await app.inject({
      method: 'POST',
      url: `/api/sync/peers/${SELF_MACHINE_ID}/update`,
      payload: body,
      headers: {
        'x-sync-auth': header,
        'content-type': 'application/json',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('SYNC_AUTH_INVALID');
    expect(runScript).not.toHaveBeenCalled();
  });

  it('returns 503 PEER_UPDATE_PROXY_NO_KEY when forwarding without a signing key', async () => {
    const db = createMockDb({});
    const runScript = vi.fn<RunScriptFn>();
    // No signingSecretKey provided → proxy path returns 503
    app = await buildApp({ db, runScript });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers/some-other-id/update',
      payload: {},
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('PEER_UPDATE_PROXY_NO_KEY');
    expect(runScript).not.toHaveBeenCalled();
  });

  it('returns 200 with success envelope and a refreshed newVersion on happy path', async () => {
    const keyPair = generateDispatchSigningKeyPair();
    const db = createMockDb({ [REMOTE_MACHINE_ID]: keyPair.publicKey });

    const versionSpy = vi
      .spyOn(buildInfo, 'getAppVersion')
      .mockReturnValueOnce('0.4.0')
      .mockReturnValueOnce('0.4.1');

    const runScript = vi.fn<RunScriptFn>().mockResolvedValue({
      exitCode: 0,
      stdoutTail: 'peer-update: success abc123 -> def456\n',
      stderrTail: '',
    });

    app = await buildApp({ db, runScript });

    const body = {};
    const header = signRequest(keyPair, REMOTE_MACHINE_ID, SELF_MACHINE_ID, body);

    const response = await app.inject({
      method: 'POST',
      url: `/api/sync/peers/${SELF_MACHINE_ID}/update`,
      payload: body,
      headers: {
        'x-sync-auth': header,
        'content-type': 'application/json',
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload).toMatchObject({
      status: 'success',
      exitCode: 0,
      previousVersion: '0.4.0',
      newVersion: '0.4.1',
      stdoutTail: 'peer-update: success abc123 -> def456\n',
      stderrTail: '',
    });
    expect(typeof payload.durationMs).toBe('number');
    expect(runScript).toHaveBeenCalledTimes(1);
    expect(runScript).toHaveBeenCalledWith({
      scriptPath: '/fake/peer-update.sh',
      pm2Ecosystem: 'agentctl-test',
    });
    versionSpy.mockRestore();
  });

  it('returns 500 with PEER_UPDATE_SCRIPT_FAILED and captures stderrTail on non-zero exit', async () => {
    const keyPair = generateDispatchSigningKeyPair();
    const db = createMockDb({ [REMOTE_MACHINE_ID]: keyPair.publicKey });

    vi.spyOn(buildInfo, 'getAppVersion').mockReturnValue('0.4.0');

    const runScript = vi.fn<RunScriptFn>().mockResolvedValue({
      exitCode: 3,
      stdoutTail: 'peer-update: starting at abc123\n',
      stderrTail: 'fatal: unable to access origin/main\n',
    });

    app = await buildApp({ db, runScript });

    const body = {};
    const header = signRequest(keyPair, REMOTE_MACHINE_ID, SELF_MACHINE_ID, body);

    const response = await app.inject({
      method: 'POST',
      url: `/api/sync/peers/${SELF_MACHINE_ID}/update`,
      payload: body,
      headers: {
        'x-sync-auth': header,
        'content-type': 'application/json',
      },
    });

    expect(response.statusCode).toBe(500);
    const payload = response.json();
    expect(payload.error).toBe('PEER_UPDATE_SCRIPT_FAILED');
    expect(payload.exitCode).toBe(3);
    expect(payload.stderrTail).toContain('fatal: unable to access origin/main');
  });

  it('returns 409 PEER_UPDATE_IN_PROGRESS when a second request arrives while the first is running', async () => {
    const keyPair = generateDispatchSigningKeyPair();
    const db = createMockDb({ [REMOTE_MACHINE_ID]: keyPair.publicKey });

    vi.spyOn(buildInfo, 'getAppVersion').mockReturnValue('0.4.0');

    let releaseFirstRun: (() => void) | null = null;
    const runScript = vi.fn<RunScriptFn>().mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseFirstRun = () => resolve({ exitCode: 0, stdoutTail: 'ok\n', stderrTail: '' });
        }),
    );

    app = await buildApp({ db, runScript });

    const body = {};

    const first = app.inject({
      method: 'POST',
      url: `/api/sync/peers/${SELF_MACHINE_ID}/update`,
      payload: body,
      headers: {
        'x-sync-auth': signRequest(keyPair, REMOTE_MACHINE_ID, SELF_MACHINE_ID, body),
        'content-type': 'application/json',
      },
    });

    // Give the first request a chance to acquire the mutex and enter runScript.
    await vi.waitFor(() => expect(runScript).toHaveBeenCalledTimes(1));

    const concurrent = await app.inject({
      method: 'POST',
      url: `/api/sync/peers/${SELF_MACHINE_ID}/update`,
      payload: body,
      headers: {
        // Fresh nonce — we're not testing replay here, just concurrency.
        'x-sync-auth': signRequest(keyPair, REMOTE_MACHINE_ID, SELF_MACHINE_ID, body),
        'content-type': 'application/json',
      },
    });

    expect(concurrent.statusCode).toBe(409);
    expect(concurrent.json().error).toBe('PEER_UPDATE_IN_PROGRESS');

    releaseFirstRun?.();
    const firstResponse = await first;
    expect(firstResponse.statusCode).toBe(200);
  });

  it('rate-limits peer update requests before repeated script execution', async () => {
    vi.stubEnv('PEER_UPDATE_RATE_LIMIT_MAX', '1');
    vi.stubEnv('PEER_UPDATE_RATE_LIMIT_WINDOW_MS', '60000');

    const keyPair = generateDispatchSigningKeyPair();
    const db = createMockDb({ [REMOTE_MACHINE_ID]: keyPair.publicKey });

    vi.spyOn(buildInfo, 'getAppVersion').mockReturnValue('0.4.0');

    const runScript = vi.fn<RunScriptFn>().mockResolvedValue({
      exitCode: 0,
      stdoutTail: 'ok\n',
      stderrTail: '',
    });

    app = await buildApp({ db, runScript });

    const body = {};
    const request = () =>
      app?.inject({
        method: 'POST',
        url: `/api/sync/peers/${SELF_MACHINE_ID}/update`,
        payload: body,
        headers: {
          'x-sync-auth': signRequest(keyPair, REMOTE_MACHINE_ID, SELF_MACHINE_ID, body),
          'content-type': 'application/json',
        },
      });

    const first = await request();
    expect(first?.statusCode).toBe(200);

    const second = await request();
    expect(second?.statusCode).toBe(429);
    expect(second?.json()).toMatchObject({
      error: 'RATE_LIMITED',
      message: 'Too many peer update requests',
    });
    expect(runScript).toHaveBeenCalledTimes(1);
  });

  it('returns 409 PEER_UPDATE_DOWNGRADE_REJECTED when proxy target has >= local version', async () => {
    const keyPair = generateDispatchSigningKeyPair();

    // Mock DB: returns a remote peer with version 0.6.0 (higher than local 0.5.6)
    const mockDb = {
      execute: vi.fn(async () => ({
        rows: [
          {
            id: REMOTE_MACHINE_ID,
            sync_url: 'http://100.64.0.2:8080',
            is_self: false,
            peer_version: '0.6.0',
            public_key: keyPair.publicKey,
          },
        ],
      })),
    } as unknown as Database;

    vi.spyOn(buildInfo, 'getAppVersion').mockReturnValue('0.5.6');

    const fetchImpl = vi.fn();
    app = await buildApp({
      db: mockDb,
      signingSecretKey: keyPair.secretKey,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/sync/peers/${REMOTE_MACHINE_ID}/update`,
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('PEER_UPDATE_DOWNGRADE_REJECTED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('allows proxy update when peer version is lower than local', async () => {
    const keyPair = generateDispatchSigningKeyPair();

    // Mock DB: remote peer at 0.5.0 (lower than local 0.5.6)
    const mockDb = {
      execute: vi.fn(async () => ({
        rows: [
          {
            id: REMOTE_MACHINE_ID,
            sync_url: 'http://100.64.0.2:8080',
            is_self: false,
            peer_version: '0.5.0',
            public_key: keyPair.publicKey,
          },
        ],
      })),
    } as unknown as Database;

    vi.spyOn(buildInfo, 'getAppVersion').mockReturnValue('0.5.6');

    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ status: 'success' })),
    });

    app = await buildApp({
      db: mockDb,
      signingSecretKey: keyPair.secretKey,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/sync/peers/${REMOTE_MACHINE_ID}/update`,
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('declares direct Fastify rate-limit and auth markers for CodeQL', () => {
    const source = readFileSync(new URL('./sync-peer-update.ts', import.meta.url), 'utf8');

    expect(source).toMatch(/await app\.register\(rateLimit,\s*\{/);
    expect(source).toMatch(
      /async function authorize\(\s*request:\s*FastifyRequest,\s*reply:\s*FastifyReply,/,
    );
    expect(source).toMatch(
      /'\/:peerId\/update'[\s\S]*?config:\s*\{\s*rateLimit:\s*peerUpdateFastifyRateLimit\s*\}[\s\S]*?preHandler:\s*\[\s*app\.rateLimit\(peerUpdateFastifyRateLimit\)\s*\]/,
    );
    // Auth is invoked inline for the self-update path only (proxy path skips it)
    expect(source).toMatch(/const authorized = await authorize\(request, reply, db\)/);
  });
});
