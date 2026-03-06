import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock ALL external dependencies BEFORE importing the component
// ---------------------------------------------------------------------------

// Mock @/lib/api
const mockGetSessionContent = vi.fn();
vi.mock('../lib/api', () => ({
  api: {
    getSessionContent: (...args: unknown[]) => mockGetSessionContent(...args),
  },
}));

// Mock useSessionStream hook
const mockUseSessionStream = vi.fn();
vi.mock('../hooks/use-session-stream', () => ({
  useSessionStream: (...args: unknown[]) => mockUseSessionStream(...args),
}));

// Mock useNotificationContext
const mockAddNotification = vi.fn();
vi.mock('../contexts/notification-context', () => ({
  useNotificationContext: () => ({
    notifications: [],
    unreadCount: 0,
    addNotification: mockAddNotification,
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    clearAll: vi.fn(),
  }),
}));

// Mock @/lib/utils
vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// Mock @/lib/message-styles
vi.mock('../lib/message-styles', () => ({
  getMessageStyle: (type: string) => {
    const map: Record<string, { label: string; textClass: string; bubbleClass: string }> = {
      human: { label: 'You', textClass: 'text-indigo', bubbleClass: 'bg-indigo' },
      assistant: { label: 'Claude', textClass: 'text-green', bubbleClass: 'bg-green' },
      tool_use: { label: 'Tool Call', textClass: 'text-yellow', bubbleClass: 'bg-yellow' },
      tool_result: { label: 'Tool Result', textClass: 'text-slate', bubbleClass: 'bg-slate' },
      thinking: { label: 'Thinking', textClass: 'text-purple', bubbleClass: 'bg-purple' },
      progress: { label: 'Progress', textClass: 'text-cyan', bubbleClass: 'bg-cyan' },
    };
    return map[type] ?? { label: type, textClass: 'text-muted', bubbleClass: 'bg-muted' };
  },
}));

// Mock @/lib/format-utils
vi.mock('../lib/format-utils', () => ({
  formatTime: (ts: string) => `time:${ts}`,
}));

// Mock @/components/ui/skeleton
vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}));

// Mock child components as simple stubs
vi.mock('./ThinkingBlock', () => ({
  ThinkingBlock: ({ content, timestamp }: { content?: string; timestamp?: string }) => (
    <div data-testid="thinking-block">
      {content}
      {timestamp && <span>{timestamp}</span>}
    </div>
  ),
}));

vi.mock('./ProgressIndicator', () => ({
  ProgressIndicator: ({
    content,
    toolName,
  }: {
    content?: string;
    toolName?: string;
    timestamp?: string;
  }) => (
    <div data-testid="progress-indicator">
      {content}
      {toolName && <span>{toolName}</span>}
    </div>
  ),
}));

vi.mock('./SubagentBlock', () => ({
  SubagentBlock: ({
    content,
    subagentId,
  }: {
    content?: string;
    toolName?: string;
    subagentId?: string;
    timestamp?: string;
  }) => (
    <div data-testid="subagent-block">
      {content}
      {subagentId && <span>{subagentId}</span>}
    </div>
  ),
}));

vi.mock('./TodoBlock', () => ({
  TodoBlock: ({ content }: { content?: string; timestamp?: string }) => (
    <div data-testid="todo-block">{content}</div>
  ),
}));

vi.mock('./TerminalView', () => ({
  TerminalView: ({ rawOutput, isActive }: { rawOutput: string[]; isActive?: boolean }) => (
    <div data-testid="terminal-view">
      Terminal ({rawOutput.length} chunks) {isActive ? 'active' : 'inactive'}
    </div>
  ),
}));

vi.mock('./MarkdownContent', () => ({
  MarkdownContent: ({ children, className }: { children?: string; className?: string }) => (
    <div data-testid="markdown-content" className={className}>
      {children}
    </div>
  ),
}));

vi.mock('./AnsiText', () => ({
  AnsiText: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div data-testid="ansi-text" className={className}>
      {children}
    </div>
  ),
  AnsiSpan: ({ children }: { children?: React.ReactNode }) => (
    <span data-testid="ansi-span">{children}</span>
  ),
}));

