import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Session, SessionContentMessage, SessionMetadata } from '@/lib/api';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockSessionQuery,
  mockSessionContentQuery,
  mockAccountsQuery,
  mockUseDeleteSession,
  mockUseForkSession,
  mockUseResumeSession,
  mockUseSendMessage,
  mockUseSessionStream,
  mockRouterPush,
} = vi.hoisted(() => ({
  mockSessionQuery: vi.fn(),
  mockSessionContentQuery: vi.fn(),
  mockAccountsQuery: vi.fn(),
  mockUseDeleteSession: vi.fn(),
  mockUseForkSession: vi.fn(),
  mockUseResumeSession: vi.fn(),
  mockUseSendMessage: vi.fn(),
  mockUseSessionStream: vi.fn(),
  mockRouterPush: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock dependencies — BEFORE the component import
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'ses-123' }),
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock('@/hooks/use-hotkeys', () => ({
  useHotkeys: vi.fn(),
}));

vi.mock('@/hooks/use-session-stream', () => ({
  useSessionStream: (opts: unknown) => mockUseSessionStream(opts),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href} data-testid={`link-${href}`}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className: string }) => (
    <div className={className} data-testid="skeleton" />
  ),
}));

vi.mock('@/components/Breadcrumb', () => ({
  Breadcrumb: ({ items }: { items: Array<{ label: string; href?: string }> }) => (
    <nav data-testid="breadcrumb" aria-label="Breadcrumb">
      {items.map((item) => (
        <span key={item.label} data-testid={`breadcrumb-${item.label}`}>
          {item.href ? <a href={item.href}>{item.label}</a> : item.label}
        </span>
      ))}
    </nav>
  ),
}));

vi.mock('@/components/CopyableText', () => ({
  CopyableText: ({ value, maxDisplay }: { value: string; maxDisplay?: number }) => (
    <span data-testid="copyable-text">{value.slice(0, maxDisplay ?? 8)}</span>
  ),
}));

