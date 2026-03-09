import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RuntimeSessionsPage } from './RuntimeSessionsPage';

const { mockUseQuery, mockRuntimeSessionsQuery, mockRuntimeSessionHandoffsQuery, mockMachinesQuery } =
  vi.hoisted(() => ({
    mockUseQuery: vi.fn(),
    mockRuntimeSessionsQuery: vi.fn(),
    mockRuntimeSessionHandoffsQuery: vi.fn(),
    mockMachinesQuery: vi.fn(),
  }));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (options: unknown) => mockUseQuery(options),
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
  ErrorBanner: ({ message }: { message: string }) => <div data-testid="error-banner">{message}</div>,
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

vi.mock('@/lib/queries', () => ({
  runtimeSessionsQuery: (params?: Record<string, unknown>) => mockRuntimeSessionsQuery(params),
  runtimeSessionHandoffsQuery: (id: string, limit?: number) => mockRuntimeSessionHandoffsQuery(id, limit),
  machinesQuery: () => mockMachinesQuery(),
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
}) {
  const sessions = options?.sessions ?? [createRuntimeSession()];
  const handoffsBySessionId = options?.handoffsBySessionId ?? { 'ms-1': [createHandoff()] };
  const machines = options?.machines ?? [createMachine()];

  mockRuntimeSessionsQuery.mockReturnValue({ queryKey: ['runtime-sessions'] });
  mockMachinesQuery.mockReturnValue({ queryKey: ['machines'] });
  mockRuntimeSessionHandoffsQuery.mockImplementation((id: string, limit?: number) => ({
    queryKey: ['runtime-sessions', id, 'handoffs', limit],
  }));

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
        data: id ? { handoffs: handoffsBySessionId[id] ?? [], count: (handoffsBySessionId[id] ?? []).length } : undefined,
        isLoading: false,
        isFetching: false,
        error: null,
        refetch: vi.fn(),
        dataUpdatedAt: 300,
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
    expect(screen.getByText('Unified managed session view for Claude Code and Codex, with cross-runtime handoff history.')).toBeDefined();

    await waitFor(() => {
      expect(screen.getAllByText('ms-1').length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText('mac-mini').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('snapshot-handoff')).toBeDefined();
      expect(screen.getByText('Added runtime handoff support.')).toBeDefined();
    });
  });

  it('filters runtime sessions by runtime and search query', async () => {
    setupUseQuery({
      sessions: [
        createRuntimeSession({ id: 'ms-codex', runtime: 'codex', projectPath: '/tmp/codex-project' }),
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
});
