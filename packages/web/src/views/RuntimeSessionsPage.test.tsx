import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RuntimeSessionsPage } from './RuntimeSessionsPage';

const {
  mockUseQuery,
  mockRuntimeSessionsQuery,
  mockRuntimeSessionHandoffsQuery,
  mockRuntimeSessionPreflightQuery,
  mockMachinesQuery,
  mockQueryClient,
  mockCreateMutateAsync,
  mockResumeMutateAsync,
  mockForkMutateAsync,
  mockHandoffMutateAsync,
  mockToast,
} = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
  mockRuntimeSessionsQuery: vi.fn(),
  mockRuntimeSessionHandoffsQuery: vi.fn(),
  mockRuntimeSessionPreflightQuery: vi.fn(),
  mockMachinesQuery: vi.fn(),
  mockQueryClient: {
    invalidateQueries: vi.fn(),
  },
  mockCreateMutateAsync: vi.fn(),
  mockResumeMutateAsync: vi.fn(),
  mockForkMutateAsync: vi.fn(),
  mockHandoffMutateAsync: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (options: unknown) => mockUseQuery(options),
    useQueryClient: () => mockQueryClient,
  };
});

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href} data-testid={`link-${href}`}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/EmptyState', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      {description && <div>{description}</div>}
    </div>
  ),
}));

vi.mock('@/components/ErrorBanner', () => ({
  ErrorBanner: ({ message }: { message: string }) => (
    <div data-testid="error-banner">{message}</div>
  ),
}));

vi.mock('@/components/FetchingBar', () => ({
  FetchingBar: ({ isFetching }: { isFetching: boolean }) => (
    <div data-testid="fetching-bar">{isFetching ? 'fetching' : 'idle'}</div>
  ),
}));

vi.mock('@/components/LastUpdated', () => ({
  LastUpdated: ({ dataUpdatedAt }: { dataUpdatedAt: number }) => (
    <div data-testid="last-updated">{dataUpdatedAt}</div>
  ),
}));

vi.mock('@/components/PathBadge', () => ({
  PathBadge: ({ path }: { path: string | null | undefined }) => <span>{path ?? '-'}</span>,
}));

vi.mock('@/components/RefreshButton', () => ({
  RefreshButton: ({ onClick }: { onClick: () => void }) => (
    <button type="button" data-testid="refresh-button" onClick={onClick}>
      Refresh
    </button>
  ),
}));

vi.mock('@/components/StatusBadge', () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => mockToast,
}));