vi.mock('./ErrorBanner', () => ({
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

// ---------------------------------------------------------------------------
// NOW import the component under test
// ---------------------------------------------------------------------------

import type { SessionContentMessage } from '../lib/api';
import { InlineMessage, SessionContent } from './SessionContent';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(
  overrides: Partial<SessionContentMessage> & { type: string },
): SessionContentMessage {
  return {
    content: `Content for ${overrides.type}`,
    ...overrides,
  } as SessionContentMessage;
}

const defaultStreamReturn = {
  connected: false,
  streamOutput: [] as string[],
  rawOutput: [] as string[],
  pendingUserMessages: [] as string[],
  latestStatus: null,
  latestCost: null,
  clearStreamOutput: vi.fn(),
  clearPendingMessages: vi.fn(),
};

const defaultProps = {
  sessionId: 'sess-123',
  rcSessionId: 'rc-456',
  machineId: 'machine-1',
  projectPath: '/project',
  isActive: false,
};

function renderSessionContent(overrides: Partial<typeof defaultProps> = {}) {
  return render(<SessionContent {...defaultProps} {...overrides} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    mockUseSessionStream.mockReturnValue({ ...defaultStreamReturn });
    mockGetSessionContent.mockResolvedValue({
      messages: [],
      sessionId: 'sess-123',
      totalMessages: 0,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // 1. Loading state
  // =========================================================================
  describe('loading state', () => {
    it('shows skeleton placeholders while loading', () => {
      // Never resolve the promise so it stays in loading
      mockGetSessionContent.mockReturnValue(new Promise(() => {}));
      renderSessionContent();

      const skeletons = screen.getAllByTestId('skeleton');
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it('removes skeletons after data loads', async () => {
      mockGetSessionContent.mockResolvedValue({
        messages: [],
        sessionId: 'sess-123',
        totalMessages: 0,
      });
      renderSessionContent();

      await waitFor(() => {
        expect(screen.queryAllByTestId('skeleton')).toHaveLength(0);
      });
    });
  });

  // =========================================================================
  // 2. Empty state
  // =========================================================================
  describe('empty state', () => {
    it('shows "No messages yet" when no messages and not loading', async () => {
      mockGetSessionContent.mockResolvedValue({
        messages: [],
        sessionId: 'sess-123',
        totalMessages: 0,
      });
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByText('No messages yet')).toBeDefined();
      });
    });
  });

  // =========================================================================
  // 3. Messages rendering
  // =========================================================================
  describe('messages rendering', () => {
    it('renders human and assistant messages', async () => {
      mockGetSessionContent.mockResolvedValue({
        messages: [
          makeMessage({ type: 'human', content: 'Hello there' }),
          makeMessage({ type: 'assistant', content: 'Hi! How can I help?' }),
        ],
        sessionId: 'sess-123',
        totalMessages: 2,
      });
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByText('You')).toBeDefined();
        expect(screen.getByText('Claude')).toBeDefined();
      });
    });

    it('displays message count text', async () => {
      mockGetSessionContent.mockResolvedValue({
        messages: [
          makeMessage({ type: 'human', content: 'msg1' }),
          makeMessage({ type: 'assistant', content: 'msg2' }),
        ],
        sessionId: 'sess-123',
        totalMessages: 2,
      });
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByText('2 messages')).toBeDefined();
      });
    });

    it('shows "X / total messages" when there are more messages', async () => {
      mockGetSessionContent.mockResolvedValue({
        messages: [makeMessage({ type: 'human', content: 'msg1' })],
        sessionId: 'sess-123',
        totalMessages: 50,
      });
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByText('1 / 50 messages')).toBeDefined();
      });
    });
  });

  // =========================================================================
  // 4. Filter toggles
  // =========================================================================
  describe('filter toggles', () => {
    const messagesWithAllTypes = [
      makeMessage({ type: 'human', content: 'User question' }),
      makeMessage({ type: 'assistant', content: 'AI answer' }),
      makeMessage({ type: 'thinking', content: 'Thinking content' }),
      makeMessage({ type: 'tool_use', content: 'Tool call content', toolName: 'Read' }),
      makeMessage({ type: 'tool_result', content: 'Tool result content' }),
      makeMessage({ type: 'progress', content: 'Progress content', toolName: 'Bash' }),
    ];

    beforeEach(() => {
      mockGetSessionContent.mockResolvedValue({
        messages: messagesWithAllTypes,
        sessionId: 'sess-123',
        totalMessages: 6,
      });
    });

    it('hides thinking messages by default', async () => {
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByText('You')).toBeDefined();
      });
      expect(screen.queryByTestId('thinking-block')).toBeNull();
    });

    it('shows thinking messages after toggling Thinking button', async () => {
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByText('You')).toBeDefined();
      });

      const thinkingBtn = screen.getByRole('button', { name: /thinking/i });
      fireEvent.click(thinkingBtn);

      await waitFor(() => {
        expect(screen.getByTestId('thinking-block')).toBeDefined();
      });
    });

    it('hides tool messages by default', async () => {
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByText('You')).toBeDefined();
      });
      expect(screen.queryByText('Tool Call')).toBeNull();
      expect(screen.queryByText('Tool Result')).toBeNull();
    });

    it('shows tool messages after toggling Tools button', async () => {
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByText('You')).toBeDefined();
      });

      const toolsBtn = screen.getByRole('button', { name: /tool/i });
      fireEvent.click(toolsBtn);

      await waitFor(() => {
        expect(screen.getByText('Tool Call')).toBeDefined();
        expect(screen.getByText('Tool Result')).toBeDefined();
      });
    });

    it('hides progress messages by default for inactive sessions', async () => {
      renderSessionContent({ isActive: false });

      await waitFor(() => {
        expect(screen.getByText('You')).toBeDefined();
      });
      expect(screen.queryByTestId('progress-indicator')).toBeNull();
    });

    it('shows progress messages by default for active sessions', async () => {
      renderSessionContent({ isActive: true });

      await waitFor(() => {
        expect(screen.getByTestId('progress-indicator')).toBeDefined();
      });
    });

    it('toggles progress messages off and on', async () => {
      renderSessionContent({ isActive: true });

      await waitFor(() => {
        expect(screen.getByTestId('progress-indicator')).toBeDefined();
      });

      const progressBtn = screen.getByRole('button', { name: /progress/i });
      fireEvent.click(progressBtn);

      await waitFor(() => {
        expect(screen.queryByTestId('progress-indicator')).toBeNull();
      });

      fireEvent.click(progressBtn);

      await waitFor(() => {
        expect(screen.getByTestId('progress-indicator')).toBeDefined();
      });
    });

    it('shows "No messages match current filters" when filters hide all', async () => {
      mockGetSessionContent.mockResolvedValue({
        messages: [makeMessage({ type: 'thinking', content: 'only thinking' })],
        sessionId: 'sess-123',
        totalMessages: 1,
      });
      renderSessionContent({ isActive: false });

      await waitFor(() => {
        expect(screen.getByText('No messages match current filters')).toBeDefined();
      });
    });

    it('Thinking button has aria-pressed reflecting state', async () => {
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByText('You')).toBeDefined();
      });

      const thinkingBtn = screen.getByRole('button', { name: /thinking/i });
      expect(thinkingBtn.getAttribute('aria-pressed')).toBe('false');

      fireEvent.click(thinkingBtn);
      expect(thinkingBtn.getAttribute('aria-pressed')).toBe('true');
    });
  });

  // =========================================================================
  // 5. Markdown toggle
  // =========================================================================
  describe('markdown toggle', () => {
    beforeEach(() => {
      mockGetSessionContent.mockResolvedValue({
        messages: [makeMessage({ type: 'assistant', content: '**Bold text**' })],
        sessionId: 'sess-123',
        totalMessages: 1,
      });
    });

    it('renders markdown by default for assistant messages', async () => {
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByTestId('markdown-content')).toBeDefined();
      });
    });

    it('switches to raw text when Markdown toggle is clicked', async () => {
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByTestId('markdown-content')).toBeDefined();
      });

      // Initial aria-label is "Show raw text" since markdown is ON by default
      const mdBtn = screen.getByRole('button', { name: 'Show raw text' });
      fireEvent.click(mdBtn);

      await waitFor(() => {
        expect(screen.queryByTestId('markdown-content')).toBeNull();
        expect(screen.getByTestId('ansi-span')).toBeDefined();
      });
    });

    it('Markdown button has aria-pressed reflecting state', async () => {
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByText('Claude')).toBeDefined();
      });

      // When renderMarkdown=true, aria-label is "Show raw text"
      const mdBtn = screen.getByRole('button', { name: 'Show raw text' });
      expect(mdBtn.getAttribute('aria-pressed')).toBe('true');

      fireEvent.click(mdBtn);
      // After click, aria-label changes to "Render markdown"
      const mdBtnAfter = screen.getByRole('button', { name: 'Render markdown' });
      expect(mdBtnAfter.getAttribute('aria-pressed')).toBe('false');
    });
  });

  // =========================================================================
  // 6. View mode switching
  // =========================================================================
  describe('view mode switching', () => {
    it('shows messages view by default', async () => {
      mockGetSessionContent.mockResolvedValue({
        messages: [makeMessage({ type: 'human', content: 'hello' })],
        sessionId: 'sess-123',
        totalMessages: 1,
      });
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByText('You')).toBeDefined();
      });
      expect(screen.queryByTestId('terminal-view')).toBeNull();
    });

    it('switches to terminal view when Terminal button is clicked', async () => {
      renderSessionContent();

      const terminalBtn = screen.getByText('Terminal');
      fireEvent.click(terminalBtn);

      expect(screen.getByTestId('terminal-view')).toBeDefined();
    });

    it('hides filter buttons in terminal view', async () => {
      renderSessionContent();

      const terminalBtn = screen.getByText('Terminal');
      fireEvent.click(terminalBtn);

      expect(screen.queryByRole('button', { name: /thinking/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /tool/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /progress/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /markdown/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /refresh/i })).toBeNull();
    });

    it('switches back to messages view', async () => {
      mockGetSessionContent.mockResolvedValue({
        messages: [makeMessage({ type: 'human', content: 'back again' })],
        sessionId: 'sess-123',
        totalMessages: 1,
      });
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByText('You')).toBeDefined();
      });

      // Switch to terminal
      fireEvent.click(screen.getByText('Terminal'));
      expect(screen.getByTestId('terminal-view')).toBeDefined();

      // Switch back to messages
      fireEvent.click(screen.getByText('Messages'));
      expect(screen.queryByTestId('terminal-view')).toBeNull();
      expect(screen.getByText('You')).toBeDefined();
    });

    it('passes rawOutput and isActive to TerminalView', async () => {
      mockUseSessionStream.mockReturnValue({
        ...defaultStreamReturn,
        rawOutput: ['chunk1', 'chunk2'],
      });
      renderSessionContent({ isActive: true });

      fireEvent.click(screen.getByText('Terminal'));

      expect(screen.getByTestId('terminal-view')).toBeDefined();
      expect(screen.getByText('Terminal (2 chunks) active')).toBeDefined();
    });
  });

  // =========================================================================
  // 7. Load older messages
  // =========================================================================
  describe('load older messages', () => {
    it('shows "Load older messages" button when there are more messages', async () => {
      mockGetSessionContent.mockResolvedValue({
        messages: [makeMessage({ type: 'human', content: 'recent' })],
        sessionId: 'sess-123',
        totalMessages: 50,
      });
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByText(/Load older messages/)).toBeDefined();
      });
      expect(screen.getByText(/49 more/)).toBeDefined();
    });

    it('does not show "Load older messages" when all messages are loaded', async () => {
      mockGetSessionContent.mockResolvedValue({
        messages: [makeMessage({ type: 'human', content: 'all loaded' })],
        sessionId: 'sess-123',
        totalMessages: 1,
      });
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByText('You')).toBeDefined();
      });
      expect(screen.queryByText(/Load older messages/)).toBeNull();
    });

    it('fetches older messages when button is clicked', async () => {
      mockGetSessionContent
        .mockResolvedValueOnce({
          messages: [makeMessage({ type: 'human', content: 'recent msg' })],
          sessionId: 'sess-123',
          totalMessages: 10,
        })
        .mockResolvedValueOnce({
          messages: [makeMessage({ type: 'human', content: 'older msg' })],
          sessionId: 'sess-123',
          totalMessages: 10,
        });
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByText(/Load older messages/)).toBeDefined();
      });

      fireEvent.click(screen.getByText(/Load older messages/));

      await waitFor(() => {
        expect(mockGetSessionContent).toHaveBeenCalledTimes(2);
      });

      // Second call should include offset
      const secondCall = mockGetSessionContent.mock.calls[1] as unknown[];
      expect(secondCall?.[1]).toEqual(expect.objectContaining({ offset: 1 }));
    });
  });

  // =========================================================================
  // 8. Error state
  // =========================================================================
  describe('error state', () => {
    it('shows ErrorBanner when API call fails', async () => {
      mockGetSessionContent.mockRejectedValue(new Error('Network error'));
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByTestId('error-banner')).toBeDefined();
        expect(screen.getByText('Network error')).toBeDefined();
      });
    });

    it('shows stringified error for non-Error exceptions', async () => {
      mockGetSessionContent.mockRejectedValue('string error');
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByText('string error')).toBeDefined();
      });
    });
  });

  // =========================================================================
  // 9. Refresh button
  // =========================================================================
  describe('refresh button', () => {
    it('renders a Refresh button in messages view', async () => {
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /refresh/i })).toBeDefined();
      });
    });

    it('calls fetchLatest when Refresh is clicked', async () => {
      mockGetSessionContent.mockResolvedValue({
        messages: [makeMessage({ type: 'human', content: 'msg' })],
        sessionId: 'sess-123',
        totalMessages: 1,
      });
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByText('You')).toBeDefined();
      });

      mockGetSessionContent.mockClear();
      mockGetSessionContent.mockResolvedValue({
        messages: [makeMessage({ type: 'human', content: 'refreshed' })],
        sessionId: 'sess-123',
        totalMessages: 1,
      });

      fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

      await waitFor(() => {
        expect(mockGetSessionContent).toHaveBeenCalledTimes(1);
      });
    });

    it('ErrorBanner retry button refetches', async () => {
      mockGetSessionContent.mockRejectedValueOnce(new Error('fail'));
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByTestId('error-banner')).toBeDefined();
      });

      mockGetSessionContent.mockResolvedValueOnce({
        messages: [],
        sessionId: 'sess-123',
        totalMessages: 0,
      });

      fireEvent.click(screen.getByText('Retry'));

      await waitFor(() => {
        expect(mockGetSessionContent).toHaveBeenCalledTimes(2);
      });
    });
  });

  // =========================================================================
  // 10. Optimistic messages
  // =========================================================================
  describe('optimistic messages', () => {
    it('shows optimistic message when lastSentMessage is provided', async () => {
      mockGetSessionContent.mockResolvedValue({
        messages: [],
        sessionId: 'sess-123',
        totalMessages: 0,
      });
      const { rerender } = render(<SessionContent {...defaultProps} lastSentMessage={null} />);

      await waitFor(() => {
        expect(screen.getByText('No messages yet')).toBeDefined();
      });

      rerender(
        <SessionContent
          {...defaultProps}
          lastSentMessage={{ text: 'Hello from user', ts: Date.now() }}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('Hello from user')).toBeDefined();
        expect(screen.getByText('sending...')).toBeDefined();
      });
    });

    it('displays "You" label on optimistic messages', async () => {
      mockGetSessionContent.mockResolvedValue({
        messages: [],
        sessionId: 'sess-123',
        totalMessages: 0,
      });
      const { rerender } = render(<SessionContent {...defaultProps} lastSentMessage={null} />);

      await waitFor(() => {
        expect(screen.getByText('No messages yet')).toBeDefined();
      });

      rerender(
        <SessionContent
          {...defaultProps}
          lastSentMessage={{ text: 'optimistic text', ts: Date.now() }}
        />,
      );

      await waitFor(() => {
        // The optimistic message area has a "You" label
        const youLabels = screen.getAllByText('You');
        expect(youLabels.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  // =========================================================================
  // 11. Message type routing
  // =========================================================================
  describe('message type routing', () => {
    it('renders ThinkingBlock for thinking messages', async () => {
      mockGetSessionContent.mockResolvedValue({
        messages: [makeMessage({ type: 'thinking', content: 'Deep thought' })],
        sessionId: 'sess-123',
        totalMessages: 1,
      });
      // Must enable showThinking — start with active false (showProgress off by default)
      renderSessionContent();

      // Toggle thinking on
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /thinking/i })).toBeDefined();
      });
      fireEvent.click(screen.getByRole('button', { name: /thinking/i }));

      await waitFor(() => {
        expect(screen.getByTestId('thinking-block')).toBeDefined();
        expect(screen.getByText('Deep thought')).toBeDefined();
      });
    });

    it('renders ProgressIndicator for progress messages', async () => {
      mockGetSessionContent.mockResolvedValue({
        messages: [makeMessage({ type: 'progress', content: 'Working...', toolName: 'Bash' })],
        sessionId: 'sess-123',
        totalMessages: 1,
      });
      renderSessionContent({ isActive: true }); // showProgress defaults to true when active

      await waitFor(() => {
        expect(screen.getByTestId('progress-indicator')).toBeDefined();
        expect(screen.getByText('Working...')).toBeDefined();
      });
    });

    it('renders SubagentBlock for subagent messages', async () => {
      mockGetSessionContent.mockResolvedValue({
        messages: [
          makeMessage({
            type: 'subagent',
            content: 'Subagent task',
            toolName: 'Task',
            subagentId: 'sub-1',
          } as Partial<SessionContentMessage> & { type: string }),
        ],
        sessionId: 'sess-123',
        totalMessages: 1,
      });
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByTestId('subagent-block')).toBeDefined();
        expect(screen.getByText('Subagent task')).toBeDefined();
      });
    });

    it('renders TodoBlock for todo messages', async () => {
      mockGetSessionContent.mockResolvedValue({
        messages: [makeMessage({ type: 'todo', content: 'Fix the bug' })],
        sessionId: 'sess-123',
        totalMessages: 1,
      });
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByTestId('todo-block')).toBeDefined();
        expect(screen.getByText('Fix the bug')).toBeDefined();
      });
    });

    it('renders InlineMessage for human messages', async () => {
      mockGetSessionContent.mockResolvedValue({
        messages: [makeMessage({ type: 'human', content: 'User says hi' })],
        sessionId: 'sess-123',
        totalMessages: 1,
      });
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByText('You')).toBeDefined();
      });
    });

    it('renders InlineMessage for assistant messages', async () => {
      mockGetSessionContent.mockResolvedValue({
        messages: [makeMessage({ type: 'assistant', content: 'AI reply' })],
        sessionId: 'sess-123',
        totalMessages: 1,
      });
      renderSessionContent();

      await waitFor(() => {
        expect(screen.getByText('Claude')).toBeDefined();
      });
    });
  });

  // =========================================================================
  // 12. Streaming indicator
  // =========================================================================
  describe('streaming indicator', () => {
    it('shows streaming dot with "Streaming" text when SSE is connected and active', async () => {
      mockUseSessionStream.mockReturnValue({
        ...defaultStreamReturn,
        connected: true,
      });
      renderSessionContent({ isActive: true });

      await waitFor(() => {
        // The span contains "● Streaming" — use substring matcher
        expect(screen.getByTitle('SSE streaming live')).toBeDefined();
        expect(screen.getByTitle('SSE streaming live').textContent).toContain('Streaming');
      });
    });

    it('shows "Live" text when active but SSE not connected (polling fallback)', async () => {
      mockUseSessionStream.mockReturnValue({
        ...defaultStreamReturn,
        connected: false,
      });
      renderSessionContent({ isActive: true });

      await waitFor(() => {
        // The span contains "● Live" — use title attribute to locate it
        expect(screen.getByTitle('Polling every 3s')).toBeDefined();
        expect(screen.getByTitle('Polling every 3s').textContent).toContain('Live');
      });
    });

    it('does not show streaming indicator when session is inactive', async () => {
      mockUseSessionStream.mockReturnValue({
        ...defaultStreamReturn,
        connected: false,
      });
      renderSessionContent({ isActive: false });

      await waitFor(() => {
        // Wait for initial loading to resolve
        expect(screen.queryAllByTestId('skeleton')).toHaveLength(0);
      });

      expect(screen.queryByText('Streaming')).toBeNull();
      expect(screen.queryByText('Live')).toBeNull();
    });

    it('renders live streaming output block when connected with output', async () => {
      mockUseSessionStream.mockReturnValue({
        ...defaultStreamReturn,
        connected: true,
        streamOutput: ['Hello ', 'World'],
      });
      mockGetSessionContent.mockResolvedValue({
        messages: [],
        sessionId: 'sess-123',
        totalMessages: 0,
      });
      renderSessionContent({ isActive: true });

      await waitFor(() => {
        // The streaming output block shows "Streaming" label inside the green block
        const streamLabels = screen.getAllByText('Streaming');
        expect(streamLabels.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('does not render live streaming output block when no stream output', async () => {
      mockUseSessionStream.mockReturnValue({
        ...defaultStreamReturn,
        connected: true,
        streamOutput: [],
      });
      mockGetSessionContent.mockResolvedValue({
        messages: [makeMessage({ type: 'human', content: 'hi' })],
        sessionId: 'sess-123',
        totalMessages: 1,
      });
      renderSessionContent({ isActive: true });

      await waitFor(() => {
        expect(screen.getByText('You')).toBeDefined();
      });

      // Only the status "Streaming" label should be present, not the output block
      const ansiTexts = screen.queryAllByTestId('ansi-text');
      expect(ansiTexts).toHaveLength(0);
    });
  });

  // =========================================================================
  // 13. useSessionStream hook wiring
  // =========================================================================
  describe('useSessionStream wiring', () => {
    it('passes rcSessionId and enabled=isActive to useSessionStream', () => {
      renderSessionContent({ isActive: true });

      expect(mockUseSessionStream).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'rc-456',
          enabled: true,
        }),
      );
    });

    it('passes enabled=false when isActive is false', () => {
      renderSessionContent({ isActive: false });

      expect(mockUseSessionStream).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'rc-456',
          enabled: false,
        }),
      );
    });
  });

  // =========================================================================
  // 14. API call parameters
  // =========================================================================
  describe('API call parameters', () => {
    it('passes sessionId, machineId, projectPath, and limit to getSessionContent', async () => {
      renderSessionContent();

      await waitFor(() => {
        expect(mockGetSessionContent).toHaveBeenCalledWith('sess-123', {
          machineId: 'machine-1',
          projectPath: '/project',
          limit: 200,
        });
      });
    });
  });
});

