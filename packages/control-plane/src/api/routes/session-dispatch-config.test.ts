import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFullMockDbRegistry } from './test-helpers.js';

vi.mock('../../utils/resolve-account.js', () => ({
  resolveAccountId: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../utils/credential-crypto.js', () => ({
  decryptCredential: vi.fn().mockReturnValue('decrypted-api-key-123'),
  encryptCredential: vi.fn(),
  maskCredential: vi.fn(),
}));

import { sessionRoutes } from './sessions.js';

function createMockDb() {
  let rows: unknown[] = [];
  let queuedResults: unknown[][] = [];

  const chain: Record<string, unknown> = {};
  const chainMethods = [
    'select',
    'from',
    'where',
    'orderBy',
    'limit',
    'offset',
    'insert',
    'update',
    'delete',
    'values',
    'set',
    'returning',
    'onConflictDoUpdate',
  ];

  for (const method of chainMethods) {
    chain[method] = vi.fn(() => chain);
  }

  // biome-ignore lint/suspicious/noThenProperty: Drizzle query builder mock requires a thenable
  chain.then = (resolve: (value: unknown) => void) => {
    if (queuedResults.length > 0) {
      resolve(queuedResults.shift() ?? []);
      return chain;
    }

    resolve(rows);
    return chain;
  };

  return {
    db: chain,
    setRows: (newRows: unknown[]) => {
      rows = newRows;
    },
    queueRows: (...nextRows: unknown[][]) => {
      queuedResults = [...queuedResults, ...nextRows];
    },
  };
}

async function buildApp(
  mockDb: ReturnType<typeof createMockDb>,
  dbRegistryOverrides: Record<string, unknown> = {},
): Promise<{
  app: FastifyInstance;
  dbRegistry: ReturnType<typeof createFullMockDbRegistry>;
}> {
  const app = Fastify({ logger: false });
  const dbRegistry = createFullMockDbRegistry({
    countRunsForSession: vi.fn().mockResolvedValue(0),
    getLatestRunForSession: vi.fn().mockResolvedValue(null),
    getRunDispatchConfig: vi.fn().mockResolvedValue(null),
    ...dbRegistryOverrides,
  });

  await app.register(sessionRoutes, {
    prefix: '/api/sessions',
    db: mockDb.db as never,
    dbRegistry,
    workerPort: 9000,
  });
  await app.ready();

  return { app, dbRegistry };
}

describe('sessionRoutes dispatch-config', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('returns 404 when the session does not exist', async () => {
    const mockDb = createMockDb();
    mockDb.queueRows([], []);

    ({ app } = await buildApp(mockDb));

    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/session-missing/dispatch-config',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: 'SESSION_NOT_FOUND',
      message: "Session 'session-missing' does not exist",
    });
  });

  it('returns a null config payload when the session exists but has no runs', async () => {
    const mockDb = createMockDb();
    mockDb.queueRows([], [{ id: 'session-1' }]);

    const built = await buildApp(mockDb, {
      countRunsForSession: vi.fn().mockResolvedValue(0),
    });
    app = built.app;

    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/session-1/dispatch-config',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      runId: null,
      runCount: 0,
      config: null,
    });
    expect(built.dbRegistry.countRunsForSession).toHaveBeenCalledWith('session-1');
  });

  it('returns the latest dispatch config snapshot for an existing session', async () => {
    const mockDb = createMockDb();
    mockDb.queueRows([], [{ id: 'session-2' }]);

    const dispatchConfig = {
      model: 'gpt-5.4',
      permissionMode: 'workspace-write',
      accountProvider: 'openai',
      instructionsStrategy: 'merge',
      mcpServers: {
        github: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          envKeys: ['GITHUB_TOKEN'],
        },
      },
      mcpServerCount: 1,
      allowedTools: ['exec_command', 'apply_patch'],
      defaultPrompt: 'Ship it',
      systemPrompt: 'Be precise',
    };

    const built = await buildApp(mockDb, {
      countRunsForSession: vi.fn().mockResolvedValue(2),
      getLatestRunForSession: vi.fn().mockResolvedValue({ id: 'run-2' }),
      getRunDispatchConfig: vi.fn().mockResolvedValue(dispatchConfig),
    });
    app = built.app;

    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/session-2/dispatch-config',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      runId: 'run-2',
      runCount: 2,
      config: dispatchConfig,
    });
    expect(built.dbRegistry.countRunsForSession).toHaveBeenCalledWith('session-2');
    expect(built.dbRegistry.getLatestRunForSession).toHaveBeenCalledWith('session-2');
    expect(built.dbRegistry.getRunDispatchConfig).toHaveBeenCalledWith('run-2');
  });
});
