// ---------------------------------------------------------------------------
// Tests for mesh-auto-update.ts — roadmap §33.11 /settings mesh auto-update.
// ---------------------------------------------------------------------------

import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type ExecCaptured,
  type ExecCapturedResult,
  type MeshAutoUpdatePlatform,
  meshAutoUpdateRoutes,
  type ReadHistoryFile,
  type SpawnStreamed,
} from './mesh-auto-update.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SpawnScript = {
  readonly stdout?: readonly string[];
  readonly stderr?: readonly string[];
  readonly exitCode?: number | null;
  readonly errorAfter?: number; // ms
};

type ExecScript = {
  readonly cmd: string;
  readonly argsPrefix?: readonly string[];
  readonly result: ExecCapturedResult;
};

function execResult(stdout: string, exitCode = 0, stderr = ''): ExecCapturedResult {
  return { stdout, stderr, exitCode };
}

function mockExec(scripts: readonly ExecScript[]): ExecCaptured {
  return vi.fn(async (cmd, args) => {
    const match = scripts.find((s) => {
      if (s.cmd !== cmd) return false;
      if (!s.argsPrefix) return true;
      return s.argsPrefix.every((a, i) => args[i] === a);
    });
    return match?.result ?? execResult('', 1, 'no mock match');
  });
}

function mockSpawn(script: SpawnScript): SpawnStreamed {
  return vi.fn((_cmd, _args, opts) => {
    let killed = false;
    const emit = async () => {
      for (const chunk of script.stdout ?? []) {
        if (killed) return;
        opts.onStdout(chunk);
      }
      for (const chunk of script.stderr ?? []) {
        if (killed) return;
        opts.onStderr(chunk);
      }
      await Promise.resolve();
      if (killed) return;
      opts.onClose(script.exitCode ?? 0);
    };
    void emit();
    return {
      kill: () => {
        killed = true;
      },
    };
  });
}

function mockHistory(raw: string | null): ReadHistoryFile {
  return vi.fn(async () => raw);
}

