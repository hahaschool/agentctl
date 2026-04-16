import { readFileSync } from 'node:fs';
import { generateDispatchSigningKeyPair } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as buildInfo from '../../build-info.js';
import type { Database } from '../../db/index.js';
import { createPeerSignedHeader } from '../../sync/peer-auth.js';
import { PeerUpdateJobStore } from '../../sync/peer-update-jobs.js';
import { type RunScriptFn, syncPeerUpdateRoutes } from './sync-peer-update.js';

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
  jobStore?: PeerUpdateJobStore;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(syncPeerUpdateRoutes, {
    prefix: '/api/sync/peers',
    db: opts.db,
    selfMachineId: SELF_MACHINE_ID,
    runScript: opts.runScript,
    scriptPath: '/fake/peer-update.sh',
    pm2Ecosystem: 'agentctl-test',
    jobStore: opts.jobStore ?? new PeerUpdateJobStore(),
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
  let jobStore: PeerUpdateJobStore;

  beforeEach(() => {
    jobStore = new PeerUpdateJobStore();
  });

  afterEach(async () => {
    jobStore.destroy();
    if (app) {
      await app.close();
      app = null;
    }
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('returns 401 when the X-Sync-Auth header is missing', async () => {
    const db = createMockDb({});
    app = await buildApp({ db, runScript: vi.fn(), jobStore });

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
    app = await buildApp({ db, runScript, jobStore });

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
    app = await buildApp({ db, runScript, jobStore });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers/some-other-id/update',
      payload: {},
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('PEER_UPDATE_PROXY_NO_KEY');
    expect(runScript).not.toHaveBeenCalled();
  });

  it('returns 202 with jobId and starts update asynchronously', async () => {
    const keyPair = generateDispatchSigningKeyPair();
    const db = createMockDb({ [REMOTE_MACHINE_ID]: keyPair.publicKey });

    vi.spyOn(buildInfo, 'getAppVersion').mockReturnValue('0.4.0');

    let resolveScript:
      | ((v: { exitCode: number; stdoutTail: string; stderrTail: string }) => void)
      | null = null;
    const runScript = vi.fn<RunScriptFn>().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveScript = resolve;
        }),
    );

    app = await buildApp({ db, runScript, jobStore });

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

    expect(response.statusCode).toBe(202);
    const payload = response.json();
    expect(payload.status).toBe('started');
    expect(payload.jobId).toBeDefined();
    expect(payload.previousVersion).toBe('0.4.0');

    // Script is still running
    const job = jobStore.getJob(payload.jobId);
    expect(job?.status).toBe('running');

    // Complete the script
    resolveScript?.({ exitCode: 0, stdoutTail: 'ok', stderrTail: '' });
    // Wait for async completion
    await vi.waitFor(() => {
      expect(jobStore.getJob(payload.jobId)?.status).toBe('success');
    });
  });

  it('marks job as failed on non-zero exit', async () => {
    const keyPair = generateDispatchSigningKeyPair();
    const db = createMockDb({ [REMOTE_MACHINE_ID]: keyPair.publicKey });

    vi.spyOn(buildInfo, 'getAppVersion').mockReturnValue('0.4.0');

    const runScript = vi.fn<RunScriptFn>().mockResolvedValue({
      exitCode: 3,
      stdoutTail: 'peer-update: starting at abc123\n',
      stderrTail: 'fatal: unable to access origin/main\n',
    });

    app = await buildApp({ db, runScript, jobStore });

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

    expect(response.statusCode).toBe(202);
    const { jobId } = response.json();

    await vi.waitFor(() => {
      expect(jobStore.getJob(jobId)?.status).toBe('failed');
    });

    const job = jobStore.getJob(jobId);
    expect(job?.error).toContain('exited with code 3');
    expect(job?.result?.exitCode).toBe(3);
  });

  it('returns 409 with existing jobId when a second request arrives while the first is running', async () => {
    const keyPair = generateDispatchSigningKeyPair();
    const db = createMockDb({ [REMOTE_MACHINE_ID]: keyPair.publicKey });

    vi.spyOn(buildInfo, 'getAppVersion').mockReturnValue('0.4.0');

    const runScript = vi.fn<RunScriptFn>().mockImplementation(
      () => new Promise(() => {}), // never resolves
    );

    app = await buildApp({ db, runScript, jobStore });

    const body = {};

    const first = await app.inject({
      method: 'POST',
      url: `/api/sync/peers/${SELF_MACHINE_ID}/update`,
      payload: body,
      headers: {
        'x-sync-auth': signRequest(keyPair, REMOTE_MACHINE_ID, SELF_MACHINE_ID, body),
        'content-type': 'application/json',
      },
    });

    expect(first.statusCode).toBe(202);

    const concurrent = await app.inject({
      method: 'POST',
      url: `/api/sync/peers/${SELF_MACHINE_ID}/update`,
      payload: body,
      headers: {
        'x-sync-auth': signRequest(keyPair, REMOTE_MACHINE_ID, SELF_MACHINE_ID, body),
        'content-type': 'application/json',
      },
    });

    expect(concurrent.statusCode).toBe(409);
    expect(concurrent.json().error).toBe('PEER_UPDATE_IN_PROGRESS');
    expect(concurrent.json().jobId).toBe(first.json().jobId);
  });

  it('streams log lines to job store via onStdout/onStderr callbacks', async () => {
    const keyPair = generateDispatchSigningKeyPair();
    const db = createMockDb({ [REMOTE_MACHINE_ID]: keyPair.publicKey });

    vi.spyOn(buildInfo, 'getAppVersion').mockReturnValue('0.4.0');

    const runScript = vi.fn<RunScriptFn>().mockImplementation(async (opts) => {
      opts.onStdout?.('line 1');
      opts.onStdout?.('line 2');
      opts.onStderr?.('warning');
      return { exitCode: 0, stdoutTail: 'line 1\nline 2\n', stderrTail: 'warning\n' };
    });

    app = await buildApp({ db, runScript, jobStore });

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

    const { jobId } = response.json();
    await vi.waitFor(() => {
      expect(jobStore.getJob(jobId)?.status).toBe('success');
    });

    const job = jobStore.getJob(jobId);
    expect(job).toBeDefined();
    expect(job?.logs).toHaveLength(3);
    expect(job?.logs[0]).toMatchObject({ stream: 'stdout', text: 'line 1' });
    expect(job?.logs[1]).toMatchObject({ stream: 'stdout', text: 'line 2' });
    expect(job?.logs[2]).toMatchObject({ stream: 'stderr', text: 'warning' });
  });

  it('rate-limits peer update requests', async () => {
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

    app = await buildApp({ db, runScript, jobStore });

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
    expect(first?.statusCode).toBe(202);

    const second = await request();
    expect(second?.statusCode).toBe(429);
    expect(second?.json()).toMatchObject({
      error: 'RATE_LIMITED',
      message: 'Too many peer update requests',
    });
  });

  it('declares direct Fastify rate-limit and auth markers for CodeQL', () => {
    const source = readFileSync(new URL('./sync-peer-update.ts', import.meta.url), 'utf8');

    expect(source).toMatch(/await app\.register\(rateLimit,\s*\{/);
    expect(source).toMatch(
      /async function authorize\(\s*request:\s*FastifyRequest,\s*reply:\s*FastifyReply,/,
    );
    expect(source).toMatch(
      /'\/:peerId\/update'[\s\S]*?config:\s*\{\s*rateLimit:\s*peerUpdateFastifyRateLimit\s*\}/,
    );
    expect(source).toMatch(/const authorized = await authorize\(request, reply, db\)/);
  });
});
