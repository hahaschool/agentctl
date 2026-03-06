import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared BEFORE importing the component under test
// ---------------------------------------------------------------------------

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
};

vi.mock('@/components/Toast', () => ({
  useToast: () => mockToast,
  ToastContainer: () => null,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/components/Breadcrumb', () => ({
  Breadcrumb: ({ items }: { items: { label: string; href?: string }[] }) => (
    <nav data-testid="breadcrumb">
      {items.map((item) => (
        <span key={item.label}>{item.label}</span>
      ))}
    </nav>
  ),
}));

vi.mock('@/components/CopyableText', () => ({
  CopyableText: ({ value, maxDisplay }: { value: string; maxDisplay?: number }) => (
    <span data-testid="copyable-text">{maxDisplay ? value.slice(0, maxDisplay) : value}</span>
  ),
}));

vi.mock('@/components/StatusBadge', () => ({
  StatusBadge: ({ status }: { status: string }) => <span data-testid="status-badge">{status}</span>,
}));

vi.mock('./ConfirmButton', () => ({
  ConfirmButton: ({
    label,
    onConfirm,
  }: {
    label: string;
    confirmLabel?: string;
    onConfirm: () => void;
  }) => (
    <button type="button" data-testid="confirm-button" onClick={onConfirm}>
      {label}
    </button>
  ),
}));

vi.mock('./GitStatusBadge', () => ({
  GitStatusBadge: ({ machineId, projectPath }: { machineId: string; projectPath: string }) => (
    <div data-testid="git-status-badge">
      {machineId}:{projectPath}
    </div>
  ),
}));

vi.mock('./LastUpdated', () => ({
  LastUpdated: ({ dataUpdatedAt }: { dataUpdatedAt: number }) => (
    <span data-testid="last-updated">{dataUpdatedAt}</span>
  ),
}));

vi.mock('./LiveDuration', () => ({
  LiveDuration: ({ startedAt, endedAt }: { startedAt: string; endedAt?: string }) => (
    <span data-testid="live-duration">
      {startedAt}-{endedAt ?? 'now'}
    </span>
  ),
}));

vi.mock('./LiveTimeAgo', () => ({
  LiveTimeAgo: ({ date }: { date: string }) => <span data-testid="live-time-ago">{date}</span>,
}));

vi.mock('./PathBadge', () => ({
  PathBadge: ({ path }: { path: string }) => <span data-testid="path-badge">{path}</span>,
}));

vi.mock('./RefreshButton', () => ({
  RefreshButton: ({ onClick, isFetching }: { onClick: () => void; isFetching: boolean }) => (
    <button type="button" data-testid="refresh-button" onClick={onClick} aria-busy={isFetching}>
      Refresh
    </button>
  ),
}));

// Mock react-query hooks
const mockMutate = vi.fn();
const mockDeleteSession = {
  mutate: mockMutate,
  isPending: false,
};
const mockForkMutate = vi.fn();
const mockForkSession = {
  mutate: mockForkMutate,
  isPending: false,
};

vi.mock('../lib/queries', () => ({
  accountsQuery: () => ({
    queryKey: ['accounts'],
    queryFn: vi.fn(),
  }),
  queryKeys: {
    session: (id: string) => ['sessions', id],
    sessions: () => ['sessions'],
  },
  useDeleteSession: () => mockDeleteSession,
  useForkSession: () => mockForkSession,
}));

const mockRouterPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const mockUseQueryClient = {
  invalidateQueries: vi.fn(),
};

const mockAccountsData: { id: string; name: string }[] = [];

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: mockAccountsData.length > 0 ? mockAccountsData : undefined,
    isLoading: false,
  }),
  useQueryClient: () => mockUseQueryClient,
}));

