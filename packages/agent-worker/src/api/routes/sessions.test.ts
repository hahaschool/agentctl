import { EventEmitter } from 'node:events';

import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CliSession,
  CliSessionManager,
  CliSessionStatus,
  DiscoveredSession,
} from '../../runtime/cli-session-manager.js';
import { sessionRoutes } from './sessions.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const MACHINE_ID = 'test-worker-001';

function createMockLogger(): pino.Logger {
  return pino({ level: 'silent' });
}

function makeSession(overrides?: Partial<CliSession>): CliSession {
  return {
    id: 'cli-1000-1',
    claudeSessionId: 'claude-sess-abc',
    agentId: 'agent-1',
    projectPath: '/tmp/project',
    status: 'running' as CliSessionStatus,
    model: 'sonnet',
    pid: 12345,
    costUsd: 0.05,
    messageCount: 3,
    startedAt: new Date('2026-03-03T10:00:00Z'),
    lastActivity: new Date('2026-03-03T10:05:00Z'),
    isResumed: false,
    ...overrides,
  };
}

/**
 * Build a mock CliSessionManager (extends EventEmitter so the routes
 * can attach event listeners).
 */
function createMockSessionManager(): CliSessionManager & EventEmitter {
  const emitter = new EventEmitter();

  const sessions = new Map<string, CliSession>();

  const mock = Object.assign(emitter, {
    startSession: vi.fn(
      (options: { agentId: string; projectPath: string; prompt: string; model?: string }) => {
        const session = makeSession({
          agentId: options.agentId,
          projectPath: options.projectPath,
          model: options.model ?? 'sonnet',
          status: 'running',
        });
        sessions.set(session.id, session);
        return session;
      },
    ),
    resumeSession: vi.fn(
      (
        _claudeId: string,
        options: { agentId: string; projectPath: string; prompt: string; model?: string },
      ) => {
        const session = makeSession({
          id: 'cli-1000-2',
          claudeSessionId: _claudeId,
          agentId: options.agentId,
          projectPath: options.projectPath,
          model: options.model ?? 'sonnet',
          status: 'running',
          isResumed: true,
        });
        sessions.set(session.id, session);
        return session;
      },
    ),
    stopSession: vi.fn(async () => {}),
    getSession: vi.fn((id: string) => sessions.get(id) ?? null),
    getSessionByClaudeId: vi.fn((claudeId: string) => {
      for (const s of sessions.values()) {
        if (s.claudeSessionId === claudeId) return s;
      }
      return null;
    }),
    listSessions: vi.fn(() => Array.from(sessions.values())),
    listSessionsByStatus: vi.fn((status: CliSessionStatus) =>
      Array.from(sessions.values()).filter((s) => s.status === status),
    ),
    stopAll: vi.fn(async () => {}),
    discoverLocalSessions: vi.fn((): DiscoveredSession[] => []),
    // Keep EventEmitter methods from the base
  });

  // Allow tests to pre-populate sessions
  (mock as unknown as { _sessions: Map<string, CliSession> })._sessions = sessions;

  return mock as unknown as CliSessionManager & EventEmitter;
}

// ---------------------------------------------------------------------------
// We don't use createWorkerServer here because we only want to test the
// session routes in isolation. Instead, we register the plugin directly.
// ---------------------------------------------------------------------------

