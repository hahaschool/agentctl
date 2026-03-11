import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RuntimeSessionPanel } from './RuntimeSessionPanel';

const {
  mockUseQuery,
  mockQueryClient,
  mockMachinesQuery,
  mockRuntimeSessionHandoffsQuery,
  mockRuntimeSessionManualTakeoverQuery,
  mockRuntimeSessionPreflightQuery,
  mockResumeMutateAsync,
  mockForkMutateAsync,
  mockHandoffMutateAsync,
  mockStartTakeoverMutateAsync,
  mockStopTakeoverMutateAsync,
  mockToast,
  mockQueryState,
} = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
  mockQueryClient: {
    invalidateQueries: vi.fn(),
  },
  mockMachinesQuery: vi.fn(),
  mockRuntimeSessionHandoffsQuery: vi.fn(),
  mockRuntimeSessionManualTakeoverQuery: vi.fn(),
  mockRuntimeSessionPreflightQuery: vi.fn(),
  mockResumeMutateAsync: vi.fn(),
  mockForkMutateAsync: vi.fn(),
  mockHandoffMutateAsync: vi.fn(),
  mockStartTakeoverMutateAsync: vi.fn(),
  mockStopTakeoverMutateAsync: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
  mockQueryState: {
    manualTakeover: null as Record<string, unknown> | null,
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

vi.mock('@/components/EmptyState', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      {description && <div>{description}</div>}
    </div>
  ),
}));

vi.mock('@/components/PathBadge', () => ({
  PathBadge: ({ path }: { path: string | null | undefined }) => <span>{path ?? '-'}</span>,
}));

vi.mock('@/components/StatusBadge', () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => mockToast,
}));

vi.mock('../lib/queries', () => ({
  machinesQuery: () => mockMachinesQuery(),
  runtimeSessionHandoffsQuery: (id: string, limit?: number) =>
    mockRuntimeSessionHandoffsQuery(id, limit),
  runtimeSessionManualTakeoverQuery: (id: string) => mockRuntimeSessionManualTakeoverQuery(id),
  runtimeSessionPreflightQuery: (id: string, params: Record<string, unknown>) =>
    mockRuntimeSessionPreflightQuery(id, params),
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
    mutateAsync: mockStartTakeoverMutateAsync,
    isPending: false,
  }),
  useStopRuntimeSessionManualTakeover: () => ({
    mutateAsync: mockStopTakeoverMutateAsync,
    isPending: false,
  }),
}));

function createRuntimeSession(overrides?: Record<string, unknown>) {
  return {
    id: 'ms-1',
    runtime: 'claude-code',
    nativeSessionId: 'claude-native-1',
    machineId: 'machine-1',
    agentId: 'agent-1',
    projectPath: '/workspace/app',
    worktreePath: null,
    status: 'active',
    configRevision: 7,
    handoffStrategy: null,
    handoffSourceSessionId: null,
    metadata: {
      activeMcpServers: ['github'],
    },
    startedAt: '2026-03-11T10:00:00.000Z',
    lastHeartbeat: '2026-03-11T10:05:00.000Z',
    endedAt: null,
    ...overrides,
  };
}

function createMachine(overrides?: Record<string, unknown>) {
  return {
    id: 'machine-1',
    hostname: 'mac-mini',
    tailscaleIp: '100.64.0.1',
    os: 'darwin',
    arch: 'arm64',
    status: 'online',
    lastHeartbeat: '2026-03-11T10:05:00.000Z',
    capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
    createdAt: '2026-03-11T09:00:00.000Z',
    ...overrides,
  };
}

function createManualTakeover(overrides?: Record<string, unknown>) {
  return {
    workerSessionId: 'worker-1',
    nativeSessionId: 'claude-native-1',
    projectPath: '/workspace/app',
    status: 'online',
    permissionMode: 'plan',
    sessionUrl: 'https://claude.ai/code/session-123',
    startedAt: '2026-03-11T10:01:00.000Z',
    lastHeartbeat: '2026-03-11T10:06:00.000Z',
    lastVerifiedAt: '2026-03-11T10:06:30.000Z',
    error: null,
    ...overrides,
  };
}