vi.mock('@/lib/queries', () => ({
  runtimeSessionsQuery: (params?: Record<string, unknown>) => mockRuntimeSessionsQuery(params),
  runtimeSessionHandoffsQuery: (id: string, limit?: number) =>
    mockRuntimeSessionHandoffsQuery(id, limit),
  runtimeSessionPreflightQuery: (id: string, params: Record<string, unknown>) =>
    mockRuntimeSessionPreflightQuery(id, params),
  runtimeSessionManualTakeoverQuery: (id: string) => mockRuntimeSessionHandoffsQuery(id),
  machinesQuery: () => mockMachinesQuery(),
  useCreateRuntimeSession: () => ({
    mutateAsync: mockCreateMutateAsync,
    isPending: false,
  }),
  useResumeRuntimeSession: () => ({
    mutateAsync: mockResumeMutateAsync,
    isPending: false,
  }),
  useForkRuntimeSession: () => ({
    mutateAsync: mockForkMutateAsync,
    isPending: false,
  }),
  useHandoffRuntimeSession: () => ({
    mutateAsync: mockHandoffMutateAsync,
    isPending: false,
  }),
  useStartRuntimeSessionManualTakeover: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useStopRuntimeSessionManualTakeover: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

function createRuntimeSession(overrides?: Record<string, unknown>) {
  return {
    id: 'ms-1',
    runtime: 'codex',
    nativeSessionId: 'native-1',
    machineId: 'machine-1',
    agentId: 'agent-1',
    projectPath: '/tmp/project-a',
    worktreePath: '/tmp/project-a/.trees/runtime',
    status: 'active',
    configRevision: 3,
    handoffStrategy: null,
    handoffSourceSessionId: null,
    metadata: { model: 'gpt-5-codex', activeMcpServers: ['github'] },
    startedAt: '2026-03-09T08:00:00.000Z',
    lastHeartbeat: '2026-03-09T08:05:00.000Z',
    endedAt: null,
    ...overrides,
  };
}

function createHandoff(overrides?: Record<string, unknown>) {
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
      sourceNativeSessionId: 'codex-native-1',
      projectPath: '/tmp/project-a',
      worktreePath: '/tmp/project-a/.trees/runtime',
      branch: 'feature/runtime',
      headSha: 'abc123',
      dirtyFiles: ['packages/shared/src/types/runtime-management.ts'],
      diffSummary: 'Added runtime handoff support.',
      conversationSummary: 'Continue implementing runtime switching.',
      openTodos: ['Wire web UI'],
      nextSuggestedPrompt: 'Continue with UI integration.',
      activeConfigRevision: 3,
      activeMcpServers: ['github'],
      activeSkills: ['brainstorming'],
      reason: 'manual',
    },
    nativeImportAttempt: undefined,
    errorMessage: null,
    createdAt: '2026-03-09T08:06:00.000Z',
    completedAt: '2026-03-09T08:06:30.000Z',
    ...overrides,
  };
}

function createMachine(overrides?: Record<string, unknown>) {
  return {
    id: 'machine-1',
    hostname: 'mac-mini',
    tailscaleIp: '100.0.0.1',
    os: 'darwin',
    arch: 'arm64',
    status: 'online',
    lastHeartbeat: '2026-03-09T08:05:00.000Z',
    capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
    createdAt: '2026-03-09T07:00:00.000Z',
    ...overrides,
  };
}

function setupUseQuery(options?: {
  sessions?: ReturnType<typeof createRuntimeSession>[];
  handoffsBySessionId?: Record<string, ReturnType<typeof createHandoff>[]>;
  machines?: ReturnType<typeof createMachine>[];
  preflight?: {
    nativeImportCapable: boolean;
    attempt: {
      ok: boolean;
      sourceRuntime: string;
      targetRuntime: string;
      reason: string;
      metadata?: Record<string, unknown>;
    };
  };
}) {
  const sessions = options?.sessions ?? [createRuntimeSession()];
  const handoffsBySessionId = options?.handoffsBySessionId ?? { 'ms-1': [createHandoff()] };
  const machines = options?.machines ?? [createMachine()];
  const preflight =
    options?.preflight ??
    ({
      nativeImportCapable: true,
      attempt: {
        ok: false,
        sourceRuntime: 'codex',
        targetRuntime: 'claude-code',
        reason: 'not_implemented',
        metadata: {
          targetCli: 'claude',
          sourceStorage: '/Users/example/.codex/sessions',
        },
      },
    } as const);

  mockRuntimeSessionsQuery.mockReturnValue({ queryKey: ['runtime-sessions'] });
  mockMachinesQuery.mockReturnValue({ queryKey: ['machines'] });
  mockRuntimeSessionHandoffsQuery.mockImplementation((id: string, limit?: number) => ({
    queryKey: ['runtime-sessions', id, 'handoffs', limit],
  }));
  mockRuntimeSessionPreflightQuery.mockImplementation(
    (id: string, params: Record<string, unknown>) => ({
      queryKey: ['runtime-sessions', id, 'preflight', params.targetRuntime],
    }),
  );
  mockCreateMutateAsync.mockResolvedValue({
    ok: true,
    session: createRuntimeSession({ id: 'ms-created', runtime: 'codex' }),
  });
  mockResumeMutateAsync.mockResolvedValue({
    ok: true,
    session: createRuntimeSession({ id: 'ms-1', status: 'active' }),
  });
  mockForkMutateAsync.mockResolvedValue({
    ok: true,
    session: createRuntimeSession({ id: 'ms-forked', runtime: 'codex', machineId: 'machine-2' }),
  });
  mockHandoffMutateAsync.mockResolvedValue({
    ok: true,
    handoffId: 'handoff-created',
    strategy: 'snapshot-handoff',
    attemptedStrategies: ['snapshot-handoff'],
    snapshot: {},
    session: createRuntimeSession({ id: 'ms-2', runtime: 'claude-code' }),
  });

  mockUseQuery.mockImplementation((optionsArg: { queryKey: unknown[] }) => {
    const queryKey = optionsArg.queryKey;
    if (queryKey[0] === 'runtime-sessions' && queryKey.length === 1) {
      return {
        data: { sessions, count: sessions.length },
        isLoading: false,
        isFetching: false,
        error: null,
        refetch: vi.fn(),
        dataUpdatedAt: 100,
      };
    }

    if (queryKey[0] === 'machines') {
      return {
        data: machines,
        isLoading: false,
        isFetching: false,
        error: null,
        refetch: vi.fn(),
        dataUpdatedAt: 200,
      };
    }

    if (queryKey[0] === 'runtime-sessions' && queryKey[2] === 'handoffs') {
      const id = String(queryKey[1] ?? '');
      return {
        data: id
          ? {
              handoffs: handoffsBySessionId[id] ?? [],
              count: (handoffsBySessionId[id] ?? []).length,
            }
          : undefined,
        isLoading: false,
        isFetching: false,
        error: null,
        refetch: vi.fn(),
        dataUpdatedAt: 300,
      };
    }

    if (queryKey[0] === 'runtime-sessions' && queryKey[2] === 'preflight') {
      return {
        data: preflight,
        isLoading: false,
        isFetching: false,
        error: null,
        refetch: vi.fn(),
        dataUpdatedAt: 400,
      };
    }

    throw new Error(`Unhandled query key ${JSON.stringify(queryKey)}`);
  });
}

describe('RuntimeSessionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders managed runtime sessions and shows selected session detail', async () => {
    setupUseQuery();

    render(<RuntimeSessionsPage />);

    expect(screen.getByText('Runtime Sessions')).toBeDefined();
    expect(
      screen.getByText(
        'Unified managed session view for Claude Code and Codex, with cross-runtime handoff history.',
      ),
    ).toBeDefined();

    await waitFor(() => {
      expect(screen.getAllByText('ms-1').length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText('mac-mini').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('Snapshot Handoff')).toBeDefined();
      expect(screen.getByText('Completed via snapshot handoff')).toBeDefined();
      expect(screen.getByText('Added runtime handoff support.')).toBeDefined();
    });
  });

  it('renders native import fallback details in handoff history', async () => {
    setupUseQuery({
      preflight: {
        nativeImportCapable: false,
        attempt: {
          ok: false,
          sourceRuntime: 'codex',
          targetRuntime: 'claude-code',
          reason: 'source_session_missing',
          metadata: {},
        },
      },
      handoffsBySessionId: {
        'ms-1': [
          createHandoff({
            nativeImportAttempt: {
              ok: false,
              sourceRuntime: 'codex',
              targetRuntime: 'claude-code',
              reason: 'target_cli_unavailable',
              metadata: {
                targetCli: 'claude',
                sourceStorage: '/Users/example/.codex/sessions',
                sourceSessionSummary: {
                  lastActivity: '2026-03-10T00:05:02.000Z',
                  messageCounts: { user: 1, assistant: 1, developer: 0 },
                },
              },
            },
          }),
        ],
      },
    });

    render(<RuntimeSessionsPage />);

    await waitFor(() => {
      expect(screen.getAllByText(/Native import unavailable:/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/target CLI claude/).length).toBeGreaterThan(0);
      expect(screen.getByText(/1 user \/ 1 assistant messages/)).toBeDefined();
      expect(screen.getAllByText('Native Import').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('Fallbacks')).toBeDefined();
    });
  });

  it('filters handoff history down to fallback executions', async () => {
    setupUseQuery({
      handoffsBySessionId: {
        'ms-1': [
          createHandoff({
            id: 'handoff-native',
            reason: 'native-success',
            strategy: 'native-import',
            nativeImportAttempt: {
              ok: true,
              sourceRuntime: 'codex',
              targetRuntime: 'claude-code',
              reason: 'succeeded',
              metadata: {},
            },
          }),
          createHandoff({
            id: 'handoff-fallback',
            reason: 'fallback-success',
            strategy: 'snapshot-handoff',
            nativeImportAttempt: {
              ok: false,
              sourceRuntime: 'codex',
              targetRuntime: 'claude-code',
              reason: 'source_session_missing',
              metadata: {},
            },
          }),
          createHandoff({
            id: 'handoff-failed',
            reason: 'failed-run',
            status: 'failed',
            strategy: 'snapshot-handoff',
            errorMessage: 'worker unavailable',
          }),
        ],
      },
    });

    render(<RuntimeSessionsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Fallback' }));

    await waitFor(() => {
      expect(screen.getByText('fallback-success')).toBeDefined();
      expect(screen.queryByText('native-success')).toBeNull();
      expect(screen.queryByText('failed-run')).toBeNull();
      expect(screen.queryByText('No handoffs match this filter')).toBeNull();
    });
  });

  it('filters handoff history down to failed executions', async () => {
    setupUseQuery({
      handoffsBySessionId: {
        'ms-1': [
          createHandoff({
            id: 'handoff-native',
            reason: 'native-success',
            strategy: 'native-import',
            nativeImportAttempt: {
              ok: true,
              sourceRuntime: 'codex',
              targetRuntime: 'claude-code',
              reason: 'succeeded',
              metadata: {},
            },
          }),
          createHandoff({
            id: 'handoff-fallback',
            reason: 'fallback-success',
            strategy: 'snapshot-handoff',
            nativeImportAttempt: {
              ok: false,
              sourceRuntime: 'codex',
              targetRuntime: 'claude-code',
              reason: 'source_session_missing',
              metadata: {},
            },
          }),
          createHandoff({
            id: 'handoff-failed',
            reason: 'failed-run',
            status: 'failed',
            strategy: 'snapshot-handoff',
            errorMessage: 'worker unavailable',
          }),
        ],
      },
    });

    render(<RuntimeSessionsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Failed' }));

    await waitFor(() => {
      expect(screen.getByText('failed-run')).toBeDefined();
      expect(screen.getByText('worker unavailable')).toBeDefined();
      expect(screen.queryByText('native-success')).toBeNull();
      expect(screen.queryByText('fallback-success')).toBeNull();
      expect(screen.queryByText('No handoffs match this filter')).toBeNull();
    });

    const totalCard = screen.getByText('Total').parentElement;
    const succeededCard = screen.getByText('Succeeded').parentElement;
    const nativeImportCard = screen.getAllByText('Native Import')[1]?.parentElement ?? null;
    const fallbackCard = screen.getByText('Fallbacks').parentElement;

    expect(totalCard).not.toBeNull();
    expect(succeededCard).not.toBeNull();
    expect(nativeImportCard).not.toBeNull();
    expect(fallbackCard).not.toBeNull();

    expect(within(totalCard as HTMLElement).getByText('1')).toBeDefined();
    expect(within(succeededCard as HTMLElement).getByText('0')).toBeDefined();
    expect(within(nativeImportCard as HTMLElement).getByText('0')).toBeDefined();
    expect(within(fallbackCard as HTMLElement).getByText('0')).toBeDefined();
  });

  it('renders native import preflight readiness before starting a handoff', async () => {
    setupUseQuery({
      machines: [createMachine(), createMachine({ id: 'machine-2', hostname: 'ec2-runner' })],
    });

    render(<RuntimeSessionsPage />);

    fireEvent.change(screen.getByLabelText('Handoff target machine'), {
      target: { value: 'machine-2' },
    });

    await waitFor(() => {
      expect(screen.getAllByText(/Native import ready/).length).toBeGreaterThanOrEqual(2);
      expect(screen.getByRole('button', { name: 'Start Native Import' })).toBeDefined();
      expect(mockRuntimeSessionPreflightQuery).toHaveBeenLastCalledWith('ms-1', {
        targetRuntime: 'claude-code',
        targetMachineId: 'machine-2',
      });
    });
  });

  it('surfaces snapshot fallback mode before a handoff starts', async () => {
    setupUseQuery({
      preflight: {
        nativeImportCapable: false,
        attempt: {
          ok: false,
          sourceRuntime: 'codex',
          targetRuntime: 'claude-code',
          reason: 'source_session_missing',
          metadata: {
            sourceStorage: '/Users/example/.codex/sessions',
          },
        },
      },
    });

    render(<RuntimeSessionsPage />);

    await waitFor(() => {
      expect(screen.getByText('Snapshot fallback')).toBeDefined();
      expect(screen.getByRole('button', { name: 'Start Snapshot Handoff' })).toBeDefined();
    });
  });

  it('prefers selectable machines and disables offline targets in selectors', async () => {
    setupUseQuery({
      machines: [
        createMachine({ id: 'machine-offline', hostname: 'backup-box', status: 'offline' }),
        createMachine({ id: 'machine-2', hostname: 'ec2-runner', status: 'online' }),
      ],
    });

    render(<RuntimeSessionsPage />);

    await waitFor(() => {
      expect((screen.getByLabelText('Create machine') as HTMLSelectElement).value).toBe(
        'machine-2',
      );
    });

    const [createOfflineOption, forkOfflineOption, handoffOfflineOption] = screen.getAllByRole(
      'option',
      {
        name: 'backup-box (offline)',
      },
    ) as HTMLOptionElement[];

    expect(createOfflineOption.disabled).toBe(true);
    expect(forkOfflineOption.disabled).toBe(true);
    expect(handoffOfflineOption.disabled).toBe(true);
  });

  it('filters runtime sessions by runtime and search query', async () => {
    setupUseQuery({
      sessions: [
        createRuntimeSession({
          id: 'ms-codex',
          runtime: 'codex',
          projectPath: '/tmp/codex-project',
        }),
        createRuntimeSession({
          id: 'ms-claude',
          runtime: 'claude-code',
          machineId: 'machine-2',
          projectPath: '/tmp/claude-project',
          nativeSessionId: 'claude-native',
        }),
      ],
      machines: [createMachine(), createMachine({ id: 'machine-2', hostname: 'ec2-runner' })],
      handoffsBySessionId: { 'ms-codex': [] },
    });

    render(<RuntimeSessionsPage />);

    fireEvent.change(screen.getByLabelText('Filter by runtime'), {
      target: { value: 'claude-code' },
    });

    await waitFor(() => {
      expect(screen.getAllByText('ms-claude').length).toBeGreaterThanOrEqual(2);
      expect(screen.queryAllByText('ms-codex')).toHaveLength(0);
    });

    fireEvent.change(screen.getByLabelText('Search runtime sessions'), {
      target: { value: 'ec2-runner' },
    });

    await waitFor(() => {
      expect(screen.getAllByText('ms-claude').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows empty state when no runtime sessions exist', async () => {
    setupUseQuery({ sessions: [], handoffsBySessionId: {}, machines: [createMachine()] });

    render(<RuntimeSessionsPage />);

    await waitFor(() => {
      expect(screen.getByText('No runtime sessions match the filters')).toBeDefined();
    });
  });

  it('starts a manual handoff with the selected target runtime', async () => {
    setupUseQuery({
      machines: [createMachine(), createMachine({ id: 'machine-2', hostname: 'ec2-runner' })],
    });

    render(<RuntimeSessionsPage />);

    fireEvent.change(screen.getByLabelText('Handoff target machine'), {
      target: { value: 'machine-2' },
    });
    const promptInput = await screen.findByLabelText('Takeover prompt');
    fireEvent.change(promptInput, { target: { value: 'Continue from the existing diff' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start Native Import' }));

    await waitFor(() => {
      expect(mockHandoffMutateAsync).toHaveBeenCalledWith({
        id: 'ms-1',
        targetRuntime: 'claude-code',
        reason: 'manual',
        targetMachineId: 'machine-2',
        prompt: 'Continue from the existing diff',
      });
      expect(mockToast.success).toHaveBeenCalledWith(
        'Handed off to Claude Code via snapshot handoff',
      );
    });
  });

  it('creates a managed runtime session from the create form', async () => {
    setupUseQuery({
      machines: [createMachine(), createMachine({ id: 'machine-2', hostname: 'ec2-runner' })],
    });

    render(<RuntimeSessionsPage />);

    fireEvent.change(screen.getByLabelText('Create runtime'), {
      target: { value: 'claude-code' },
    });
    fireEvent.change(screen.getByLabelText('Create machine'), {
      target: { value: 'machine-2' },
    });
    fireEvent.change(screen.getByLabelText('Create project path'), {
      target: { value: '/tmp/new-runtime-project' },
    });
    fireEvent.change(screen.getByLabelText('Create prompt'), {
      target: { value: 'Bootstrap the handoff context' },
    });
    fireEvent.change(screen.getByLabelText('Create model'), {
      target: { value: 'claude-sonnet-4' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Managed Session' }));

    await waitFor(() => {
      expect(mockCreateMutateAsync).toHaveBeenCalledWith({
        runtime: 'claude-code',
        machineId: 'machine-2',
        projectPath: '/tmp/new-runtime-project',
        prompt: 'Bootstrap the handoff context',
        model: 'claude-sonnet-4',
      });
    });
  });

  it('resumes a resumable runtime session with prompt and model', async () => {
    setupUseQuery({
      sessions: [createRuntimeSession({ status: 'paused', runtime: 'claude-code' })],
    });

    render(<RuntimeSessionsPage />);

    fireEvent.change(screen.getByLabelText('Resume prompt'), {
      target: { value: 'Continue from the previous stop point' },
    });
    fireEvent.change(screen.getByLabelText('Resume model'), {
      target: { value: 'claude-sonnet-4' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Resume Session' }));

    await waitFor(() => {
      expect(mockResumeMutateAsync).toHaveBeenCalledWith({
        id: 'ms-1',
        prompt: 'Continue from the previous stop point',
        model: 'claude-sonnet-4',
      });
    });
  });

  it('forks the selected runtime session onto another machine', async () => {
    setupUseQuery({
      machines: [createMachine(), createMachine({ id: 'machine-2', hostname: 'ec2-runner' })],
    });

    render(<RuntimeSessionsPage />);

    fireEvent.change(screen.getByLabelText('Fork prompt'), {
      target: { value: 'Fork for verification' },
    });
    fireEvent.change(screen.getByLabelText('Fork model'), {
      target: { value: 'gpt-5-codex' },
    });
    fireEvent.change(screen.getByLabelText('Fork target machine'), {
      target: { value: 'machine-2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fork Session' }));

    await waitFor(() => {
      expect(mockForkMutateAsync).toHaveBeenCalledWith({
        id: 'ms-1',
        prompt: 'Fork for verification',
        model: 'gpt-5-codex',
        targetMachineId: 'machine-2',
      });
    });
  });
});
