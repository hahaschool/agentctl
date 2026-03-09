import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Machine } from '@agentctl/shared';
import { ApiClient, MobileClientError } from '../services/api-client.js';
import type { RuntimeSessionHandoff, RuntimeSessionInfo } from '../services/runtime-session-api.js';
import type { RuntimeSessionScreenState } from './runtime-session-presenter.js';
import { RuntimeSessionPresenter } from './runtime-session-presenter.js';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(),
}));

vi.stubGlobal('fetch', mocks.fetch);

function jsonResponse(body: unknown, status = 200, statusText = 'OK'): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeSession(partial: Partial<RuntimeSessionInfo> = {}): RuntimeSessionInfo {
  return {
    id: 'ms-1',
    runtime: 'codex',
    nativeSessionId: 'native-1',
    machineId: 'machine-1',
    agentId: null,
    projectPath: '/tmp/project',
    worktreePath: '/tmp/project/.trees/runtime',
    status: 'active',
    configRevision: 4,
    handoffStrategy: null,
    handoffSourceSessionId: null,
    metadata: { model: 'gpt-5-codex' },
    startedAt: '2026-03-09T12:00:00.000Z',
    lastHeartbeat: '2026-03-09T12:05:00.000Z',
    endedAt: null,
    ...partial,
  };
}

function makeHandoff(partial: Partial<RuntimeSessionHandoff> = {}): RuntimeSessionHandoff {
  return {
    id: 'handoff-1',
    sourceSessionId: 'ms-1',
    targetSessionId: 'ms-2',
    sourceRuntime: 'codex',
    targetRuntime: 'claude-code',
    reason: 'manual',
    strategy: 'snapshot-handoff',
    status: 'succeeded',
    snapshot: {
      sourceRuntime: 'codex',
      sourceSessionId: 'ms-1',
      projectPath: '/tmp/project',
      worktreePath: '/tmp/project/.trees/runtime',
      branch: 'feature/runtime',
      headSha: 'abc123',
      dirtyFiles: ['packages/shared/src/types/runtime-management.ts'],
      diffSummary: 'Added mobile runtime switching.',
      conversationSummary: 'Continue on mobile.',
      openTodos: ['Ship runtime tab'],
      nextSuggestedPrompt: 'Verify runtime handoff.',
      activeConfigRevision: 4,
      activeMcpServers: ['github'],
      activeSkills: ['brainstorming'],
      reason: 'manual',
    },
    errorMessage: null,
    createdAt: '2026-03-09T12:06:00.000Z',
    completedAt: '2026-03-09T12:06:10.000Z',
    ...partial,
  };
}

function makeMachine(partial: Partial<Machine> = {}): Machine {
  return {
    id: 'machine-1',
    hostname: 'mac-mini',
    tailscaleIp: '100.0.0.1',
    os: 'darwin',
    arch: 'arm64',
    status: 'online',
    lastHeartbeat: new Date('2026-03-09T12:05:00.000Z'),
    capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
    createdAt: new Date('2026-03-09T10:00:00.000Z'),
    ...partial,
  };
}

function queueSessionAndMachineLoad(
  sessions: RuntimeSessionInfo[] = [makeSession()],
  machines: Machine[] = [makeMachine()],
): void {
  mocks.fetch
    .mockResolvedValueOnce(jsonResponse({ sessions, count: sessions.length }))
    .mockResolvedValueOnce(jsonResponse(machines));
}