async function buildApp(params: {
  platform?: MeshAutoUpdatePlatform;
  exec?: ExecCaptured;
  spawnProcess?: SpawnStreamed;
  readHistoryFile?: ReadHistoryFile;
  repoRoot?: string;
  historyFilePath?: string;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(meshAutoUpdateRoutes, {
    prefix: '/api/mesh',
    platform: params.platform ?? 'darwin',
    exec: params.exec ?? (vi.fn(async () => execResult('', 1)) as ExecCaptured),
    spawnProcess: params.spawnProcess ?? mockSpawn({ exitCode: 0 }),
    readHistoryFile: params.readHistoryFile ?? mockHistory(null),
    repoRoot: params.repoRoot ?? '/tmp/repo',
    historyFilePath: params.historyFilePath ?? '/tmp/history.json',
  });
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// GET /api/mesh/auto-update
// ---------------------------------------------------------------------------

describe('GET /api/mesh/auto-update', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it('returns disabled + null nextRun when no scheduler is loaded (darwin)', async () => {
    app = await buildApp({
      platform: 'darwin',
      exec: mockExec([{ cmd: 'launchctl', argsPrefix: ['list'], result: execResult('') }]),
    });

    const res = await app.inject({ method: 'GET', url: '/api/mesh/auto-update' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      enabled: false,
      nextScheduledRun: null,
      lastRun: null,
      platform: 'darwin',
    });
  });

  it('returns enabled + parsed next run when launchd lists the label', async () => {
    const printOutput = 'next fire = 1834556800\nsome other stuff\n';
    app = await buildApp({
      platform: 'darwin',
      exec: mockExec([
        {
          cmd: 'launchctl',
          argsPrefix: ['list'],
          result: execResult('-\t0\tcom.agentctl.peer-update\n'),
        },
        { cmd: 'launchctl', argsPrefix: ['print'], result: execResult(printOutput) },
      ]),
    });

    const res = await app.inject({ method: 'GET', url: '/api/mesh/auto-update' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(true);
    expect(body.nextScheduledRun).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns lastRun sourced from history file', async () => {
    const history = JSON.stringify([
      {
        startedAt: '2026-04-14T03:00:00.000Z',
        finishedAt: '2026-04-14T03:02:30.000Z',
        fromTag: 'v0.3.3',
        toTag: 'v0.3.4',
        success: true,
        dryRun: false,
      },
    ]);
    app = await buildApp({
      platform: 'darwin',
      exec: mockExec([{ cmd: 'launchctl', argsPrefix: ['list'], result: execResult('') }]),
      readHistoryFile: mockHistory(history),
    });

    const res = await app.inject({ method: 'GET', url: '/api/mesh/auto-update' });
    const body = res.json();
    expect(body.lastRun).toEqual({
      version: 'v0.3.4',
      startedAt: '2026-04-14T03:00:00.000Z',
      durationMs: 150_000,
      status: 'success',
      dryRun: false,
    });
  });

  it('surfaces failure details from the most recent history entry', async () => {
    const history = JSON.stringify([
      {
        startedAt: '2026-04-10T03:00:00.000Z',
        finishedAt: '2026-04-10T03:01:00.000Z',
        fromTag: 'v0.3.3',
        toTag: 'v0.3.4',
        success: true,
        dryRun: false,
      },
      {
        startedAt: '2026-04-11T03:00:00.000Z',
        finishedAt: '2026-04-11T03:00:45.000Z',
        fromTag: 'v0.3.4',
        toTag: 'v0.3.5',
        success: false,
        errorMessage: 'pnpm build failed',
        dryRun: false,
      },
    ]);
    app = await buildApp({
      platform: 'linux',
      exec: mockExec([
        {
          cmd: 'systemctl',
          argsPrefix: ['--user', 'is-enabled'],
          result: execResult('disabled', 1),
        },
      ]),
      readHistoryFile: mockHistory(history),
    });

    const res = await app.inject({ method: 'GET', url: '/api/mesh/auto-update' });
    const body = res.json();
    expect(body.lastRun.status).toBe('failure');
    expect(body.lastRun.error).toBe('pnpm build failed');
    expect(body.platform).toBe('linux');
  });

  it('returns null lastRun when history file is empty or malformed', async () => {
    app = await buildApp({
      platform: 'unsupported',
      readHistoryFile: mockHistory('not json'),
    });

    const res = await app.inject({ method: 'GET', url: '/api/mesh/auto-update' });
    const body = res.json();
    expect(body.lastRun).toBeNull();
    expect(body.platform).toBe('unsupported');
  });
});

// ---------------------------------------------------------------------------
// POST /api/mesh/auto-update/toggle
// ---------------------------------------------------------------------------

describe('POST /api/mesh/auto-update/toggle', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it('rejects bodies that do not match { enabled: boolean }', async () => {
    app = await buildApp({ platform: 'darwin' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/mesh/auto-update/toggle',
      payload: { foo: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_BODY');
  });

  it('invokes launchctl bootstrap when enabling on darwin', async () => {
    const exec = vi.fn(async (cmd, args) => {
      if (cmd === 'launchctl' && args[0] === 'bootstrap') return execResult('', 0);
      if (cmd === 'launchctl' && args[0] === 'list') {
        return execResult('-\t0\tcom.agentctl.peer-update\n', 0);
      }
      if (cmd === 'launchctl' && args[0] === 'print') {
        return execResult('next fire = 1834556800\n', 0);
      }
      return execResult('', 1);
    }) as ExecCaptured;

    app = await buildApp({ platform: 'darwin', exec });

    const res = await app.inject({
      method: 'POST',
      url: '/api/mesh/auto-update/toggle',
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(true);

    const calls = (exec as ReturnType<typeof vi.fn>).mock.calls.map((c) => `${c[0]} ${c[1][0]}`);
    expect(calls).toContain('launchctl bootstrap');
  });

  it('invokes systemctl --user disable when disabling on linux', async () => {
    const exec = vi.fn(async (cmd, args) => {
      if (cmd === 'systemctl' && args[1] === 'disable') return execResult('', 0);
      if (cmd === 'systemctl' && args[1] === 'is-enabled') return execResult('disabled', 1);
      return execResult('', 1);
    }) as ExecCaptured;

    app = await buildApp({ platform: 'linux', exec });

    const res = await app.inject({
      method: 'POST',
      url: '/api/mesh/auto-update/toggle',
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(false);

    const calls = (exec as ReturnType<typeof vi.fn>).mock.calls;
    expect(
      calls.some((c) => c[0] === 'systemctl' && c[1][0] === '--user' && c[1][1] === 'disable'),
    ).toBe(true);
  });

  it('returns PLATFORM_UNSUPPORTED when the host has no scheduler backend', async () => {
    app = await buildApp({ platform: 'unsupported' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/mesh/auto-update/toggle',
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('PLATFORM_UNSUPPORTED');
  });

  it('propagates scheduler errors as a 500 with the upstream error code', async () => {
    const exec = vi.fn(async () => execResult('', 5, 'permission denied')) as ExecCaptured;
    app = await buildApp({ platform: 'darwin', exec });

    const res = await app.inject({
      method: 'POST',
      url: '/api/mesh/auto-update/toggle',
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe('LAUNCHCTL_FAILED');
  });
});

// ---------------------------------------------------------------------------
// POST /api/mesh/auto-update/dry-run (SSE)
// ---------------------------------------------------------------------------

describe('POST /api/mesh/auto-update/dry-run', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  function parseSseEvents(raw: string): Array<Record<string, unknown>> {
    return raw
      .split('\n\n')
      .map((block) => block.trim())
      .filter((b) => b.startsWith('data:'))
      .map((b) => JSON.parse(b.slice('data:'.length).trim()) as Record<string, unknown>);
  }

  it('streams start, stdout, stderr, and done events', async () => {
    app = await buildApp({
      spawnProcess: mockSpawn({
        stdout: ['line 1\n', 'line 2\n'],
        stderr: ['warn\n'],
        exitCode: 0,
      }),
    });

    const res = await app.inject({ method: 'POST', url: '/api/mesh/auto-update/dry-run' });
    expect(res.statusCode).toBe(200);
    const events = parseSseEvents(res.body);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('start');
    expect(types).toContain('stdout');
    expect(types).toContain('stderr');
    expect(types[types.length - 1]).toBe('done');

    const done = events[events.length - 1];
    expect(done.exitCode).toBe(0);
    expect(typeof done.durationMs).toBe('number');
  });

  it('emits an error event when the process fails to spawn', async () => {
    const spawnProcess = vi.fn((_cmd, _args, opts) => {
      setImmediate(() => opts.onError(new Error('ENOENT')));
      return { kill: () => undefined };
    }) as SpawnStreamed;

    app = await buildApp({ spawnProcess });

    const res = await app.inject({ method: 'POST', url: '/api/mesh/auto-update/dry-run' });
    expect(res.statusCode).toBe(200);
    const events = parseSseEvents(res.body);
    expect(events.some((e) => e.type === 'error' && (e.message as string).includes('ENOENT'))).toBe(
      true,
    );
    expect(events[events.length - 1].type).toBe('done');
  });
});

// ---------------------------------------------------------------------------
// Rate limiting — one smoke test per route. The precise thresholds are set via
// env vars so we can drop them to 2 without waiting out a minute.
// ---------------------------------------------------------------------------

describe('mesh auto-update rate limits', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) await app.close();
    app = null;
    vi.unstubAllEnvs();
  });

  it('returns 429 after the status cap is exhausted', async () => {
    vi.stubEnv('MESH_AUTO_UPDATE_STATUS_RATE_LIMIT_MAX', '2');
    vi.stubEnv('MESH_AUTO_UPDATE_STATUS_RATE_LIMIT_WINDOW_MS', '60000');
    app = await buildApp({});

    const codes: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await app.inject({ method: 'GET', url: '/api/mesh/auto-update' });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 2).every((c) => c === 200)).toBe(true);
    expect(codes[2]).toBe(429);
  });
});