async function buildApp(
  sessionManager: CliSessionManager & EventEmitter,
): Promise<FastifyInstance> {
  const Fastify = await import('fastify');
  const app = Fastify.default({ logger: false });

  await app.register(sessionRoutes, {
    prefix: '/api/sessions',
    sessionManager,
    machineId: MACHINE_ID,
    logger: createMockLogger(),
  });

  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Worker session routes', () => {
  let app: FastifyInstance;
  let manager: CliSessionManager & EventEmitter;

  beforeEach(async () => {
    manager = createMockSessionManager();
    app = await buildApp(manager);
  });

  afterEach(async () => {
    await app.close();
  });

  // ── GET /api/sessions ──────────────────────────────────────────

  describe('GET /api/sessions', () => {
    it('should return empty list when no sessions exist', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/sessions' });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.sessions).toEqual([]);
      expect(body.count).toBe(0);
      expect(body.machineId).toBe(MACHINE_ID);
    });

    it('should list sessions after creating one', async () => {
      // Create a session first
      await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { sessionId: 'cp-1', agentId: 'agent-1', projectPath: '/tmp/proj' },
      });

      const res = await app.inject({ method: 'GET', url: '/api/sessions' });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.count).toBe(1);
      expect(body.sessions[0].agentId).toBe('agent-1');
    });
  });

  // ── POST /api/sessions ─────────────────────────────────────────

  describe('POST /api/sessions', () => {
    it('should start a new session and return 201', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          sessionId: 'cp-session-1',
          agentId: 'agent-1',
          projectPath: '/home/user/project',
          model: 'opus',
          prompt: 'Fix the bug',
        },
      });

      expect(res.statusCode).toBe(201);

      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.session).toBeDefined();
      expect(body.session.agentId).toBe('agent-1');
      expect(body.session.status).toBe('running');

      expect(manager.startSession).toHaveBeenCalledWith({
        agentId: 'agent-1',
        projectPath: '/home/user/project',
        prompt: 'Fix the bug',
        model: 'opus',
      });
    });

    it('should use default prompt when none provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          sessionId: 'cp-2',
          agentId: 'agent-2',
          projectPath: '/tmp/p',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(manager.startSession).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'Continue working.' }),
      );
    });

    it('should return 400 when agentId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { sessionId: 'x', projectPath: '/tmp' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('INVALID_INPUT');
    });

    it('should return 400 when projectPath is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { sessionId: 'x', agentId: 'a' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('INVALID_INPUT');
    });

    it('should return 503 when max sessions exceeded', async () => {
      const { AgentError } = await import('@agentctl/shared');
      vi.mocked(manager.startSession).mockImplementationOnce(() => {
        throw new AgentError('MAX_SESSIONS_EXCEEDED', 'Too many sessions', {});
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { sessionId: 'cp-3', agentId: 'a', projectPath: '/tmp' },
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('MAX_SESSIONS_EXCEEDED');
    });
  });

  // ── POST / — credential passthrough ─────────────────────────────

  describe('POST / — credential passthrough', () => {
    it('passes accountCredential and accountProvider to session manager', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          sessionId: 'cp-cred-1',
          agentId: 'agent-cred',
          projectPath: '/tmp/cred-project',
          prompt: 'Do work',
          accountCredential: 'sk-ant-api03-xxxx',
          accountProvider: 'anthropic',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(manager.startSession).toHaveBeenCalledWith(
        expect.objectContaining({
          accountCredential: 'sk-ant-api03-xxxx',
          accountProvider: 'anthropic',
        }),
      );
    });

    it('passes null credentials when not provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          sessionId: 'cp-cred-2',
          agentId: 'agent-no-cred',
          projectPath: '/tmp/no-cred-project',
          prompt: 'Do other work',
        },
      });

      expect(res.statusCode).toBe(201);

      const callArgs = vi.mocked(manager.startSession).mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.accountCredential).toBeUndefined();
      expect(callArgs.accountProvider).toBeUndefined();
    });

    it('includes all credential fields in session start options', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          sessionId: 'cp-cred-3',
          agentId: 'agent-full',
          projectPath: '/home/user/full-project',
          model: 'opus',
          prompt: 'Build feature',
          accountCredential: 'bedrock-profile-prod',
          accountProvider: 'bedrock',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(manager.startSession).toHaveBeenCalledWith({
        agentId: 'agent-full',
        projectPath: '/home/user/full-project',
        prompt: 'Build feature',
        model: 'opus',
        resumeSessionId: undefined,
        accountCredential: 'bedrock-profile-prod',
        accountProvider: 'bedrock',
      });
    });
  });

  // ── GET /api/sessions/:sessionId ───────────────────────────────

  describe('GET /api/sessions/:sessionId', () => {
    it('should return session details', async () => {
      // Create a session first
      await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { sessionId: 'cp-4', agentId: 'agent-1', projectPath: '/tmp/p' },
      });

      // The mock manager assigns id 'cli-1000-1'
      const session = manager.listSessions()[0];

      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/${session.id}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(session.id);
      expect(body.agentId).toBe('agent-1');
    });

    it('should return 404 for non-existent session', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/sessions/does-not-exist',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('SESSION_NOT_FOUND');
    });
  });

  // ── POST /api/sessions/:sessionId/resume ───────────────────────

  describe('POST /api/sessions/:sessionId/resume', () => {
    it('should resume a session by manager ID', async () => {
      // Pre-populate a paused session
      const sessions = (manager as unknown as { _sessions: Map<string, CliSession> })._sessions;
      const pausedSession = makeSession({
        id: 'cli-paused-1',
        status: 'paused',
        claudeSessionId: 'claude-abc',
      });
      sessions.set(pausedSession.id, pausedSession);
      vi.mocked(manager.getSession).mockImplementation((id) => sessions.get(id) ?? null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/cli-paused-1/resume',
        payload: { prompt: 'Continue the task' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.session).toBeDefined();
      expect(body.resumedFrom).toBe('cli-paused-1');
      expect(manager.resumeSession).toHaveBeenCalledWith(
        'claude-abc',
        expect.objectContaining({ prompt: 'Continue the task' }),
      );
    });

    it('should return 404 when session not found', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/nonexistent/resume',
        payload: { prompt: 'hello' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('SESSION_NOT_FOUND');
    });

    it('should return 400 when prompt is missing', async () => {
      const sessions = (manager as unknown as { _sessions: Map<string, CliSession> })._sessions;
      sessions.set('cli-x', makeSession({ id: 'cli-x' }));
      vi.mocked(manager.getSession).mockImplementation((id) => sessions.get(id) ?? null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/cli-x/resume',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('INVALID_INPUT');
    });

    it('should return 400 when session has no Claude session ID', async () => {
      const sessions = (manager as unknown as { _sessions: Map<string, CliSession> })._sessions;
      sessions.set('cli-no-claude', makeSession({ id: 'cli-no-claude', claudeSessionId: null }));
      vi.mocked(manager.getSession).mockImplementation((id) => sessions.get(id) ?? null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/cli-no-claude/resume',
        payload: { prompt: 'go' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── POST /api/sessions/:sessionId/message ──────────────────────

  describe('POST /api/sessions/:sessionId/message', () => {
    it('should send a message by resuming a paused session', async () => {
      const sessions = (manager as unknown as { _sessions: Map<string, CliSession> })._sessions;
      const paused = makeSession({
        id: 'cli-msg-1',
        status: 'paused',
        claudeSessionId: 'claude-xyz',
      });
      sessions.set(paused.id, paused);
      vi.mocked(manager.getSession).mockImplementation((id) => sessions.get(id) ?? null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/cli-msg-1/message',
        payload: { message: 'Now fix the tests too' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(manager.resumeSession).toHaveBeenCalledWith(
        'claude-xyz',
        expect.objectContaining({ prompt: 'Now fix the tests too' }),
      );
    });

    it('should auto-stop running session and resume with new message', async () => {
      const sessions = (manager as unknown as { _sessions: Map<string, CliSession> })._sessions;
      sessions.set('cli-busy', makeSession({ id: 'cli-busy', status: 'running' }));
      vi.mocked(manager.getSession).mockImplementation((id) => sessions.get(id) ?? null);
      vi.mocked(manager.getSessionByClaudeId).mockReturnValue(sessions.get('cli-busy') ?? null);
      vi.mocked(manager.stopSession).mockResolvedValue();
      vi.mocked(manager.resumeSession).mockReturnValue(
        makeSession({ id: 'cli-resumed', claudeSessionId: 'test-claude-id', status: 'running' }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/cli-busy/message',
        payload: { message: 'hello' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      expect(manager.stopSession).toHaveBeenCalledWith('cli-busy', true);
    });

    it('should return 404 for unknown session', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/nope/message',
        payload: { message: 'test' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('should return 400 when message is missing', async () => {
      const sessions = (manager as unknown as { _sessions: Map<string, CliSession> })._sessions;
      sessions.set('cli-m', makeSession({ id: 'cli-m', status: 'paused' }));
      vi.mocked(manager.getSession).mockImplementation((id) => sessions.get(id) ?? null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/cli-m/message',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── DELETE /api/sessions/:sessionId ────────────────────────────

  describe('DELETE /api/sessions/:sessionId', () => {
    it('should stop a session and return 200', async () => {
      const sessions = (manager as unknown as { _sessions: Map<string, CliSession> })._sessions;
      sessions.set('cli-del', makeSession({ id: 'cli-del' }));
      vi.mocked(manager.getSession).mockImplementation((id) => sessions.get(id) ?? null);

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/sessions/cli-del',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.sessionId).toBe('cli-del');
      expect(manager.stopSession).toHaveBeenCalledWith('cli-del', true);
    });

    it('should return 404 for unknown session', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/sessions/nope',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── GET /api/sessions/discover ─────────────────────────────────

  describe('GET /api/sessions/discover', () => {
    it('should return discovered sessions', async () => {
      const discovered: DiscoveredSession[] = [
        {
          sessionId: 'sess-a',
          projectPath: '/home/user/proj-a',
          summary: 'Fixed auth bug',
          messageCount: 12,
          lastActivity: '2026-03-03T09:00:00Z',
          branch: 'main',
        },
        {
          sessionId: 'sess-b',
          projectPath: '/home/user/proj-b',
          summary: 'Added tests',
          messageCount: 5,
          lastActivity: '2026-03-03T08:00:00Z',
          branch: 'feat/tests',
        },
      ];
      vi.mocked(manager.discoverLocalSessions).mockReturnValue(discovered);

      const res = await app.inject({
        method: 'GET',
        url: '/api/sessions/discover',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBe(2);
      expect(body.sessions).toHaveLength(2);
      expect(body.sessions[0].sessionId).toBe('sess-a');
      expect(body.machineId).toBe(MACHINE_ID);
    });

    it('should pass projectPath filter', async () => {
      await app.inject({
        method: 'GET',
        url: '/api/sessions/discover?projectPath=/home/user/proj-a',
      });

      expect(manager.discoverLocalSessions).toHaveBeenCalledWith('/home/user/proj-a');
    });

    it('should return empty when no sessions discovered', async () => {
      vi.mocked(manager.discoverLocalSessions).mockReturnValue([]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/sessions/discover',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().count).toBe(0);
    });
  });

  // ── Session serialization ──────────────────────────────────────

  describe('Session JSON serialization', () => {
    it('should serialize dates as ISO strings', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { sessionId: 'cp-s', agentId: 'a', projectPath: '/tmp' },
      });

      const sessions = manager.listSessions();
      const session = sessions[0];

      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/${session.id}`,
      });

      const body = res.json();
      // Should be ISO string, not a Date object
      expect(typeof body.startedAt).toBe('string');
      expect(typeof body.lastActivity).toBe('string');
      expect(body.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should include all expected fields', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { sessionId: 'cp-f', agentId: 'agent-f', projectPath: '/p' },
      });

      const session = manager.listSessions()[0];
      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/${session.id}`,
      });

      const body = res.json();
      const expectedKeys = [
        'id',
        'claudeSessionId',
        'agentId',
        'projectPath',
        'status',
        'model',
        'pid',
        'costUsd',
        'messageCount',
        'startedAt',
        'lastActivity',
        'isResumed',
      ];

      for (const key of expectedKeys) {
        expect(body).toHaveProperty(key);
      }
    });
  });
});
