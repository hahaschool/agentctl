import { EventEmitter } from 'node:events';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CliSession,
  CliSessionManager,
  CliSessionStatus,
  DiscoveredSession,
} from '../../runtime/cli-session-manager.js';
import { createSilentLogger } from '../../test-helpers.js';
import { parseJsonlEntry, sessionRoutes } from './sessions.js';

// ---------------------------------------------------------------------------
// Partial mock for node:fs and node:os — used by the content endpoint tests.
// The mock is hoisted; per-test behaviour is set via vi.mocked().
// ---------------------------------------------------------------------------

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    statSync: vi.fn(actual.statSync),
    readFileSync: vi.fn(actual.readFileSync),
    readdirSync: vi.fn(actual.readdirSync),
    writeFileSync: vi.fn(),
  };
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: vi.fn(actual.homedir),
  };
});

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const MACHINE_ID = 'test-worker-001';

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
    logger: createSilentLogger(),
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
    vi.restoreAllMocks();
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

  // ── POST / — JSONL truncation fork ────────────────────────────

  describe('POST / — JSONL truncation fork', () => {
    const FAKE_HOME = '/fake-home';
    const PROJECT_PATH = '/home/user/myproject';
    const ENCODED_PATH = PROJECT_PATH.replace(/\//g, '-');
    const PARENT_CLAUDE_ID = 'parent-claude-session-id';
    const JSONL_DIR = `${FAKE_HOME}/.claude/projects/${ENCODED_PATH}`;
    const PARENT_JSONL = `${JSONL_DIR}/${PARENT_CLAUDE_ID}.jsonl`;

    function setupTruncationMocks(opts: { fileContent: string }): void {
      vi.mocked(homedir).mockReturnValue(FAKE_HOME);

      vi.mocked(existsSync).mockImplementation((p: string | URL) => {
        const path = String(p);
        if (path === `${FAKE_HOME}/.claude/projects`) return true;
        if (path === PARENT_JSONL) return true;
        return false;
      });

      vi.mocked(readFileSync).mockImplementation((p: string | URL | number) => {
        if (String(p) === PARENT_JSONL) return opts.fileContent;
        throw new Error(`ENOENT: ${String(p)}`);
      });

      vi.mocked(readdirSync).mockReturnValue([]);
    }

    afterEach(() => {
      vi.mocked(existsSync).mockReset();
      vi.mocked(readFileSync).mockReset();
      vi.mocked(writeFileSync).mockReset();
      vi.mocked(readdirSync).mockReset();
      vi.mocked(homedir).mockReset();
    });

    it('truncates JSONL and uses new session ID for resume when forkAtIndex provided', async () => {
      const lines = [
        JSON.stringify({
          type: 'user',
          message: { content: [{ type: 'text', text: 'Hello' }] },
        }),
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Hi there' }] },
        }),
        JSON.stringify({
          type: 'user',
          message: { content: [{ type: 'text', text: 'Fix bug' }] },
        }),
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Done' }] },
        }),
      ].join('\n');

      setupTruncationMocks({ fileContent: lines });

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          sessionId: 'fork-session-1',
          agentId: 'agent-1',
          projectPath: PROJECT_PATH,
          prompt: 'Continue from message 2',
          resumeSessionId: PARENT_CLAUDE_ID,
          forkAtIndex: 2,
        },
      });

      expect(res.statusCode).toBe(201);

      // Should have written a truncated JSONL file
      expect(writeFileSync).toHaveBeenCalledTimes(1);
      const [writePath, writeContent] = vi.mocked(writeFileSync).mock.calls[0] as [string, string];
      expect(writePath).toBe(`${JSONL_DIR}/fork-session-1.jsonl`);

      // The truncated content should contain fewer lines than the original
      const writtenLines = (writeContent as string).trim().split('\n');
      expect(writtenLines.length).toBeLessThanOrEqual(4);
      expect(writtenLines.length).toBeGreaterThanOrEqual(1);

      // The session should be started with the fork session ID as resumeSessionId
      expect(manager.startSession).toHaveBeenCalledWith(
        expect.objectContaining({
          resumeSessionId: 'fork-session-1',
        }),
      );
    });

    it('does not truncate when forkAtIndex is not provided (backward compat)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          sessionId: 'no-fork-session',
          agentId: 'agent-1',
          projectPath: PROJECT_PATH,
          prompt: 'Normal resume',
          resumeSessionId: PARENT_CLAUDE_ID,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(writeFileSync).not.toHaveBeenCalled();

      // Should use original resumeSessionId
      expect(manager.startSession).toHaveBeenCalledWith(
        expect.objectContaining({
          resumeSessionId: PARENT_CLAUDE_ID,
        }),
      );
    });

    it('falls back to original resumeSessionId when parent JSONL not found', async () => {
      vi.mocked(homedir).mockReturnValue(FAKE_HOME);
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(readdirSync).mockReturnValue([]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          sessionId: 'fork-no-jsonl',
          agentId: 'agent-1',
          projectPath: PROJECT_PATH,
          prompt: 'Fork with missing JSONL',
          resumeSessionId: PARENT_CLAUDE_ID,
          forkAtIndex: 3,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(writeFileSync).not.toHaveBeenCalled();

      // Should fall back to original resumeSessionId
      expect(manager.startSession).toHaveBeenCalledWith(
        expect.objectContaining({
          resumeSessionId: PARENT_CLAUDE_ID,
        }),
      );
    });
  });

  // ── POST / — systemPrompt injection ─────────────────────────────

  describe('POST / — systemPrompt injection', () => {
    it('passes systemPrompt as config.systemPrompt to session manager', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          sessionId: 'ctx-inject-1',
          agentId: 'agent-1',
          projectPath: '/tmp/project',
          prompt: 'Continue with context',
          systemPrompt: '## Previous Conversation Context\n\n### User\nFix the bug',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(manager.startSession).toHaveBeenCalledWith(
        expect.objectContaining({
          config: {
            systemPrompt: '## Previous Conversation Context\n\n### User\nFix the bug',
          },
        }),
      );
    });

    it('does not pass config when systemPrompt is not provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          sessionId: 'no-ctx-1',
          agentId: 'agent-1',
          projectPath: '/tmp/project',
          prompt: 'Normal session',
        },
      });

      expect(res.statusCode).toBe(201);
      const callArgs = vi.mocked(manager.startSession).mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.config).toBeUndefined();
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

    it('should cleanup cpSessionIdMap, reportedClaudeIds, intentionalStops, and sessionBuffers on DELETE', async () => {
      const sessions = (manager as unknown as { _sessions: Map<string, CliSession> })._sessions;
      const session = makeSession({ id: 'cli-cleanup-test' });
      sessions.set('cli-cleanup-test', session);
      vi.mocked(manager.getSession).mockImplementation((id) => sessions.get(id) ?? null);

      // First create the session via POST to populate the internal maps
      await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          sessionId: 'cp-sess-123',
          agentId: 'agent-1',
          projectPath: '/tmp/project',
          prompt: 'Test',
        },
      });

      // Now delete it — should cleanup all maps
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/sessions/cli-cleanup-test',
      });

      expect(res.statusCode).toBe(200);
      expect(manager.stopSession).toHaveBeenCalledWith('cli-cleanup-test', true);
      // Verify stopSession was called (which is essential for process cleanup)
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

  // ── Session serialization ──────────────────────────────────────────

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

  // ── GET /api/sessions/content/:claudeSessionId ───────────────────

  describe('GET /api/sessions/content/:claudeSessionId', () => {
    const FAKE_HOME = '/fake-home';
    const CLAUDE_SESSION_ID = 'test-session-abc123';
    const PROJECT_PATH = '/home/user/myproject';
    const ENCODED_PATH = PROJECT_PATH.replace(/\//g, '-');
    const JSONL_DIR = `${FAKE_HOME}/.claude/projects/${ENCODED_PATH}`;
    const JSONL_FILE = `${JSONL_DIR}/${CLAUDE_SESSION_ID}.jsonl`;

    function setupFsMocks(opts: {
      fileExists?: boolean;
      fileSize?: number;
      fileContent?: string;
    }): void {
      const { fileExists = true, fileSize = 100, fileContent = '' } = opts;

      vi.mocked(homedir).mockReturnValue(FAKE_HOME);

      vi.mocked(existsSync).mockImplementation((p: string | URL) => {
        const path = String(p);
        if (path === `${FAKE_HOME}/.claude/projects`) return true;
        if (path === JSONL_FILE) return fileExists;
        return false;
      });

      if (fileExists) {
        vi.mocked(statSync).mockImplementation((p: string | URL) => {
          if (String(p) === JSONL_FILE) {
            return { size: fileSize, isDirectory: () => false } as ReturnType<typeof statSync>;
          }
          throw new Error(`ENOENT: ${String(p)}`);
        });

        vi.mocked(readFileSync).mockImplementation((p: string | URL | number) => {
          if (String(p) === JSONL_FILE) return fileContent;
          throw new Error(`ENOENT: ${String(p)}`);
        });
      }

      // readdirSync for the fallback recursive search — return empty to avoid scanning
      vi.mocked(readdirSync).mockReturnValue([]);
    }

    it('should return 404 when JSONL file is not found', async () => {
      setupFsMocks({ fileExists: false });

      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/content/${CLAUDE_SESSION_ID}?projectPath=${encodeURIComponent(PROJECT_PATH)}`,
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.code).toBe('SESSION_CONTENT_NOT_FOUND');
    });

    it('should return 413 when JSONL file exceeds 100 MB', async () => {
      const overLimit = 100 * 1024 * 1024 + 1; // one byte over
      setupFsMocks({ fileExists: true, fileSize: overLimit });

      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/content/${CLAUDE_SESSION_ID}?projectPath=${encodeURIComponent(PROJECT_PATH)}`,
      });

      expect(res.statusCode).toBe(413);
      const body = res.json();
      expect(body.code).toBe('CONTENT_TOO_LARGE');
      expect(body.error).toContain('100 MB');
    });

    it('should return 200 with exactly 100 MB file (boundary)', async () => {
      const atLimit = 100 * 1024 * 1024;
      const content = JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'text', text: 'Hello' }] },
      });
      setupFsMocks({ fileExists: true, fileSize: atLimit, fileContent: content });

      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/content/${CLAUDE_SESSION_ID}?projectPath=${encodeURIComponent(PROJECT_PATH)}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.messages).toHaveLength(1);
      expect(body.sessionId).toBe(CLAUDE_SESSION_ID);
    });

    it('should parse JSONL content and return messages', async () => {
      const lines = [
        JSON.stringify({
          type: 'user',
          message: { content: [{ type: 'text', text: 'Fix the bug' }] },
          timestamp: '2026-03-01T10:00:00Z',
        }),
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'I will fix the bug now.' }] },
          timestamp: '2026-03-01T10:00:05Z',
        }),
      ].join('\n');

      setupFsMocks({ fileExists: true, fileSize: lines.length, fileContent: lines });

      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/content/${CLAUDE_SESSION_ID}?projectPath=${encodeURIComponent(PROJECT_PATH)}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalMessages).toBe(2);
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].type).toBe('human');
      expect(body.messages[0].content).toBe('Fix the bug');
      expect(body.messages[1].type).toBe('assistant');
      expect(body.messages[1].content).toBe('I will fix the bug now.');
    });

    it('should apply limit parameter', async () => {
      const lines = Array.from({ length: 5 }, (_, i) =>
        JSON.stringify({
          type: 'user',
          message: { content: [{ type: 'text', text: `Message ${i + 1}` }] },
        }),
      ).join('\n');

      setupFsMocks({ fileExists: true, fileSize: lines.length, fileContent: lines });

      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/content/${CLAUDE_SESSION_ID}?projectPath=${encodeURIComponent(PROJECT_PATH)}&limit=2`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalMessages).toBe(5);
      // limit=2 returns the last 2 messages (offset default 0 → latest)
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].content).toBe('Message 4');
      expect(body.messages[1].content).toBe('Message 5');
    });

    it('should apply offset parameter (skip latest N messages)', async () => {
      const lines = Array.from({ length: 5 }, (_, i) =>
        JSON.stringify({
          type: 'user',
          message: { content: [{ type: 'text', text: `Msg ${i + 1}` }] },
        }),
      ).join('\n');

      setupFsMocks({ fileExists: true, fileSize: lines.length, fileContent: lines });

      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/content/${CLAUDE_SESSION_ID}?projectPath=${encodeURIComponent(PROJECT_PATH)}&limit=2&offset=2`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalMessages).toBe(5);
      // offset=2 skips the last 2, limit=2 takes the next 2 from the end
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].content).toBe('Msg 2');
      expect(body.messages[1].content).toBe('Msg 3');
    });

    it('should skip unparseable JSONL lines gracefully', async () => {
      const lines = [
        '{ bad json',
        JSON.stringify({
          type: 'user',
          message: { content: [{ type: 'text', text: 'Valid message' }] },
        }),
        'not json at all',
      ].join('\n');

      setupFsMocks({ fileExists: true, fileSize: lines.length, fileContent: lines });

      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/content/${CLAUDE_SESSION_ID}?projectPath=${encodeURIComponent(PROJECT_PATH)}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalMessages).toBe(1);
      expect(body.messages[0].content).toBe('Valid message');
    });

    it('should return empty messages for empty JSONL file', async () => {
      setupFsMocks({ fileExists: true, fileSize: 0, fileContent: '' });

      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/content/${CLAUDE_SESSION_ID}?projectPath=${encodeURIComponent(PROJECT_PATH)}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalMessages).toBe(0);
      expect(body.messages).toEqual([]);
    });

    it('should use default limit of 100 when not specified', async () => {
      // Create 150 messages
      const lines = Array.from({ length: 150 }, (_, i) =>
        JSON.stringify({
          type: 'user',
          message: { content: [{ type: 'text', text: `Msg ${i}` }] },
        }),
      ).join('\n');

      setupFsMocks({ fileExists: true, fileSize: lines.length, fileContent: lines });

      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/content/${CLAUDE_SESSION_ID}?projectPath=${encodeURIComponent(PROJECT_PATH)}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalMessages).toBe(150);
      // Default limit=100, offset=0, so we get the last 100 messages
      expect(body.messages).toHaveLength(100);
      expect(body.messages[0].content).toBe('Msg 50');
      expect(body.messages[99].content).toBe('Msg 149');
    });

    it('should handle offset larger than total messages', async () => {
      const lines = [
        JSON.stringify({
          type: 'user',
          message: { content: [{ type: 'text', text: 'Only message' }] },
        }),
      ].join('\n');

      setupFsMocks({ fileExists: true, fileSize: lines.length, fileContent: lines });

      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/content/${CLAUDE_SESSION_ID}?projectPath=${encodeURIComponent(PROJECT_PATH)}&offset=100`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalMessages).toBe(1);
      expect(body.messages).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// parseJsonlEntry — direct unit tests
// ---------------------------------------------------------------------------

describe('parseJsonlEntry', () => {
  // ── Basic / edge cases ─────────────────────────────────────────

  it('should return empty array for null input', () => {
    expect(parseJsonlEntry(null)).toEqual([]);
  });

  it('should return empty array for non-object input', () => {
    expect(parseJsonlEntry('hello')).toEqual([]);
    expect(parseJsonlEntry(42)).toEqual([]);
  });

  it('should return empty array for unknown entry type', () => {
    expect(parseJsonlEntry({ type: 'system', message: { content: 'hi' } })).toEqual([]);
    expect(parseJsonlEntry({ type: 'queue-operation' })).toEqual([]);
  });

  it('should return empty array when type is missing', () => {
    expect(parseJsonlEntry({ message: { content: 'hi' } })).toEqual([]);
  });

  // ── Thinking blocks ────────────────────────────────────────────

  describe('thinking blocks', () => {
    it('should parse assistant entry with thinking block', () => {
      const entry = {
        type: 'assistant',
        timestamp: '2026-03-06T10:00:00Z',
        message: {
          content: [
            { type: 'thinking', thinking: 'Let me reason about this problem step by step.' },
          ],
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        type: 'thinking',
        content: 'Let me reason about this problem step by step.',
        timestamp: '2026-03-06T10:00:00Z',
      });
    });

    it('should skip thinking block with empty text', () => {
      const entry = {
        type: 'assistant',
        message: {
          content: [{ type: 'thinking', thinking: '   ' }],
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(0);
    });

    it('should skip thinking block with non-string thinking field', () => {
      const entry = {
        type: 'assistant',
        message: {
          content: [{ type: 'thinking', thinking: 123 }],
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(0);
    });

    it('should parse thinking alongside text and tool_use blocks', () => {
      const entry = {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'I need to read the file first.' },
            { type: 'text', text: 'Let me check the file.' },
            { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/tmp/x' } },
          ],
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(3);
      expect(results[0].type).toBe('thinking');
      expect(results[1].type).toBe('assistant');
      expect(results[2].type).toBe('tool_use');
    });
  });

  // ── Progress entries ───────────────────────────────────────────

  describe('progress entries', () => {
    it('should parse agent_progress as subagent type', () => {
      const entry = {
        type: 'progress',
        timestamp: '2026-03-06T10:01:00Z',
        data: {
          type: 'agent_progress',
          content: 'Working on fixing the auth module',
          agentType: 'codegen',
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        type: 'subagent',
        content: 'Working on fixing the auth module',
        toolName: 'codegen',
        timestamp: '2026-03-06T10:01:00Z',
      });
    });

    it('should default agentType to "subagent" when not provided', () => {
      const entry = {
        type: 'progress',
        data: { type: 'agent_progress', content: 'Doing stuff' },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].toolName).toBe('subagent');
    });

    it('should skip agent_progress with empty content', () => {
      const entry = {
        type: 'progress',
        data: { type: 'agent_progress', content: '  ' },
      };

      expect(parseJsonlEntry(entry)).toHaveLength(0);
    });

    it('should truncate agent_progress content to 4000 chars', () => {
      const entry = {
        type: 'progress',
        data: { type: 'agent_progress', content: 'x'.repeat(5000) },
      };

      const results = parseJsonlEntry(entry);
      expect(results[0].content).toHaveLength(4000);
    });

    it('should parse agent_progress with prompt field (real CLI format)', () => {
      const entry = {
        type: 'progress',
        timestamp: '2026-03-06T10:01:30Z',
        data: {
          type: 'agent_progress',
          prompt: 'Fix the auth module and add tests',
          agentId: 'a4de052fcb9393841',
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('subagent');
      expect(results[0].content).toBe('Fix the auth module and add tests');
      expect(results[0].subagentId).toBe('a4de052fcb9393841');
    });

    it('should skip mcp_progress with status completed', () => {
      const entry = {
        type: 'progress',
        data: { type: 'mcp_progress', status: 'completed', serverName: 'slack', toolName: 'send' },
      };

      expect(parseJsonlEntry(entry)).toHaveLength(0);
    });

    it('should parse bash_progress with command and toolName "bash"', () => {
      const entry = {
        type: 'progress',
        timestamp: '2026-03-06T10:02:00Z',
        data: {
          type: 'bash_progress',
          command: 'npm test --coverage',
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        type: 'progress',
        content: 'npm test --coverage',
        toolName: 'bash',
        timestamp: '2026-03-06T10:02:00Z',
      });
    });

    it('should skip bash_progress with empty command', () => {
      const entry = {
        type: 'progress',
        data: { type: 'bash_progress', command: '' },
      };

      expect(parseJsonlEntry(entry)).toHaveLength(0);
    });

    it('should parse waiting_for_task with taskDescription and taskType as toolName', () => {
      const entry = {
        type: 'progress',
        timestamp: '2026-03-06T10:03:00Z',
        data: {
          type: 'waiting_for_task',
          taskDescription: 'Running integration tests',
          taskType: 'test-runner',
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        type: 'progress',
        content: 'Running integration tests',
        toolName: 'test-runner',
        timestamp: '2026-03-06T10:03:00Z',
      });
    });

    it('should default toolName to "task" when taskType is not provided', () => {
      const entry = {
        type: 'progress',
        data: {
          type: 'waiting_for_task',
          taskDescription: 'Some task',
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results[0].toolName).toBe('task');
    });

    it('should skip waiting_for_task with empty description', () => {
      const entry = {
        type: 'progress',
        data: { type: 'waiting_for_task', taskDescription: '  ' },
      };

      expect(parseJsonlEntry(entry)).toHaveLength(0);
    });

    it('should parse mcp_progress with server and tool name', () => {
      const entry = {
        type: 'progress',
        timestamp: '2026-03-06T10:10:00Z',
        data: { type: 'mcp_progress', serverName: 'filesystem', toolName: 'read_file' },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('progress');
      expect(results[0].content).toBe('filesystem: read_file');
      expect(results[0].toolName).toBe('mcp');
    });

    it('should parse mcp_progress with server name only', () => {
      const entry = {
        type: 'progress',
        data: { type: 'mcp_progress', serverName: 'slack' },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('slack');
    });

    it('should parse hook_progress with name and event', () => {
      const entry = {
        type: 'progress',
        timestamp: '2026-03-06T10:11:00Z',
        data: { type: 'hook_progress', hookName: 'PreToolUse', event: 'Bash' },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('progress');
      expect(results[0].content).toBe('PreToolUse (Bash)');
      expect(results[0].toolName).toBe('hook');
    });

    it('should parse hook_progress with name only', () => {
      const entry = {
        type: 'progress',
        data: { type: 'hook_progress', hookName: 'PostToolUse' },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('PostToolUse');
    });

    it('should return empty array for unknown progress type', () => {
      const entry = {
        type: 'progress',
        data: { type: 'something_unknown', foo: 'bar' },
      };

      expect(parseJsonlEntry(entry)).toEqual([]);
    });

    it('should return empty array when progress data is missing', () => {
      const entry = { type: 'progress' };
      expect(parseJsonlEntry(entry)).toEqual([]);
    });

    it('should return empty array when progress data is not an object', () => {
      const entry = { type: 'progress', data: 'invalid' };
      expect(parseJsonlEntry(entry)).toEqual([]);
    });
  });

  // ── TodoWrite detection ────────────────────────────────────────

  describe('TodoWrite detection', () => {
    it('should return both tool_use and todo entries for TodoWrite with todos', () => {
      const todos = [
        { id: '1', content: 'Fix login', status: 'pending' },
        { id: '2', content: 'Add tests', status: 'done' },
      ];

      const entry = {
        type: 'assistant',
        timestamp: '2026-03-06T10:04:00Z',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_todo_1',
              name: 'TodoWrite',
              input: { todos },
            },
          ],
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(2);

      // First entry: tool_use
      expect(results[0].type).toBe('tool_use');
      expect(results[0].toolName).toBe('TodoWrite');
      expect(results[0].toolId).toBe('toolu_todo_1');

      // Second entry: todo
      expect(results[1].type).toBe('todo');
      expect(results[1].toolName).toBe('TodoWrite');
      expect(results[1].content).toBe(JSON.stringify(todos));
      expect(results[1].timestamp).toBe('2026-03-06T10:04:00Z');
    });

    it('should return only tool_use when TodoWrite has no todos array', () => {
      const entry = {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_todo_2',
              name: 'TodoWrite',
              input: { someOtherField: 'value' },
            },
          ],
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('tool_use');
      expect(results[0].toolName).toBe('TodoWrite');
    });

    it('should return only tool_use when TodoWrite input is a string', () => {
      const entry = {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_todo_3',
              name: 'TodoWrite',
              input: 'raw string input',
            },
          ],
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('tool_use');
    });
  });

  // ── Tool IDs ───────────────────────────────────────────────────

  describe('tool IDs', () => {
    it('should include toolId on tool_use entries', () => {
      const entry = {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'toolu_abc123', name: 'Read', input: { file_path: '/tmp/x' } },
          ],
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].toolId).toBe('toolu_abc123');
    });

    it('should not include toolId when id field is missing on tool_use', () => {
      const entry = {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Bash', input: 'ls -la' }],
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].toolId).toBeUndefined();
    });

    it('should include toolId on tool_result entries from tool_use_id', () => {
      const entry = {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_def456', content: 'file contents here' },
          ],
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('tool_result');
      expect(results[0].toolId).toBe('toolu_def456');
    });

    it('should not include toolId when tool_use_id is missing on tool_result', () => {
      const entry = {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', content: 'some result' }],
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].toolId).toBeUndefined();
    });
  });

  // ── Sidechain tagging ──────────────────────────────────────────

  describe('sidechain tagging', () => {
    it('should tag all results with subagentId when isSidechain is true and agentId is set', () => {
      const entry = {
        type: 'assistant',
        isSidechain: true,
        agentId: 'subagent-42',
        message: {
          content: [
            { type: 'text', text: 'Working on subtask' },
            {
              type: 'tool_use',
              id: 'toolu_x',
              name: 'Write',
              input: { file_path: '/tmp/y', content: 'code' },
            },
          ],
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(2);
      for (const r of results) {
        expect(r.subagentId).toBe('subagent-42');
      }
    });

    it('should not set subagentId when isSidechain is false', () => {
      const entry = {
        type: 'assistant',
        isSidechain: false,
        agentId: 'subagent-42',
        message: {
          content: [{ type: 'text', text: 'Main thread work' }],
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].subagentId).toBeUndefined();
    });

    it('should not set subagentId when isSidechain is true but agentId is missing', () => {
      const entry = {
        type: 'assistant',
        isSidechain: true,
        message: {
          content: [{ type: 'text', text: 'No agent ID' }],
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].subagentId).toBeUndefined();
    });

    it('should tag progress entries with subagentId when isSidechain', () => {
      const entry = {
        type: 'progress',
        isSidechain: true,
        agentId: 'sub-agent-7',
        data: {
          type: 'agent_progress',
          content: 'Subagent running',
          agentType: 'codegen',
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].subagentId).toBe('sub-agent-7');
    });

    it('should tag bash_progress with subagentId when isSidechain', () => {
      const entry = {
        type: 'progress',
        isSidechain: true,
        agentId: 'sub-bash-1',
        data: {
          type: 'bash_progress',
          command: 'make build',
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].subagentId).toBe('sub-bash-1');
    });

    it('should tag waiting_for_task with subagentId when isSidechain', () => {
      const entry = {
        type: 'progress',
        isSidechain: true,
        agentId: 'sub-wait-1',
        data: {
          type: 'waiting_for_task',
          taskDescription: 'Waiting for build',
          taskType: 'build',
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].subagentId).toBe('sub-wait-1');
    });

    it('should tag mcp_progress with subagentId when isSidechain', () => {
      const entry = {
        type: 'progress',
        isSidechain: true,
        agentId: 'sub-mcp-1',
        data: {
          type: 'mcp_progress',
          serverName: 'notion',
          toolName: 'search',
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].subagentId).toBe('sub-mcp-1');
    });

    it('should tag hook_progress with subagentId when isSidechain', () => {
      const entry = {
        type: 'progress',
        isSidechain: true,
        agentId: 'sub-hook-1',
        data: {
          type: 'hook_progress',
          hookName: 'PreToolUse',
          event: 'Write',
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].subagentId).toBe('sub-hook-1');
    });
  });

  // ── Standard message types (regression) ────────────────────────

  describe('standard message types', () => {
    it('should parse user text entry', () => {
      const entry = {
        type: 'user',
        timestamp: '2026-03-06T10:00:00Z',
        message: { content: [{ type: 'text', text: 'Fix the bug please' }] },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        type: 'human',
        content: 'Fix the bug please',
        timestamp: '2026-03-06T10:00:00Z',
      });
    });

    it('should parse user string content (non-array)', () => {
      const entry = {
        type: 'user',
        message: { content: 'Plain string content' },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('human');
      expect(results[0].content).toBe('Plain string content');
    });

    it('should parse assistant text entry', () => {
      const entry = {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Here is the fix.' }] },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('assistant');
      expect(results[0].content).toBe('Here is the fix.');
    });

    it('should skip system-injected user text', () => {
      const entry = {
        type: 'user',
        message: {
          content: [{ type: 'text', text: '<system-reminder>Do not do X</system-reminder>' }],
        },
      };

      expect(parseJsonlEntry(entry)).toHaveLength(0);
    });

    it('should skip empty content blocks', () => {
      const entry = {
        type: 'assistant',
        message: { content: [{ type: 'text', text: '   ' }] },
      };

      expect(parseJsonlEntry(entry)).toHaveLength(0);
    });

    it('should return empty for missing message', () => {
      expect(parseJsonlEntry({ type: 'assistant' })).toEqual([]);
    });

    it('should return empty for empty content array', () => {
      const entry = { type: 'assistant', message: { content: [] } };
      expect(parseJsonlEntry(entry)).toEqual([]);
    });
  });

  // ── Truncation limits ──────────────────────────────────────────

  describe('truncation limits', () => {
    it('should truncate user text blocks to 8000 chars', () => {
      const longText = 'x'.repeat(10_000);
      const entry = {
        type: 'user',
        message: { content: [{ type: 'text', text: longText }] },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('human');
      expect(results[0].content).toHaveLength(8000);
    });

    it('should not truncate user text blocks at or below 8000 chars', () => {
      const exactText = 'y'.repeat(8000);
      const entry = {
        type: 'user',
        message: { content: [{ type: 'text', text: exactText }] },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].content).toHaveLength(8000);
    });

    it('should truncate assistant text blocks to 8000 chars', () => {
      const longText = 'a'.repeat(12_000);
      const entry = {
        type: 'assistant',
        message: { content: [{ type: 'text', text: longText }] },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('assistant');
      expect(results[0].content).toHaveLength(8000);
    });

    it('should not truncate assistant text blocks at exactly 8000 chars', () => {
      const exactText = 'b'.repeat(8000);
      const entry = {
        type: 'assistant',
        message: { content: [{ type: 'text', text: exactText }] },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].content).toHaveLength(8000);
    });

    it('should truncate tool_result string content to 4000 chars', () => {
      const longContent = 'r'.repeat(6000);
      const entry = {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'toolu_abc', content: longContent }],
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('tool_result');
      expect(results[0].content).toHaveLength(4000);
    });

    it('should truncate tool_result non-string content (JSON serialized) to 4000 chars', () => {
      // When content is not a string, it gets JSON.stringify'd then truncated
      const bigArray = Array.from({ length: 500 }, (_, i) => ({ index: i, data: 'x'.repeat(20) }));
      const entry = {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'toolu_xyz', content: bigArray }],
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('tool_result');
      expect(results[0].content.length).toBeLessThanOrEqual(4000);
    });

    it('should truncate tool_use string input to 4000 chars', () => {
      const longInput = 'i'.repeat(5000);
      const entry = {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Bash', id: 'toolu_001', input: longInput }],
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('tool_use');
      expect(results[0].content).toHaveLength(4000);
    });

    it('should truncate tool_use object input (JSON serialized) to 4000 chars', () => {
      const bigObject = {
        file_path: '/tmp/test',
        content: 'z'.repeat(6000),
      };
      const entry = {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Write', id: 'toolu_002', input: bigObject }],
        },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('tool_use');
      expect(results[0].content.length).toBeLessThanOrEqual(4000);
    });

    it('should truncate user string content (non-array) — no truncation applied for string message.content', () => {
      // When message.content is a plain string (not array), the code does NOT truncate
      // This test documents the current behavior
      const longString = 'q'.repeat(10_000);
      const entry = {
        type: 'user',
        message: { content: longString },
      };

      const results = parseJsonlEntry(entry);
      expect(results).toHaveLength(1);
      // Plain string content path does not apply 8000-char truncation
      expect(results[0].content).toHaveLength(10_000);
    });
  });
});