vi.mock('@/components/StatusBadge', () => ({
  StatusBadge: ({ status }: { status: string }) => (
    <span data-testid={`status-badge-${status}`}>{status}</span>
  ),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/components/ErrorBanner', () => ({
  ErrorBanner: ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
    <div data-testid="error-banner">
      {message}
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
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

vi.mock('@/components/LiveTimeAgo', () => ({
  LiveTimeAgo: ({ date }: { date: string }) => <span data-testid="time-ago">{date}</span>,
}));

vi.mock('@/components/LiveDuration', () => ({
  LiveDuration: ({ startedAt, endedAt }: { startedAt: string; endedAt?: string }) => (
    <span data-testid="live-duration">{endedAt ? 'ended' : startedAt}</span>
  ),
}));

vi.mock('@/components/PathBadge', () => ({
  PathBadge: ({ path }: { path: string }) => <span data-testid="path-badge">{path}</span>,
}));

vi.mock('@/components/RefreshButton', () => ({
  RefreshButton: ({ onClick, isFetching }: { onClick: () => void; isFetching: boolean }) => (
    <button type="button" data-testid="refresh-button" disabled={isFetching} onClick={onClick}>
      Refresh
    </button>
  ),
}));

vi.mock('@/components/ConfirmButton', () => ({
  ConfirmButton: ({ label, onConfirm }: { label: string; onConfirm: () => void }) => (
    <button type="button" data-testid="confirm-button" onClick={onConfirm}>
      {label}
    </button>
  ),
}));

vi.mock('@/components/AnsiText', () => ({
  AnsiText: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="ansi-text">{children}</div>
  ),
  AnsiSpan: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="ansi-span">{children}</span>
  ),
}));

vi.mock('@/components/MarkdownContent', () => ({
  MarkdownContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

vi.mock('@/components/TerminalView', () => ({
  TerminalView: ({ isActive }: { isActive: boolean }) => (
    <div data-testid="terminal-view">{isActive ? 'active' : 'inactive'}</div>
  ),
}));

vi.mock('@/components/FileBrowser', () => ({
  FileBrowser: ({ machineId, initialPath }: { machineId: string; initialPath?: string }) => (
    <div data-testid="file-browser">
      {machineId} - {initialPath}
    </div>
  ),
}));

vi.mock('@/components/GitStatusBadge', () => ({
  GitStatusBadge: ({ machineId, projectPath }: { machineId: string; projectPath: string }) => (
    <div data-testid="git-status-badge">
      {machineId}:{projectPath}
    </div>
  ),
}));

vi.mock('@/components/ThinkingBlock', () => ({
  ThinkingBlock: ({ content, timestamp }: { content: string; timestamp?: string }) => (
    <div data-testid="thinking-block">
      {content}
      {timestamp && <span>{timestamp}</span>}
    </div>
  ),
}));

vi.mock('@/components/ProgressIndicator', () => ({
  ProgressIndicator: ({ content }: { content: string }) => (
    <div data-testid="progress-indicator">{content}</div>
  ),
}));

vi.mock('@/components/SubagentBlock', () => ({
  SubagentBlock: ({ content }: { content: string }) => (
    <div data-testid="subagent-block">{content}</div>
  ),
}));

vi.mock('@/components/TodoBlock', () => ({
  TodoBlock: ({ content }: { content: string }) => <div data-testid="todo-block">{content}</div>,
}));

vi.mock('@/components/ForkContextPicker', () => ({
  ForkContextPicker: () => <div data-testid="fork-context-picker" />,
}));

vi.mock('@/lib/queries', () => ({
  sessionQuery: (id: string) => mockSessionQuery(id),
  sessionContentQuery: (...args: unknown[]) => mockSessionContentQuery(...args),
  accountsQuery: () => mockAccountsQuery(),
  queryKeys: {
    session: (id: string) => ['session', id],
    sessions: () => ['sessions'],
    accounts: ['accounts'],
  },
  useDeleteSession: () => mockUseDeleteSession(),
  useForkSession: () => mockUseForkSession(),
  useResumeSession: () => mockUseResumeSession(),
  useSendMessage: () => mockUseSendMessage(),
}));

// ---------------------------------------------------------------------------
// Component import — AFTER mocks
// ---------------------------------------------------------------------------

import { SessionDetailView } from './SessionDetailView';

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function createSession(overrides?: Partial<Session>): Session {
  return {
    id: 'ses-123',
    agentId: 'agent-1',
    agentName: 'test-agent',
    machineId: 'machine-1',
    sessionUrl: 'https://example.com/session',
    claudeSessionId: 'claude-ses-abc',
    status: 'active',
    projectPath: '/home/user/project',
    pid: 12345,
    startedAt: new Date(Date.now() - 60000).toISOString(),
    lastHeartbeat: new Date().toISOString(),
    endedAt: null,
    metadata: {},
    accountId: 'account-1',
    model: 'claude-sonnet-4-20250514',
    ...overrides,
  };
}

function createMessage(overrides?: Partial<SessionContentMessage>): SessionContentMessage {
  return {
    type: 'assistant',
    content: 'Hello, I am the assistant.',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultStreamMock() {
  return {
    connected: false,
    streamOutput: [],
    rawOutput: [],
    pendingUserMessages: [],
    latestStatus: null,
    latestCost: null,
    clearStreamOutput: vi.fn(),
    clearPendingMessages: vi.fn(),
  };
}

function renderView() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SessionDetailView />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionDetailView', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: loaded session with messages
    mockSessionQuery.mockReturnValue({
      queryKey: ['session', 'ses-123'],
      queryFn: vi.fn().mockResolvedValue(createSession()),
    });

    mockSessionContentQuery.mockReturnValue({
      queryKey: ['session-content', 'claude-ses-abc'],
      queryFn: vi.fn().mockResolvedValue({
        messages: [
          createMessage({ type: 'human', content: 'Hello' }),
          createMessage({ type: 'assistant', content: 'Hi there!' }),
        ],
        sessionId: 'claude-ses-abc',
        totalMessages: 2,
      }),
      enabled: true,
    });

    mockAccountsQuery.mockReturnValue({
      queryKey: ['accounts'],
      queryFn: vi.fn().mockResolvedValue([
        {
          id: 'account-1',
          name: 'Test Account',
          provider: 'anthropic_api',
          credentialMasked: '****',
          priority: 1,
          rateLimit: {},
          isActive: true,
          metadata: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    });

    mockUseDeleteSession.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });

    mockUseForkSession.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });

    mockUseResumeSession.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });

    mockUseSendMessage.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });

    mockUseSessionStream.mockReturnValue(defaultStreamMock());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Header rendering — breadcrumb and status badge
  // =========================================================================

  it('renders session header with breadcrumb and status badge', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('breadcrumb')).toBeDefined();
      expect(screen.getByTestId('breadcrumb-Sessions')).toBeDefined();
      expect(screen.getByTestId('status-badge-active')).toBeDefined();
    });
  });

  it('renders breadcrumb with truncated session id', async () => {
    renderView();
    await waitFor(() => {
      // The breadcrumb label uses session.id.slice(0, 12) = 'ses-123' (< 12 chars)
      expect(screen.getByTestId('breadcrumb-ses-123')).toBeDefined();
    });
  });

  // =========================================================================
  // 2. Loading skeleton
  // =========================================================================

  it('shows loading skeleton when session query is pending', async () => {
    mockSessionQuery.mockReturnValue({
      queryKey: ['session', 'ses-123'],
      queryFn: vi.fn().mockReturnValue(new Promise(() => {})), // Never resolves
    });

    renderView();
    await waitFor(() => {
      const skeletons = screen.getAllByTestId('skeleton');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 3. Session metadata
  // =========================================================================

  it('renders session metadata — machine ID', async () => {
    renderView();
    await waitFor(() => {
      // machine-1 is shown via CopyableText
      const copyableTexts = screen.getAllByTestId('copyable-text');
      const machineText = copyableTexts.find((el) => el.textContent?.includes('machine-1'));
      expect(machineText).toBeDefined();
    });
  });

  it('renders session model badge', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByText('claude-sonnet-4-20250514')).toBeDefined();
    });
  });

  it('renders session PID', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByText(/PID 12345/)).toBeDefined();
    });
  });

  it('renders project path badge', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('path-badge')).toBeDefined();
      expect(screen.getByTestId('path-badge').textContent).toBe('/home/user/project');
    });
  });

  it('renders started time', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getAllByTestId('time-ago').length).toBeGreaterThan(0);
    });
  });

  it('renders duration when session has endedAt', async () => {
    mockSessionQuery.mockReturnValue({
      queryKey: ['session', 'ses-123'],
      queryFn: vi
        .fn()
        .mockResolvedValue(createSession({ status: 'ended', endedAt: new Date().toISOString() })),
    });

    renderView();
    await waitFor(() => {
      const duration = screen.getAllByTestId('live-duration');
      expect(duration.length).toBeGreaterThan(0);
    });
  });

  it('renders account name when resolved', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Test Account')).toBeDefined();
    });
  });

  // =========================================================================
  // 4. Message list with different types
  // =========================================================================

  it('renders human and assistant messages', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeDefined();
      expect(screen.getByText('Hi there!')).toBeDefined();
    });
  });

  it('renders thinking messages when showThinking is on (default)', async () => {
    mockSessionContentQuery.mockReturnValue({
      queryKey: ['session-content', 'claude-ses-abc'],
      queryFn: vi.fn().mockResolvedValue({
        messages: [
          createMessage({ type: 'thinking', content: 'Let me think about this...' }),
          createMessage({ type: 'assistant', content: 'Answer!' }),
        ],
        sessionId: 'claude-ses-abc',
        totalMessages: 2,
      }),
      enabled: true,
    });

    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('thinking-block')).toBeDefined();
      expect(screen.getByText('Let me think about this...')).toBeDefined();
    });
  });

  it('renders tool_use messages only when Tools toggle is on', async () => {
    mockSessionContentQuery.mockReturnValue({
      queryKey: ['session-content', 'claude-ses-abc'],
      queryFn: vi.fn().mockResolvedValue({
        messages: [
          createMessage({
            type: 'tool_use',
            content: 'read file.txt',
            toolName: 'Read',
            toolId: 'tool-1',
          }),
          createMessage({
            type: 'tool_result',
            content: 'file contents here',
            toolName: 'Read',
            toolId: 'tool-1',
          }),
          createMessage({ type: 'assistant', content: 'Done' }),
        ],
        sessionId: 'claude-ses-abc',
        totalMessages: 3,
      }),
      enabled: true,
    });

    renderView();
    await waitFor(() => {
      expect(screen.getByText('Done')).toBeDefined();
    });

    // Tools are hidden by default
    expect(screen.queryByText('read file.txt')).toBeNull();

    // Click the Tools toggle to show them
    const toolsButton = screen.getByText('Tools');
    fireEvent.click(toolsButton);

    await waitFor(() => {
      // Now tool messages should appear (as a ToolPairBlock)
      expect(screen.getByText('Read')).toBeDefined();
    });
  });

  it('renders progress messages when Progress toggle is on for active sessions', async () => {
    mockSessionContentQuery.mockReturnValue({
      queryKey: ['session-content', 'claude-ses-abc'],
      queryFn: vi.fn().mockResolvedValue({
        messages: [
          createMessage({ type: 'progress', content: 'Running bash command...' }),
          createMessage({ type: 'assistant', content: 'Done' }),
        ],
        sessionId: 'claude-ses-abc',
        totalMessages: 2,
      }),
      enabled: true,
    });

    renderView();
    await waitFor(() => {
      // Progress is shown by default for active sessions
      expect(screen.getByTestId('progress-indicator')).toBeDefined();
      expect(screen.getByText('Running bash command...')).toBeDefined();
    });
  });

  // =========================================================================
  // 5. Filter toggles
  // =========================================================================

  it('renders Thinking, Tools, Progress, and Markdown toggle buttons', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Thinking')).toBeDefined();
      expect(screen.getByText('Tools')).toBeDefined();
      expect(screen.getByText('Progress')).toBeDefined();
      expect(screen.getByText('Markdown')).toBeDefined();
    });
  });

  it('Thinking toggle has correct initial aria-pressed state', async () => {
    renderView();
    await waitFor(() => {
      const thinkingBtn = screen.getByText('Thinking');
      expect(thinkingBtn.getAttribute('aria-pressed')).toBe('true');
    });
  });

  it('Tools toggle has correct initial aria-pressed state (off)', async () => {
    renderView();
    await waitFor(() => {
      const toolsBtn = screen.getByText('Tools');
      expect(toolsBtn.getAttribute('aria-pressed')).toBe('false');
    });
  });

  it('clicking Thinking toggle hides thinking messages', async () => {
    mockSessionContentQuery.mockReturnValue({
      queryKey: ['session-content', 'claude-ses-abc'],
      queryFn: vi.fn().mockResolvedValue({
        messages: [
          createMessage({ type: 'thinking', content: 'Deep thought' }),
          createMessage({ type: 'assistant', content: 'Answer' }),
        ],
        sessionId: 'claude-ses-abc',
        totalMessages: 2,
      }),
      enabled: true,
    });

    renderView();
    await waitFor(() => {
      expect(screen.getByText('Deep thought')).toBeDefined();
    });

    const thinkingBtn = screen.getByText('Thinking');
    fireEvent.click(thinkingBtn);

    await waitFor(() => {
      expect(screen.queryByText('Deep thought')).toBeNull();
    });
  });

  it('Markdown toggle has correct initial aria-pressed state (on)', async () => {
    renderView();
    await waitFor(() => {
      const mdBtn = screen.getByText('Markdown');
      expect(mdBtn.getAttribute('aria-pressed')).toBe('true');
    });
  });

  // =========================================================================
  // 6. End Session button for active sessions
  // =========================================================================

  it('shows End Session button for active sessions', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('confirm-button')).toBeDefined();
      expect(screen.getByText('End Session')).toBeDefined();
    });
  });

  it('does not show End Session button for ended sessions', async () => {
    mockSessionQuery.mockReturnValue({
      queryKey: ['session', 'ses-123'],
      queryFn: vi
        .fn()
        .mockResolvedValue(createSession({ status: 'ended', endedAt: new Date().toISOString() })),
    });

    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('breadcrumb')).toBeDefined();
    });
    expect(screen.queryByText('End Session')).toBeNull();
  });

  it('shows End Session button for starting sessions', async () => {
    mockSessionQuery.mockReturnValue({
      queryKey: ['session', 'ses-123'],
      queryFn: vi.fn().mockResolvedValue(createSession({ status: 'starting' })),
    });

    renderView();
    await waitFor(() => {
      expect(screen.getByText('End Session')).toBeDefined();
    });
  });

  // =========================================================================
  // 7. Resume session input
  // =========================================================================

  it('shows resume input for ended sessions', async () => {
    mockSessionQuery.mockReturnValue({
      queryKey: ['session', 'ses-123'],
      queryFn: vi
        .fn()
        .mockResolvedValue(createSession({ status: 'ended', endedAt: new Date().toISOString() })),
    });

    renderView();
    await waitFor(() => {
      const textarea = screen.getByPlaceholderText('Resume session with a prompt...');
      expect(textarea).toBeDefined();
    });
  });

  it('shows Resume button label for ended sessions', async () => {
    mockSessionQuery.mockReturnValue({
      queryKey: ['session', 'ses-123'],
      queryFn: vi
        .fn()
        .mockResolvedValue(createSession({ status: 'ended', endedAt: new Date().toISOString() })),
    });

    renderView();
    await waitFor(() => {
      expect(screen.getByText('Resume')).toBeDefined();
    });
  });

  it('shows model selector for resumable sessions', async () => {
    mockSessionQuery.mockReturnValue({
      queryKey: ['session', 'ses-123'],
      queryFn: vi
        .fn()
        .mockResolvedValue(createSession({ status: 'ended', endedAt: new Date().toISOString() })),
    });

    renderView();
    await waitFor(() => {
      expect(screen.getByText('Keep current model')).toBeDefined();
    });
  });

  // =========================================================================
  // 8. Send message input
  // =========================================================================

  it('shows send message input for active sessions', async () => {
    renderView();
    await waitFor(() => {
      const textarea = screen.getByPlaceholderText('Send a message... (paste images with Ctrl+V)');
      expect(textarea).toBeDefined();
    });
  });

  it('shows Send button for active sessions', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Send')).toBeDefined();
    });
  });

  it('shows "cannot send messages" for completed sessions without resume ability', async () => {
    mockSessionQuery.mockReturnValue({
      queryKey: ['session', 'ses-123'],
      queryFn: vi
        .fn()
        .mockResolvedValue(
          createSession({ status: 'completed', endedAt: new Date().toISOString() }),
        ),
    });

    renderView();
    await waitFor(() => {
      expect(screen.getByText(/Cannot send messages/)).toBeDefined();
    });
  });

  it('shows starting message for starting sessions', async () => {
    mockSessionQuery.mockReturnValue({
      queryKey: ['session', 'ses-123'],
      queryFn: vi.fn().mockResolvedValue(createSession({ status: 'starting' })),
    });

    renderView();
    await waitFor(() => {
      expect(screen.getByText('Session is starting. Please wait...')).toBeDefined();
    });
  });

  it('shows enter/shift+enter hint', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByText(/Enter to send/)).toBeDefined();
    });
  });

  // =========================================================================
  // 9. Export buttons
  // =========================================================================

  it('renders Export button', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Export')).toBeDefined();
    });
  });

  it('shows export menu with JSON and Markdown options when clicked', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Export')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Export'));

    await waitFor(() => {
      expect(screen.getByText('Export as JSON')).toBeDefined();
      expect(screen.getByText('Export as Markdown')).toBeDefined();
    });
  });

  // =========================================================================
  // 10. Fork session button
  // =========================================================================

  it('shows Fork button for ended sessions with claudeSessionId', async () => {
    mockSessionQuery.mockReturnValue({
      queryKey: ['session', 'ses-123'],
      queryFn: vi.fn().mockResolvedValue(
        createSession({
          status: 'ended',
          endedAt: new Date().toISOString(),
          claudeSessionId: 'claude-ses-abc',
        }),
      ),
    });

    renderView();
    await waitFor(() => {
      expect(screen.getByText('Fork')).toBeDefined();
    });
  });

  it('does not show Fork button for active sessions', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('breadcrumb')).toBeDefined();
    });
    expect(screen.queryByText('Fork')).toBeNull();
  });

  it('shows fork input with prompt field when Fork button is clicked', async () => {
    mockSessionQuery.mockReturnValue({
      queryKey: ['session', 'ses-123'],
      queryFn: vi.fn().mockResolvedValue(
        createSession({
          status: 'ended',
          endedAt: new Date().toISOString(),
          claudeSessionId: 'claude-ses-abc',
        }),
      ),
    });

    renderView();
    await waitFor(() => {
      expect(screen.getByText('Fork')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Fork'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Prompt for the forked session...')).toBeDefined();
      expect(screen.getByText('Fork Session')).toBeDefined();
    });
  });

  it('shows Fork for error sessions', async () => {
    mockSessionQuery.mockReturnValue({
      queryKey: ['session', 'ses-123'],
      queryFn: vi
        .fn()
        .mockResolvedValue(createSession({ status: 'error', claudeSessionId: 'claude-ses-abc' })),
    });

    renderView();
    await waitFor(() => {
      expect(screen.getByText('Fork')).toBeDefined();
    });
  });

  // =========================================================================
  // 11. Error state rendering
  // =========================================================================

  it('shows error state when session query fails', async () => {
    const error = new Error('Session not found');
    mockSessionQuery.mockReturnValue({
      queryKey: ['session', 'ses-123'],
      queryFn: vi.fn().mockRejectedValue(error),
    });

    renderView();
    await waitFor(() => {
      const errorElements = screen.getAllByText('Error');
      expect(errorElements.length).toBeGreaterThan(0);
      expect(screen.getByText('Session not found')).toBeDefined();
    });
  });

  it('shows error details for sessions with error status', async () => {
    const metadata: SessionMetadata = {
      errorMessage: 'Rate limit exceeded',
      errorHint: 'Try using a different account',
    };

    mockSessionQuery.mockReturnValue({
      queryKey: ['session', 'ses-123'],
      queryFn: vi.fn().mockResolvedValue(createSession({ status: 'error', metadata })),
    });

    renderView();
    await waitFor(() => {
      expect(screen.getByText('Rate limit exceeded')).toBeDefined();
      expect(screen.getByText('Try using a different account')).toBeDefined();
    });
  });

  it('shows content-level error banner', async () => {
    mockSessionContentQuery.mockReturnValue({
      queryKey: ['session-content', 'claude-ses-abc'],
      queryFn: vi.fn().mockRejectedValue(new Error('Content fetch failed')),
      enabled: true,
    });

    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('error-banner')).toBeDefined();
    });
  });

  it('shows starting indicator for starting sessions', async () => {
    mockSessionQuery.mockReturnValue({
      queryKey: ['session', 'ses-123'],
      queryFn: vi.fn().mockResolvedValue(createSession({ status: 'starting' })),
    });

    renderView();
    await waitFor(() => {
      expect(screen.getByText('Waiting for worker to start session...')).toBeDefined();
    });
  });

  // =========================================================================
  // 12. Cost display
  // =========================================================================

  it('displays cost from session metadata', async () => {
    const metadata: SessionMetadata = {
      costUsd: 0.0523,
      inputTokens: 5000,
      outputTokens: 2000,
    };

    mockSessionQuery.mockReturnValue({
      queryKey: ['session', 'ses-123'],
      queryFn: vi.fn().mockResolvedValue(createSession({ metadata })),
    });

    renderView();
    await waitFor(() => {
      // Cost may appear in both the header and metadata badges
      expect(screen.getAllByText('$0.0523').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/5,000 in/)).toBeDefined();
      expect(screen.getByText(/2,000 out/)).toBeDefined();
    });
  });

  it('displays streaming cost when available', async () => {
    mockUseSessionStream.mockReturnValue({
      ...defaultStreamMock(),
      connected: true,
      latestCost: { totalCostUsd: 0.1234, inputTokens: 10000, outputTokens: 3000 },
    });

    renderView();
    await waitFor(() => {
      // Streaming cost may appear in both the header and metadata badges
      const costElements = screen.getAllByText('$0.1234');
      expect(costElements.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 13. Messages/Terminal tab switching
  // =========================================================================

  it('renders Messages and Terminal toggle buttons', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Messages')).toBeDefined();
      expect(screen.getByText('Terminal')).toBeDefined();
    });
  });

  it('shows terminal view when Terminal tab is clicked', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Terminal')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Terminal'));

    await waitFor(() => {
      expect(screen.getByTestId('terminal-view')).toBeDefined();
    });
  });

  it('switches back to messages view', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Terminal')).toBeDefined();
    });

    // Switch to Terminal
    fireEvent.click(screen.getByText('Terminal'));
    await waitFor(() => {
      expect(screen.getByTestId('terminal-view')).toBeDefined();
    });

    // Switch back — there are multiple "Messages" buttons (in both toolbars), click the first
    const messagesButtons = screen.getAllByText('Messages');
    const msgBtn = messagesButtons[0];
    if (msgBtn) fireEvent.click(msgBtn);

    await waitFor(() => {
      // Messages view should be back, no terminal-view
      expect(screen.queryByTestId('terminal-view')).toBeNull();
    });
  });

  // =========================================================================
  // 14. ToolPairBlock rendering (collapsed/expanded)
  // =========================================================================

  it('renders ToolPairBlock collapsed by default', async () => {
    mockSessionContentQuery.mockReturnValue({
      queryKey: ['session-content', 'claude-ses-abc'],
      queryFn: vi.fn().mockResolvedValue({
        messages: [
          createMessage({
            type: 'tool_use',
            content: 'cat foo.txt',
            toolName: 'Bash',
            toolId: 'tool-42',
          }),
          createMessage({
            type: 'tool_result',
            content: 'Hello world',
            toolName: 'Bash',
            toolId: 'tool-42',
          }),
        ],
        sessionId: 'claude-ses-abc',
        totalMessages: 2,
      }),
      enabled: true,
    });

    renderView();

    // Enable Tools toggle first
    await waitFor(() => {
      expect(screen.getByText('Tools')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Tools'));

    await waitFor(() => {
      // Collapsed ToolPairBlock shows "click to expand"
      expect(screen.getByText('click to expand')).toBeDefined();
      expect(screen.getByText('Bash')).toBeDefined();
    });
  });

  it('expands ToolPairBlock when clicked', async () => {
    mockSessionContentQuery.mockReturnValue({
      queryKey: ['session-content', 'claude-ses-abc'],
      queryFn: vi.fn().mockResolvedValue({
        messages: [
          createMessage({
            type: 'tool_use',
            content: 'cat foo.txt',
            toolName: 'Bash',
            toolId: 'tool-42',
          }),
          createMessage({
            type: 'tool_result',
            content: 'Hello world',
            toolName: 'Bash',
            toolId: 'tool-42',
          }),
        ],
        sessionId: 'claude-ses-abc',
        totalMessages: 2,
      }),
      enabled: true,
    });

    renderView();

    // Enable Tools toggle
    await waitFor(() => {
      expect(screen.getByText('Tools')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Tools'));

    await waitFor(() => {
      expect(screen.getByText('click to expand')).toBeDefined();
    });

    // Click to expand
    fireEvent.click(screen.getByText('click to expand'));

    await waitFor(() => {
      expect(screen.getByText('Input')).toBeDefined();
      expect(screen.getByText('Output')).toBeDefined();
      expect(screen.getByText('collapse')).toBeDefined();
    });
  });

  // =========================================================================
  // 15. Auto-scroll "Following" indicator
  // =========================================================================

  it('shows Following indicator for active sessions when auto-scroll is active', async () => {
    mockUseSessionStream.mockReturnValue({
      ...defaultStreamMock(),
      connected: true,
    });

    renderView();
    await waitFor(() => {
      expect(screen.getByText('Following')).toBeDefined();
    });
  });

  it('does not show Following indicator for ended sessions', async () => {
    mockSessionQuery.mockReturnValue({
      queryKey: ['session', 'ses-123'],
      queryFn: vi
        .fn()
        .mockResolvedValue(createSession({ status: 'ended', endedAt: new Date().toISOString() })),
    });

    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('breadcrumb')).toBeDefined();
    });
    expect(screen.queryByText('Following')).toBeNull();
  });

  // =========================================================================
  // Additional coverage
  // =========================================================================

  it('renders message count in toolbar', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByText('2 messages')).toBeDefined();
    });
  });

  it('shows Load older messages button when totalMessages > messages.length', async () => {
    mockSessionContentQuery.mockReturnValue({
      queryKey: ['session-content', 'claude-ses-abc'],
      queryFn: vi.fn().mockResolvedValue({
        messages: [createMessage({ type: 'assistant', content: 'Latest message' })],
        sessionId: 'claude-ses-abc',
        totalMessages: 50,
      }),
      enabled: true,
    });

    renderView();
    await waitFor(() => {
      expect(screen.getByText(/Load older messages/)).toBeDefined();
      expect(screen.getByText(/49 more/)).toBeDefined();
    });
  });

  it('renders search input with placeholder', async () => {
    renderView();
    await waitFor(() => {
      const searchInput = screen.getByPlaceholderText('Search messages...');
      expect(searchInput).toBeDefined();
    });
  });

  it('shows "No messages yet" when content is empty and loaded', async () => {
    mockSessionContentQuery.mockReturnValue({
      queryKey: ['session-content', 'claude-ses-abc'],
      queryFn: vi.fn().mockResolvedValue({
        messages: [],
        sessionId: 'claude-ses-abc',
        totalMessages: 0,
      }),
      enabled: true,
    });

    renderView();
    await waitFor(() => {
      expect(screen.getByText('No messages yet')).toBeDefined();
    });
  });

  it('renders Files toggle button', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Files')).toBeDefined();
    });
  });

  it('renders Streaming label when connected and session is active', async () => {
    mockUseSessionStream.mockReturnValue({
      ...defaultStreamMock(),
      connected: true,
    });

    renderView();
    await waitFor(() => {
      expect(screen.getByText('Streaming')).toBeDefined();
    });
  });

  it('renders Live label when not connected but session is active', async () => {
    mockUseSessionStream.mockReturnValue({
      ...defaultStreamMock(),
      connected: false,
    });

    renderView();
    await waitFor(() => {
      expect(screen.getByText('Live')).toBeDefined();
    });
  });

  it('renders default model text when model is null', async () => {
    mockSessionQuery.mockReturnValue({
      queryKey: ['session', 'ses-123'],
      queryFn: vi.fn().mockResolvedValue(createSession({ model: null })),
    });

    renderView();
    await waitFor(() => {
      expect(screen.getByText('(default)')).toBeDefined();
    });
  });

  it('shows error warning when forking an error session due to quota', async () => {
    mockSessionQuery.mockReturnValue({
      queryKey: ['session', 'ses-123'],
      queryFn: vi.fn().mockResolvedValue(
        createSession({
          status: 'error',
          claudeSessionId: 'claude-ses-abc',
          metadata: { errorMessage: 'Rate limit quota exceeded' },
        }),
      ),
    });

    renderView();
    await waitFor(() => {
      expect(screen.getByText('Fork')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Fork'));

    await waitFor(() => {
      expect(screen.getByText(/Resolve the underlying issue before forking/)).toBeDefined();
    });
  });

  it('shows general error warning when forking a non-quota error session', async () => {
    mockSessionQuery.mockReturnValue({
      queryKey: ['session', 'ses-123'],
      queryFn: vi.fn().mockResolvedValue(
        createSession({
          status: 'error',
          claudeSessionId: 'claude-ses-abc',
          metadata: { errorMessage: 'Something went wrong' },
        }),
      ),
    });

    renderView();
    await waitFor(() => {
      expect(screen.getByText('Fork')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Fork'));

    await waitFor(() => {
      expect(screen.getByText(/The forked session may also fail/)).toBeDefined();
    });
  });

  it('renders git status badge when projectPath and machineId are set', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('git-status-badge')).toBeDefined();
    });
  });

  it('renders refresh button', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('refresh-button')).toBeDefined();
    });
  });

  it('renders fetching bar', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('fetching-bar')).toBeDefined();
    });
  });
});