describe('RuntimeSessionPresenter', () => {
  let apiClient: ApiClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-09T12:10:00.000Z'));
    vi.clearAllMocks();
    apiClient = new ApiClient({ baseUrl: 'https://cp.example.com', authToken: 'tok_runtime' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns empty state before loading', () => {
    const presenter = new RuntimeSessionPresenter({ apiClient });
    const state = presenter.getState();

    expect(state.sessions).toEqual([]);
    expect(state.selectedSession).toBeNull();
    expect(state.handoffs).toEqual([]);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('loads runtime sessions and updates lastUpdated', async () => {
    queueSessionAndMachineLoad(
      [makeSession(), makeSession({ id: 'ms-2', runtime: 'claude-code' })],
      [makeMachine(), makeMachine({ id: 'machine-2', hostname: 'ec2-runner', os: 'linux' })],
    );

    const presenter = new RuntimeSessionPresenter({ apiClient });
    await presenter.loadSessions();
    const state = presenter.getState();

    expect(state.sessions).toHaveLength(2);
    expect(state.machines).toHaveLength(2);
    expect(state.lastUpdated).toEqual(new Date('2026-03-09T12:10:00.000Z'));
    expect(state.isLoading).toBe(false);
  });

  it('selects a session and loads handoff history', async () => {
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({ handoffs: [makeHandoff()], count: 1 }),
    );

    const presenter = new RuntimeSessionPresenter({ apiClient });
    const session = makeSession();

    await presenter.selectSession(session);
    const state = presenter.getState();

    expect(state.selectedSession).toEqual(session);
    expect(state.handoffs).toHaveLength(1);
    expect(state.isHandoffsLoading).toBe(false);
  });

  it('creates a managed session and refreshes the list', async () => {
    mocks.fetch
      .mockResolvedValueOnce(jsonResponse({ ok: true, session: makeSession({ id: 'ms-created' }) }))
      .mockResolvedValueOnce(jsonResponse({ sessions: [makeSession({ id: 'ms-created' })], count: 1 }))
      .mockResolvedValueOnce(jsonResponse([makeMachine(), makeMachine({ id: 'machine-2', hostname: 'ec2-runner', os: 'linux' })]));

    const presenter = new RuntimeSessionPresenter({ apiClient });
    const session = await presenter.createSession({
      runtime: 'claude-code',
      machineId: 'machine-2',
      projectPath: '/tmp/new-project',
      prompt: 'Start from latest handoff',
      model: 'claude-sonnet-4',
    });

    expect(session.id).toBe('ms-created');
    expect(presenter.getState().sessions.map((item) => item.id)).toEqual(['ms-created']);

    const [createUrl, createInit] = mocks.fetch.mock.calls[0] ?? [];
    expect(String(createUrl)).toBe('https://cp.example.com/api/runtime-sessions');
    expect(createInit?.method).toBe('POST');
    expect(JSON.parse(String(createInit?.body))).toEqual({
      runtime: 'claude-code',
      machineId: 'machine-2',
      projectPath: '/tmp/new-project',
      prompt: 'Start from latest handoff',
      model: 'claude-sonnet-4',
    });
  });

  it('resumes a session, refreshes sessions, and reloads handoffs for the returned session', async () => {
    mocks.fetch
      .mockResolvedValueOnce(jsonResponse({ ok: true, session: makeSession({ id: 'ms-1', status: 'active' }) }))
      .mockResolvedValueOnce(jsonResponse({ sessions: [makeSession({ id: 'ms-1', status: 'active' })], count: 1 }))
      .mockResolvedValueOnce(jsonResponse([makeMachine()]))
      .mockResolvedValueOnce(jsonResponse({ handoffs: [makeHandoff()], count: 1 }));

    const presenter = new RuntimeSessionPresenter({ apiClient });
    const session = await presenter.resumeSession({
      sessionId: 'ms-1',
      prompt: 'Continue from stop point',
      model: 'claude-sonnet-4',
    });

    expect(session.status).toBe('active');
    expect(presenter.getState().selectedSession?.id).toBe('ms-1');
    expect(presenter.getState().handoffs).toHaveLength(1);

    const [resumeUrl, resumeInit] = mocks.fetch.mock.calls[0] ?? [];
    expect(String(resumeUrl)).toBe('https://cp.example.com/api/runtime-sessions/ms-1/resume');
    expect(JSON.parse(String(resumeInit?.body))).toEqual({
      prompt: 'Continue from stop point',
      model: 'claude-sonnet-4',
    });
  });

  it('forks a session with optional machine target and selects the new session', async () => {
    mocks.fetch
      .mockResolvedValueOnce(jsonResponse({ ok: true, session: makeSession({ id: 'ms-forked', machineId: 'machine-2' }) }))
      .mockResolvedValueOnce(jsonResponse({ sessions: [makeSession({ id: 'ms-forked', machineId: 'machine-2' })], count: 1 }))
      .mockResolvedValueOnce(jsonResponse([makeMachine(), makeMachine({ id: 'machine-2', hostname: 'ec2-runner', os: 'linux' })]))
      .mockResolvedValueOnce(jsonResponse({ handoffs: [], count: 0 }));

    const presenter = new RuntimeSessionPresenter({ apiClient });
    const forkedSession = await presenter.forkSession({
      sessionId: 'ms-1',
      prompt: 'Fork for review',
      model: 'gpt-5-codex',
      targetMachineId: 'machine-2',
    });

    expect(forkedSession.id).toBe('ms-forked');
    expect(presenter.getState().selectedSession?.machineId).toBe('machine-2');

    const [forkUrl, forkInit] = mocks.fetch.mock.calls[0] ?? [];
    expect(String(forkUrl)).toBe('https://cp.example.com/api/runtime-sessions/ms-1/fork');
    expect(JSON.parse(String(forkInit?.body))).toEqual({
      prompt: 'Fork for review',
      model: 'gpt-5-codex',
      targetMachineId: 'machine-2',
    });
  });

  it('hands off a session and reloads the selected session handoff history', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          handoffId: 'handoff-created',
          strategy: 'snapshot-handoff',
          attemptedStrategies: ['snapshot-handoff'],
          snapshot: makeHandoff().snapshot,
          session: makeSession({ id: 'ms-2', runtime: 'claude-code', machineId: 'machine-2' }),
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ sessions: [makeSession({ id: 'ms-2', runtime: 'claude-code', machineId: 'machine-2' })], count: 1 }),
      )
      .mockResolvedValueOnce(jsonResponse([makeMachine(), makeMachine({ id: 'machine-2', hostname: 'ec2-runner', os: 'linux' })]))
      .mockResolvedValueOnce(jsonResponse({ handoffs: [makeHandoff({ targetSessionId: 'ms-2' })], count: 1 }));

    const presenter = new RuntimeSessionPresenter({ apiClient });
    const response = await presenter.handoffSession({
      sessionId: 'ms-1',
      targetRuntime: 'claude-code',
      prompt: 'Continue on Claude Code',
    });

    expect(response.strategy).toBe('snapshot-handoff');
    expect(presenter.getState().selectedSession?.runtime).toBe('claude-code');
    expect(presenter.getState().handoffs).toHaveLength(1);
  });

  it('wraps non-MobileClientError failures during load', async () => {
    mocks.fetch.mockRejectedValueOnce(new TypeError('boom'));

    const presenter = new RuntimeSessionPresenter({ apiClient });
    await presenter.loadSessions();

    expect(presenter.getState().error?.code).toBe('NETWORK_ERROR');
  });

  it('emits loading state changes through onChange', async () => {
    const loadingStates: boolean[] = [];
    queueSessionAndMachineLoad([], []);

    const presenter = new RuntimeSessionPresenter({
      apiClient,
      onChange: (state: RuntimeSessionScreenState) => {
        loadingStates.push(state.isLoading);
      },
    });

    await presenter.loadSessions();

    expect(loadingStates[0]).toBe(true);
    expect(loadingStates.at(-1)).toBe(false);
  });

  it('loads and exposes machines alongside runtime sessions', async () => {
    queueSessionAndMachineLoad([makeSession()], [makeMachine({ id: 'machine-9', hostname: 'laptop' })]);

    const presenter = new RuntimeSessionPresenter({ apiClient });
    await presenter.loadSessions();

    expect(presenter.getState().machines.map((machine) => machine.id)).toEqual(['machine-9']);
  });

  it('surfaces MobileClientError from handoff history loads', async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Missing session', code: 'NOT_FOUND' }), {
        status: 404,
        statusText: 'Not Found',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const presenter = new RuntimeSessionPresenter({ apiClient });
    await presenter.loadHandoffs('ms-missing');

    expect(presenter.getState().error).toBeInstanceOf(MobileClientError);
    expect(presenter.getState().error?.code).toBe('NOT_FOUND');
  });
});