function setupUseQuery() {
  mockMachinesQuery.mockReturnValue({ queryKey: ['machines'] });
  mockRuntimeSessionHandoffsQuery.mockImplementation((id: string, limit?: number) => ({
    queryKey: ['runtime-sessions', id, 'handoffs', limit],
  }));
  mockRuntimeSessionManualTakeoverQuery.mockImplementation((id: string) => ({
    queryKey: ['runtime-sessions', id, 'manual-takeover'],
  }));
  mockRuntimeSessionPreflightQuery.mockImplementation((id: string, params: Record<string, unknown>) => ({
    queryKey: ['runtime-sessions', id, 'preflight', params.targetRuntime],
  }));

  mockResumeMutateAsync.mockResolvedValue({ ok: true, session: createRuntimeSession() });
  mockForkMutateAsync.mockResolvedValue({ ok: true, session: createRuntimeSession({ id: 'ms-2' }) });
  mockHandoffMutateAsync.mockResolvedValue({
    ok: true,
    handoffId: 'handoff-1',
    strategy: 'snapshot-handoff',
    attemptedStrategies: ['snapshot-handoff'],
    nativeImportAttempt: undefined,
    snapshot: {
      sourceRuntime: 'claude-code',
      sourceSessionId: 'ms-1',
      sourceNativeSessionId: 'claude-native-1',
      projectPath: '/workspace/app',
      worktreePath: null,
      branch: null,
      headSha: null,
      dirtyFiles: [],
      diffSummary: 'Takeover ready',
      conversationSummary: 'Continue in Claude',
      openTodos: [],
      nextSuggestedPrompt: 'Continue',
      activeConfigRevision: 7,
      activeMcpServers: [],
      activeSkills: [],
      reason: 'manual',
    },
    session: createRuntimeSession({ id: 'ms-2' }),
  });
  mockStartTakeoverMutateAsync.mockResolvedValue({
    ok: true,
    manualTakeover: createManualTakeover(),
  });
  mockStopTakeoverMutateAsync.mockResolvedValue({
    ok: true,
    manualTakeover: createManualTakeover({ status: 'stopped', sessionUrl: null }),
  });

  mockUseQuery.mockImplementation((options: { queryKey: readonly unknown[] }) => {
    const key = options.queryKey;
    if (key[0] === 'machines') {
      return { data: [createMachine()], isLoading: false, isFetching: false, error: null };
    }
    if (key[0] === 'runtime-sessions' && key[2] === 'handoffs') {
      return { data: { handoffs: [] }, isLoading: false, isFetching: false, error: null };
    }
    if (key[0] === 'runtime-sessions' && key[2] === 'manual-takeover') {
      return {
        data: { ok: true, manualTakeover: mockQueryState.manualTakeover },
        isLoading: false,
        isFetching: false,
        error: null,
      };
    }
    if (key[0] === 'runtime-sessions' && key[2] === 'preflight') {
      return {
        data: {
          nativeImportCapable: true,
          attempt: {
            ok: true,
            reason: null,
            metadata: {},
          },
        },
        isLoading: false,
        isFetching: false,
        error: null,
      };
    }

    return { data: undefined, isLoading: false, isFetching: false, error: null };
  });
}

describe('RuntimeSessionPanel', () => {
  beforeEach(() => {
    mockQueryState.manualTakeover = null;
    vi.clearAllMocks();
    setupUseQuery();
    Object.defineProperty(window, 'open', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the manual takeover section only for Claude runtime sessions', () => {
    const { rerender } = render(
      <RuntimeSessionPanel selectedSession={createRuntimeSession()} onSelectedSessionChange={vi.fn()} />,
    );

    expect(screen.getByText('Manual Takeover')).toBeDefined();
    expect(screen.getByLabelText('Takeover permission mode')).toBeDefined();

    rerender(
      <RuntimeSessionPanel
        selectedSession={createRuntimeSession({ runtime: 'codex' })}
        onSelectedSessionChange={vi.fn()}
      />,
    );

    expect(screen.queryByText('Manual Takeover')).toBeNull();
  });

  it('starts manual takeover and then shows Open, Copy URL, and Revoke controls', async () => {
    const view = render(
      <RuntimeSessionPanel selectedSession={createRuntimeSession()} onSelectedSessionChange={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText('Takeover permission mode'), {
      target: { value: 'plan' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start Manual Takeover' }));

    await waitFor(() => {
      expect(mockStartTakeoverMutateAsync).toHaveBeenCalledWith({
        id: 'ms-1',
        permissionMode: 'plan',
      });
    });

    mockQueryState.manualTakeover = createManualTakeover();
    view.rerender(
      <RuntimeSessionPanel selectedSession={createRuntimeSession()} onSelectedSessionChange={vi.fn()} />,
    );

    expect(screen.getByRole('button', { name: 'Open' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Copy URL' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(window.open).toHaveBeenCalledWith(
      'https://claude.ai/code/session-123',
      '_blank',
      'noopener,noreferrer',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy URL' }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'https://claude.ai/code/session-123',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => {
      expect(mockStopTakeoverMutateAsync).toHaveBeenCalledWith({ id: 'ms-1' });
    });
  });

  it('keeps the existing handoff UI visible alongside manual takeover controls', () => {
    render(
      <RuntimeSessionPanel selectedSession={createRuntimeSession()} onSelectedSessionChange={vi.fn()} />,
    );

    expect(screen.getByText('Manual Handoff')).toBeDefined();
    expect(screen.getByLabelText('Takeover prompt')).toBeDefined();
    expect(screen.getByText('Handoff History')).toBeDefined();
  });
});