// ===========================================================================
// InlineMessage sub-component
// ===========================================================================
describe('InlineMessage', () => {
  it('renders the label from message type', () => {
    render(
      <InlineMessage
        message={makeMessage({ type: 'human', content: 'Hello' })}
        renderMarkdown={false}
      />,
    );
    expect(screen.getByText('You')).toBeDefined();
  });

  it('renders the label "Claude" for assistant messages', () => {
    render(
      <InlineMessage
        message={makeMessage({ type: 'assistant', content: 'Reply' })}
        renderMarkdown={false}
      />,
    );
    expect(screen.getByText('Claude')).toBeDefined();
  });

  it('renders toolName when present', () => {
    render(
      <InlineMessage
        message={makeMessage({ type: 'tool_use', content: 'content', toolName: 'Read' })}
        renderMarkdown={false}
      />,
    );
    expect(screen.getByText('Read')).toBeDefined();
  });

  it('renders formatted timestamp when present', () => {
    render(
      <InlineMessage
        message={makeMessage({ type: 'human', content: 'Hi', timestamp: '2026-03-06T10:00:00Z' })}
        renderMarkdown={false}
      />,
    );
    expect(screen.getByText('time:2026-03-06T10:00:00Z')).toBeDefined();
  });

  it('renders MarkdownContent for assistant message with renderMarkdown=true', () => {
    render(
      <InlineMessage
        message={makeMessage({ type: 'assistant', content: '**bold**' })}
        renderMarkdown={true}
      />,
    );
    expect(screen.getByTestId('markdown-content')).toBeDefined();
  });

  it('renders MarkdownContent for human message with renderMarkdown=true', () => {
    render(
      <InlineMessage
        message={makeMessage({ type: 'human', content: '_italic_' })}
        renderMarkdown={true}
      />,
    );
    expect(screen.getByTestId('markdown-content')).toBeDefined();
  });

  it('renders AnsiSpan for tool_use message even with renderMarkdown=true', () => {
    render(
      <InlineMessage
        message={makeMessage({ type: 'tool_use', content: 'tool content' })}
        renderMarkdown={true}
      />,
    );
    expect(screen.queryByTestId('markdown-content')).toBeNull();
    expect(screen.getByTestId('ansi-span')).toBeDefined();
  });

  it('renders AnsiSpan when renderMarkdown=false', () => {
    render(
      <InlineMessage
        message={makeMessage({ type: 'assistant', content: 'plain text' })}
        renderMarkdown={false}
      />,
    );
    expect(screen.queryByTestId('markdown-content')).toBeNull();
    expect(screen.getByTestId('ansi-span')).toBeDefined();
  });

  it('truncates long content and shows "Show all" button', () => {
    const longContent = 'A'.repeat(1000);
    render(
      <InlineMessage
        message={makeMessage({ type: 'assistant', content: longContent })}
        renderMarkdown={false}
      />,
    );
    expect(screen.getByText(/Show all/)).toBeDefined();
    expect(screen.getByText(/1k chars/)).toBeDefined();
  });

  it('expands truncated content when "Show all" is clicked', () => {
    const longContent = 'A'.repeat(1000);
    render(
      <InlineMessage
        message={makeMessage({ type: 'assistant', content: longContent })}
        renderMarkdown={false}
      />,
    );

    fireEvent.click(screen.getByText(/Show all/));
    expect(screen.getByText('Show less')).toBeDefined();
  });

  it('collapses expanded content when "Show less" is clicked', () => {
    const longContent = 'A'.repeat(1000);
    render(
      <InlineMessage
        message={makeMessage({ type: 'assistant', content: longContent })}
        renderMarkdown={false}
      />,
    );

    fireEvent.click(screen.getByText(/Show all/));
    expect(screen.getByText('Show less')).toBeDefined();

    fireEvent.click(screen.getByText('Show less'));
    expect(screen.getByText(/Show all/)).toBeDefined();
  });

  it('does not show expand button for short content', () => {
    render(
      <InlineMessage
        message={makeMessage({ type: 'assistant', content: 'Short msg' })}
        renderMarkdown={false}
      />,
    );
    expect(screen.queryByText(/Show all/)).toBeNull();
    expect(screen.queryByText('Show less')).toBeNull();
  });

  it('handles empty content gracefully', () => {
    render(
      <InlineMessage
        message={makeMessage({ type: 'assistant', content: '' })}
        renderMarkdown={false}
      />,
    );
    expect(screen.getByText('Claude')).toBeDefined();
  });

  it('handles undefined content gracefully', () => {
    render(
      <InlineMessage
        message={{ type: 'assistant' } as SessionContentMessage}
        renderMarkdown={false}
      />,
    );
    expect(screen.getByText('Claude')).toBeDefined();
  });
});