vi.mock('../hooks/use-hotkeys', () => ({
  useHotkeys: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Component import (AFTER mocks)
// ---------------------------------------------------------------------------

import type { Session, SessionContentMessage } from '../lib/api';
import { SessionHeader, type SessionHeaderProps } from './SessionHeader';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1234567890abcdef1234567890abcdef',
    agentId: 'agent-1',
    agentName: 'test-agent',
    machineId: 'machine-1',
    sessionUrl: null,
    claudeSessionId: 'claude-sess-abc123def456',
    status: 'active',
    projectPath: '/home/user/project',
    pid: 42,
    startedAt: '2026-03-06T00:00:00Z',
    lastHeartbeat: '2026-03-06T01:00:00Z',
    endedAt: null,
    metadata: {},
    accountId: null,
    model: 'claude-sonnet-4-6',
    ...overrides,
  };
}

function makeMessages(count = 3): SessionContentMessage[] {
  const types = ['human', 'assistant', 'tool_use', 'thinking'];
  return Array.from({ length: count }, (_, i) => ({
    type: types[i % types.length] ?? 'human',
    content: `Message content ${i + 1}`,
    timestamp: `2026-03-06T00:0${i}:00Z`,
    toolName: types[i % types.length] === 'tool_use' ? 'Read' : undefined,
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderHeader(overrides: Partial<SessionHeaderProps> = {}) {
  const defaultProps: SessionHeaderProps = {
    session: makeSession(),
    messages: makeMessages(),
    dataUpdatedAt: Date.now(),
    isFetching: false,
    onRefresh: vi.fn(),
    ...overrides,
  };
  const result = render(<SessionHeader {...defaultProps} />);
  return { ...result, props: defaultProps };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockMutate.mockReset();
  mockForkMutate.mockReset();
  mockRouterPush.mockReset();
  mockToast.success.mockReset();
  mockToast.error.mockReset();
  mockUseQueryClient.invalidateQueries.mockReset();
  mockAccountsData.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Tests
// ===========================================================================

describe('SessionHeader', () => {
  // -----------------------------------------------------------------------
  // 1. Session info display
  // -----------------------------------------------------------------------

  describe('session info display', () => {
    it('renders the session id in breadcrumb (truncated to 12 chars)', () => {
      renderHeader();
      expect(screen.getByTestId('breadcrumb')).toBeDefined();
      expect(screen.getByText('Sessions')).toBeDefined();
      // Breadcrumb and CopyableText both show the truncated id
      const matches = screen.getAllByText('sess-1234567');
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it('renders the session id in copyable text', () => {
      renderHeader();
      const copyableTexts = screen.getAllByTestId('copyable-text');
      const sessionIdCopyable = copyableTexts.find((el) => el.textContent === 'sess-1234567');
      expect(sessionIdCopyable).toBeDefined();
    });

    it('renders agent name as a link when agentId is present', () => {
      renderHeader();
      const agentLink = screen.getByText('test-agent');
      expect(agentLink).toBeDefined();
      expect(agentLink.closest('a')?.getAttribute('href')).toBe('/agents/agent-1');
    });

    it('falls back to truncated agentId when agentName is null', () => {
      renderHeader({ session: makeSession({ agentName: null }) });
      const link = screen.getByText('agent-1');
      expect(link.closest('a')?.getAttribute('href')).toBe('/agents/agent-1');
    });

    it('does not render agent link when agentId is empty', () => {
      renderHeader({ session: makeSession({ agentId: '', agentName: null }) });
      expect(screen.queryByText('test-agent')).toBeNull();
    });

    it('renders machine id in metadata row', () => {
      renderHeader();
      expect(screen.getByText('Machine:')).toBeDefined();
    });

    it('renders project path badge when projectPath is set', () => {
      renderHeader();
      expect(screen.getByTestId('path-badge')).toBeDefined();
      expect(screen.getByTestId('path-badge').textContent).toBe('/home/user/project');
    });

    it('does not render path badge when projectPath is null', () => {
      renderHeader({ session: makeSession({ projectPath: null }) });
      expect(screen.queryByTestId('path-badge')).toBeNull();
    });

    it('renders PID when present', () => {
      renderHeader({ session: makeSession({ pid: 42 }) });
      expect(screen.getByText('PID 42')).toBeDefined();
    });

    it('does not render PID when null', () => {
      renderHeader({ session: makeSession({ pid: null }) });
      expect(screen.queryByText(/PID/)).toBeNull();
    });

    it('renders claude session id when present', () => {
      renderHeader();
      expect(screen.getByText('Claude:')).toBeDefined();
    });

    it('does not render claude session id when null', () => {
      renderHeader({
        session: makeSession({ claudeSessionId: null }),
      });
      expect(screen.queryByText('Claude:')).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 2. Status badge rendering
  // -----------------------------------------------------------------------

  describe('status badge', () => {
    it('renders status badge with the session status', () => {
      renderHeader({ session: makeSession({ status: 'active' }) });
      const badge = screen.getByTestId('status-badge');
      expect(badge.textContent).toBe('active');
    });

    it('renders correct status for ended session', () => {
      renderHeader({ session: makeSession({ status: 'ended' }) });
      const badge = screen.getByTestId('status-badge');
      expect(badge.textContent).toBe('ended');
    });

    it('renders correct status for error session', () => {
      renderHeader({ session: makeSession({ status: 'error' }) });
      const badge = screen.getByTestId('status-badge');
      expect(badge.textContent).toBe('error');
    });
  });

  // -----------------------------------------------------------------------
  // 3. Duration display
  // -----------------------------------------------------------------------

  describe('duration display', () => {
    it('shows LiveDuration with endedAt for completed sessions', () => {
      renderHeader({
        session: makeSession({
          status: 'ended',
          endedAt: '2026-03-06T01:30:00Z',
        }),
      });
      const durations = screen.getAllByTestId('live-duration');
      const completed = durations.find((el) => el.textContent?.includes('2026-03-06T01:30:00Z'));
      expect(completed).toBeDefined();
    });

    it('shows LiveDuration without endedAt for active sessions', () => {
      renderHeader({ session: makeSession({ status: 'active', endedAt: null }) });
      const durations = screen.getAllByTestId('live-duration');
      const active = durations.find((el) => el.textContent?.includes('now'));
      expect(active).toBeDefined();
    });

    it('shows LiveTimeAgo for startedAt', () => {
      renderHeader();
      const timeAgo = screen.getByTestId('live-time-ago');
      expect(timeAgo.textContent).toBe('2026-03-06T00:00:00Z');
    });
  });

  // -----------------------------------------------------------------------
  // 4. Cost display
  // -----------------------------------------------------------------------

  describe('cost display', () => {
    it('renders cost from streamCost when provided', () => {
      renderHeader({
        streamCost: { totalCostUsd: 1.2345, inputTokens: 1000, outputTokens: 500 },
      });
      // Cost appears in both the metadata row and SessionMetadataBadges
      const costTexts = screen.getAllByText('$1.2345');
      expect(costTexts.length).toBeGreaterThanOrEqual(1);
    });

    it('renders cost from metadata when streamCost is null', () => {
      renderHeader({
        session: makeSession({ metadata: { costUsd: 0.5678 } }),
        streamCost: null,
      });
      // Cost appears in both the metadata row and SessionMetadataBadges
      const costTexts = screen.getAllByText('$0.5678');
      expect(costTexts.length).toBeGreaterThanOrEqual(1);
    });

    it('does not render cost when neither streamCost nor metadata cost is available', () => {
      renderHeader({
        session: makeSession({ metadata: {} }),
        streamCost: null,
      });
      expect(screen.queryByText(/^\$/)).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 5. Model badge
  // -----------------------------------------------------------------------

  describe('model badge', () => {
    it('renders model name in metadata row', () => {
      renderHeader({ session: makeSession({ model: 'claude-opus-4-6' }) });
      expect(screen.getByText('claude-opus-4-6')).toBeDefined();
    });

    it('renders "(default)" when model is null', () => {
      renderHeader({ session: makeSession({ model: null }) });
      const defaults = screen.getAllByText('(default)');
      expect(defaults.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // 6. Export menu
  // -----------------------------------------------------------------------

  describe('export menu', () => {
    it('renders the Export button', () => {
      renderHeader();
      expect(screen.getByText('Export')).toBeDefined();
    });

    it('shows export menu options when Export is clicked', () => {
      renderHeader();
      fireEvent.click(screen.getByText('Export'));
      expect(screen.getByText('Export as JSON')).toBeDefined();
      expect(screen.getByText('Export as Markdown')).toBeDefined();
    });

    it('hides export menu when clicking Export again', () => {
      renderHeader();
      const exportBtn = screen.getByText('Export');
      fireEvent.click(exportBtn);
      expect(screen.getByText('Export as JSON')).toBeDefined();

      fireEvent.click(exportBtn);
      expect(screen.queryByText('Export as JSON')).toBeNull();
    });

    it('hides export menu after clicking Export as JSON', () => {
      // Mock URL.createObjectURL so downloadFile doesn't throw
      const mockCreateObjectURL = vi.fn(() => 'blob:test');
      const mockRevokeObjectURL = vi.fn();
      global.URL.createObjectURL = mockCreateObjectURL;
      global.URL.revokeObjectURL = mockRevokeObjectURL;

      renderHeader();
      fireEvent.click(screen.getByText('Export'));
      fireEvent.click(screen.getByText('Export as JSON'));
      expect(screen.queryByText('Export as JSON')).toBeNull();
    });

    it('hides export menu after clicking Export as Markdown', () => {
      const mockCreateObjectURL = vi.fn(() => 'blob:test');
      const mockRevokeObjectURL = vi.fn();
      global.URL.createObjectURL = mockCreateObjectURL;
      global.URL.revokeObjectURL = mockRevokeObjectURL;

      renderHeader();
      fireEvent.click(screen.getByText('Export'));
      fireEvent.click(screen.getByText('Export as Markdown'));
      expect(screen.queryByText('Export as Markdown')).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 7. Fork button
  // -----------------------------------------------------------------------

  describe('fork button', () => {
    it('shows Fork button for ended session with claudeSessionId', () => {
      renderHeader({
        session: makeSession({
          status: 'ended',
          claudeSessionId: 'claude-sess-abc',
          endedAt: '2026-03-06T01:00:00Z',
        }),
      });
      expect(screen.getByText('Fork')).toBeDefined();
    });

    it('shows Fork button for error session with claudeSessionId', () => {
      renderHeader({
        session: makeSession({
          status: 'error',
          claudeSessionId: 'claude-sess-abc',
          endedAt: '2026-03-06T01:00:00Z',
        }),
      });
      expect(screen.getByText('Fork')).toBeDefined();
    });

    it('shows Fork button for paused session with claudeSessionId', () => {
      renderHeader({
        session: makeSession({
          status: 'paused',
          claudeSessionId: 'claude-sess-abc',
        }),
      });
      expect(screen.getByText('Fork')).toBeDefined();
    });

    it('does not show Fork button for active session', () => {
      renderHeader({
        session: makeSession({
          status: 'active',
          claudeSessionId: 'claude-sess-abc',
        }),
      });
      expect(screen.queryByText('Fork')).toBeNull();
    });

    it('does not show Fork button when claudeSessionId is null', () => {
      renderHeader({
        session: makeSession({
          status: 'ended',
          claudeSessionId: null,
          endedAt: '2026-03-06T01:00:00Z',
        }),
      });
      expect(screen.queryByText('Fork')).toBeNull();
    });

    it('shows fork input when Fork button is clicked', () => {
      renderHeader({
        session: makeSession({
          status: 'ended',
          claudeSessionId: 'claude-sess-abc',
          endedAt: '2026-03-06T01:00:00Z',
        }),
      });
      fireEvent.click(screen.getByText('Fork'));
      expect(screen.getByPlaceholderText('Prompt for the forked session...')).toBeDefined();
      expect(screen.getByText('Fork Session')).toBeDefined();
    });

    it('calls forkSession.mutate with prompt on fork submit', () => {
      renderHeader({
        session: makeSession({
          status: 'ended',
          claudeSessionId: 'claude-sess-abc',
          endedAt: '2026-03-06T01:00:00Z',
        }),
      });
      fireEvent.click(screen.getByText('Fork'));
      const input = screen.getByPlaceholderText('Prompt for the forked session...');
      fireEvent.change(input, { target: { value: 'Continue the work' } });
      fireEvent.click(screen.getByText('Fork Session'));

      expect(mockForkMutate).toHaveBeenCalledTimes(1);
      expect(mockForkMutate).toHaveBeenCalledWith(
        { id: 'sess-1234567890abcdef1234567890abcdef', prompt: 'Continue the work' },
        expect.any(Object),
      );
    });

    it('does not fork with empty prompt', () => {
      renderHeader({
        session: makeSession({
          status: 'ended',
          claudeSessionId: 'claude-sess-abc',
          endedAt: '2026-03-06T01:00:00Z',
        }),
      });
      fireEvent.click(screen.getByText('Fork'));
      fireEvent.click(screen.getByText('Fork Session'));

      expect(mockForkMutate).not.toHaveBeenCalled();
    });

    it('does not fork with whitespace-only prompt', () => {
      renderHeader({
        session: makeSession({
          status: 'ended',
          claudeSessionId: 'claude-sess-abc',
          endedAt: '2026-03-06T01:00:00Z',
        }),
      });
      fireEvent.click(screen.getByText('Fork'));
      const input = screen.getByPlaceholderText('Prompt for the forked session...');
      fireEvent.change(input, { target: { value: '   ' } });
      fireEvent.click(screen.getByText('Fork Session'));

      expect(mockForkMutate).not.toHaveBeenCalled();
    });

    it('Fork Session button is disabled when prompt is empty', () => {
      renderHeader({
        session: makeSession({
          status: 'ended',
          claudeSessionId: 'claude-sess-abc',
          endedAt: '2026-03-06T01:00:00Z',
        }),
      });
      fireEvent.click(screen.getByText('Fork'));
      const btn = screen.getByText('Fork Session') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 8. Delete / End session button
  // -----------------------------------------------------------------------

  describe('end session button', () => {
    it('shows End Session button for active sessions', () => {
      renderHeader({ session: makeSession({ status: 'active' }) });
      expect(screen.getByTestId('confirm-button')).toBeDefined();
      expect(screen.getByText('End Session')).toBeDefined();
    });

    it('shows End Session button for starting sessions', () => {
      renderHeader({ session: makeSession({ status: 'starting' }) });
      expect(screen.getByTestId('confirm-button')).toBeDefined();
    });

    it('does not show End Session button for ended sessions', () => {
      renderHeader({
        session: makeSession({
          status: 'ended',
          endedAt: '2026-03-06T01:00:00Z',
        }),
      });
      expect(screen.queryByTestId('confirm-button')).toBeNull();
    });

    it('calls deleteSession.mutate when confirm button is clicked', () => {
      renderHeader({ session: makeSession({ status: 'active' }) });
      fireEvent.click(screen.getByTestId('confirm-button'));
      expect(mockMutate).toHaveBeenCalledWith(
        'sess-1234567890abcdef1234567890abcdef',
        expect.any(Object),
      );
    });
  });

  // -----------------------------------------------------------------------
  // 9. Error detail panel
  // -----------------------------------------------------------------------

  describe('error detail panel', () => {
    it('shows error detail panel for error status', () => {
      renderHeader({
        session: makeSession({
          status: 'error',
          metadata: {
            errorMessage: 'Something failed',
            errorCode: 'ERR_TIMEOUT',
          },
        }),
      });
      expect(screen.getByText('Something failed')).toBeDefined();
      expect(screen.getByText('ERR_TIMEOUT')).toBeDefined();
    });

    it('does not show error detail panel for non-error status', () => {
      renderHeader({ session: makeSession({ status: 'active' }) });
      expect(screen.queryByText('Copy error')).toBeNull();
    });

    it('shows default message when no errorMessage in metadata', () => {
      renderHeader({
        session: makeSession({
          status: 'error',
          metadata: {},
        }),
      });
      expect(screen.getByText('Session ended with an error (no details available)')).toBeDefined();
    });

    it('shows exit reason when different from error message', () => {
      renderHeader({
        session: makeSession({
          status: 'error',
          metadata: {
            errorMessage: 'Process crashed',
            exitReason: 'Signal: SIGTERM',
          },
        }),
      });
      expect(screen.getByText('Exit reason:')).toBeDefined();
      expect(screen.getByText(/Signal: SIGTERM/)).toBeDefined();
    });

    it('shows error hint when available', () => {
      renderHeader({
        session: makeSession({
          status: 'error',
          metadata: {
            errorMessage: 'Auth error',
            errorHint: 'Check your API key',
          },
        }),
      });
      expect(screen.getByText('Hint:')).toBeDefined();
      expect(screen.getByText(/Check your API key/)).toBeDefined();
    });

    it('shows Copy error button in error panel', () => {
      renderHeader({
        session: makeSession({
          status: 'error',
          metadata: { errorMessage: 'Oops' },
        }),
      });
      expect(screen.getByText('Copy error')).toBeDefined();
    });

    it('shows Expand button for long error messages (>200 chars)', () => {
      const longMsg = 'A'.repeat(250);
      renderHeader({
        session: makeSession({
          status: 'error',
          metadata: { errorMessage: longMsg },
        }),
      });
      expect(screen.getByText('Expand')).toBeDefined();
      // The message should be truncated
      expect(screen.getByText(`${'A'.repeat(200)}...`)).toBeDefined();
    });

    it('expands long error message on Expand click', () => {
      const longMsg = 'A'.repeat(250);
      renderHeader({
        session: makeSession({
          status: 'error',
          metadata: { errorMessage: longMsg },
        }),
      });
      fireEvent.click(screen.getByText('Expand'));
      expect(screen.getByText('Collapse')).toBeDefined();
      expect(screen.getByText(longMsg)).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // 10. Metadata badges (SessionMetadataBadges)
  // -----------------------------------------------------------------------

  describe('metadata badges', () => {
    it('renders model badge from metadata', () => {
      renderHeader({
        session: makeSession({
          metadata: { model: 'claude-opus-4-6', costUsd: 0.1 },
        }),
      });
      // SessionMetadataBadges renders its own model badge in addition to the inline one
      const modelTexts = screen.getAllByText('claude-opus-4-6');
      expect(modelTexts.length).toBeGreaterThan(0);
    });

    it('renders cost badge from metadata', () => {
      renderHeader({
        session: makeSession({
          metadata: { costUsd: 1.5, model: 'test' },
        }),
      });
      // Cost appears in both the metadata row and SessionMetadataBadges
      const costTexts = screen.getAllByText('$1.5000');
      expect(costTexts.length).toBeGreaterThanOrEqual(1);
    });

    it('renders input token count from metadata', () => {
      renderHeader({
        session: makeSession({
          metadata: { inputTokens: 5000, model: 'test' },
        }),
      });
      expect(screen.getByText(/5,000/)).toBeDefined();
    });

    it('renders output token count from metadata', () => {
      renderHeader({
        session: makeSession({
          metadata: { outputTokens: 2000, model: 'test' },
        }),
      });
      expect(screen.getByText(/2,000/)).toBeDefined();
    });

    it('prefers streamCost over metadata cost', () => {
      renderHeader({
        session: makeSession({
          metadata: { costUsd: 0.1, model: 'test' },
        }),
        streamCost: { totalCostUsd: 0.5, inputTokens: 100, outputTokens: 50 },
      });
      // streamCost takes priority — $0.5000 should appear, not $0.1000
      const costTexts = screen.getAllByText('$0.5000');
      expect(costTexts.length).toBeGreaterThanOrEqual(1);
      // The metadata cost of $0.1000 should NOT appear
      expect(screen.queryByText('$0.1000')).toBeNull();
    });

    it('renders nothing when metadata has no model, cost, or tokens', () => {
      renderHeader({
        session: makeSession({ metadata: {} }),
        streamCost: null,
      });
      // SessionMetadataBadges returns null
      // The inline model badge still shows, but there should be no "in"/"out" text
      expect(screen.queryByText(/\sin$/)).toBeNull();
      expect(screen.queryByText(/\sout$/)).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 11. Account display
  // -----------------------------------------------------------------------

  describe('account display', () => {
    it('shows "(default account)" when accountId is null', () => {
      renderHeader({ session: makeSession({ accountId: null }) });
      expect(screen.getByText('(default account)')).toBeDefined();
    });

    it('shows accountId as copyable text when no account name match', () => {
      renderHeader({
        session: makeSession({ accountId: 'acct-xyz-123' }),
      });
      // Should render CopyableText with the accountId
      expect(screen.getByText('Account:')).toBeDefined();
    });

    it('shows account name when account is found in accounts query', () => {
      mockAccountsData.push({ id: 'acct-matched', name: 'My Anthropic' });
      renderHeader({
        session: makeSession({ accountId: 'acct-matched' }),
      });
      expect(screen.getByText('My Anthropic')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // 12. Active session indicators
  // -----------------------------------------------------------------------

  describe('active session indicators', () => {
    it('shows "Streaming" indicator when active and streamConnected', () => {
      renderHeader({
        session: makeSession({ status: 'active' }),
        streamConnected: true,
      });
      expect(screen.getByText('Streaming')).toBeDefined();
    });

    it('shows "Live" indicator when active and not streamConnected', () => {
      renderHeader({
        session: makeSession({ status: 'active' }),
        streamConnected: false,
      });
      expect(screen.getByText('Live')).toBeDefined();
    });

    it('does not show streaming indicator for non-active sessions', () => {
      renderHeader({
        session: makeSession({
          status: 'ended',
          endedAt: '2026-03-06T01:00:00Z',
        }),
        streamConnected: true,
      });
      expect(screen.queryByText('Streaming')).toBeNull();
      expect(screen.queryByText('Live')).toBeNull();
    });

    it('shows starting indicator for sessions with starting status', () => {
      renderHeader({
        session: makeSession({ status: 'starting' }),
      });
      expect(screen.getByText('Waiting for worker to start session...')).toBeDefined();
    });

    it('does not show starting indicator for active sessions', () => {
      renderHeader({ session: makeSession({ status: 'active' }) });
      expect(screen.queryByText('Waiting for worker to start session...')).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 13. Git status badge
  // -----------------------------------------------------------------------

  describe('git status badge', () => {
    it('renders GitStatusBadge when projectPath and machineId exist', () => {
      renderHeader();
      const badge = screen.getByTestId('git-status-badge');
      expect(badge.textContent).toBe('machine-1:/home/user/project');
    });

    it('does not render GitStatusBadge when projectPath is null', () => {
      renderHeader({ session: makeSession({ projectPath: null }) });
      expect(screen.queryByTestId('git-status-badge')).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 14. Refresh button
  // -----------------------------------------------------------------------

  describe('refresh button', () => {
    it('renders refresh button', () => {
      renderHeader();
      expect(screen.getByTestId('refresh-button')).toBeDefined();
    });

    it('passes isFetching to refresh button', () => {
      renderHeader({ isFetching: true });
      const btn = screen.getByTestId('refresh-button');
      expect(btn.getAttribute('aria-busy')).toBe('true');
    });

    it('calls onRefresh when refresh button clicked', () => {
      const onRefresh = vi.fn();
      renderHeader({ onRefresh });
      fireEvent.click(screen.getByTestId('refresh-button'));
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // 15. Files toggle button
  // -----------------------------------------------------------------------

  describe('files toggle button', () => {
    it('renders Files button when onToggleFiles is provided', () => {
      renderHeader({ onToggleFiles: vi.fn() });
      expect(screen.getByText('Files')).toBeDefined();
    });

    it('does not render Files button when onToggleFiles is undefined', () => {
      renderHeader({ onToggleFiles: undefined });
      expect(screen.queryByText('Files')).toBeNull();
    });

    it('calls onToggleFiles when Files button is clicked', () => {
      const onToggleFiles = vi.fn();
      renderHeader({ onToggleFiles });
      fireEvent.click(screen.getByText('Files'));
      expect(onToggleFiles).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // 16. Total messages count
  // -----------------------------------------------------------------------

  describe('total messages count', () => {
    it('renders total message count when provided and > 0', () => {
      renderHeader({ totalMessages: 42 });
      expect(screen.getByText('Messages: 42')).toBeDefined();
    });

    it('does not render message count when totalMessages is 0', () => {
      renderHeader({ totalMessages: 0 });
      expect(screen.queryByText(/Messages:/)).toBeNull();
    });

    it('does not render message count when totalMessages is undefined', () => {
      renderHeader({ totalMessages: undefined });
      expect(screen.queryByText(/Messages:/)).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 17. Fork error warnings
  // -----------------------------------------------------------------------

  describe('fork error warnings', () => {
    it('shows quota warning for error sessions with quota-related errors', () => {
      renderHeader({
        session: makeSession({
          status: 'error',
          claudeSessionId: 'claude-sess-abc',
          endedAt: '2026-03-06T01:00:00Z',
          metadata: { errorMessage: 'Rate limit exceeded' },
        }),
      });
      fireEvent.click(screen.getByText('Fork'));
      expect(screen.getByText(/quota or authentication issues/)).toBeDefined();
    });

    it('shows general error warning for error sessions with non-quota errors', () => {
      renderHeader({
        session: makeSession({
          status: 'error',
          claudeSessionId: 'claude-sess-abc',
          endedAt: '2026-03-06T01:00:00Z',
          metadata: { errorMessage: 'Process crashed unexpectedly' },
        }),
      });
      fireEvent.click(screen.getByText('Fork'));
      expect(screen.getByText(/ended with an error.*forked session may also fail/)).toBeDefined();
    });

    it('does not show error warning for ended (non-error) sessions', () => {
      renderHeader({
        session: makeSession({
          status: 'ended',
          claudeSessionId: 'claude-sess-abc',
          endedAt: '2026-03-06T01:00:00Z',
        }),
      });
      fireEvent.click(screen.getByText('Fork'));
      expect(screen.queryByText(/quota or authentication/)).toBeNull();
      expect(screen.queryByText(/ended with an error/)).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 18. Fork via Enter key
  // -----------------------------------------------------------------------

  describe('fork via keyboard', () => {
    it('submits fork on Enter keypress in the fork input', () => {
      renderHeader({
        session: makeSession({
          status: 'ended',
          claudeSessionId: 'claude-sess-abc',
          endedAt: '2026-03-06T01:00:00Z',
        }),
      });
      fireEvent.click(screen.getByText('Fork'));
      const input = screen.getByPlaceholderText('Prompt for the forked session...');
      fireEvent.change(input, { target: { value: 'Continue work' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(mockForkMutate).toHaveBeenCalledTimes(1);
    });

    it('closes fork input on Escape keypress', () => {
      renderHeader({
        session: makeSession({
          status: 'ended',
          claudeSessionId: 'claude-sess-abc',
          endedAt: '2026-03-06T01:00:00Z',
        }),
      });
      fireEvent.click(screen.getByText('Fork'));
      expect(screen.getByPlaceholderText('Prompt for the forked session...')).toBeDefined();

      const input = screen.getByPlaceholderText('Prompt for the forked session...');
      fireEvent.keyDown(input, { key: 'Escape' });

      expect(screen.queryByPlaceholderText('Prompt for the forked session...')).toBeNull();
    });
  });
});
