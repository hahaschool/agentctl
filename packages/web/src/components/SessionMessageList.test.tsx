import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock ALL external dependencies BEFORE importing the component
// ---------------------------------------------------------------------------

// Mock @/lib/utils
vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// Mock @/components/ui/skeleton
vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
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
      subagent: { label: 'Subagent', textClass: 'text-orange', bubbleClass: 'bg-orange' },
      todo: { label: 'Tasks', textClass: 'text-blue', bubbleClass: 'bg-blue' },
    };
    return map[type] ?? { label: type, textClass: 'text-muted', bubbleClass: 'bg-muted' };
  },
}));

// Mock @/lib/format-utils
vi.mock('../lib/format-utils', () => ({
  formatNumber: (n: number | string | null | undefined) => {
    if (n == null) return '0';
    return String(n);
  },
  formatTime: (ts: string) => `time:${ts}`,
}));

// Mock use-hotkeys
vi.mock('../hooks/use-hotkeys', () => ({
  useHotkeys: () => {},
}));

// Mock child components as simple stubs
vi.mock('./ThinkingBlock', () => ({
  ThinkingBlock: ({ content, timestamp }: { content?: string; timestamp?: string }) => (
    <div data-testid="thinking-block">
      {content}
      {timestamp && <span data-testid="thinking-ts">{timestamp}</span>}
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
      {toolName && <span data-testid="progress-tool">{toolName}</span>}
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
      {subagentId && <span data-testid="subagent-id">{subagentId}</span>}
    </div>
  ),
}));

vi.mock('./TodoBlock', () => ({
  TodoBlock: ({ content }: { content?: string; timestamp?: string }) => (
    <div data-testid="todo-block">{content}</div>
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
  ErrorBanner: ({ message }: { message: string }) => (
    <div data-testid="error-banner">{message}</div>
  ),
}));

// ---------------------------------------------------------------------------
// NOW import the component under test
// ---------------------------------------------------------------------------

import type { SessionContentMessage } from '../lib/api';
import { MessageList, ViewModeToggle } from './SessionMessageList';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMsg(
  overrides: Partial<SessionContentMessage> & { type: string },
): SessionContentMessage {
  return {
    content: '',
    ...overrides,
  } as SessionContentMessage;
}

const baseTs = '2026-03-07T10:00:00Z';

/** Default props for MessageList. */
function defaultProps(
  overrides?: Partial<Parameters<typeof MessageList>[0]>,
): Parameters<typeof MessageList>[0] {
  return {
    messages: [],
    totalMessages: 0,
    isLoading: false,
    isActive: false,
    viewMode: 'messages' as const,
    onViewModeChange: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

// ===== ViewModeToggle =====

describe('ViewModeToggle', () => {
  it('renders Messages and Terminal buttons', () => {
    render(<ViewModeToggle viewMode="messages" onViewModeChange={vi.fn()} />);
    expect(screen.getByText('Messages')).toBeDefined();
    expect(screen.getByText('Terminal')).toBeDefined();
  });

  it('applies primary styling to active Messages button', () => {
    render(<ViewModeToggle viewMode="messages" onViewModeChange={vi.fn()} />);
    const btn = screen.getByText('Messages');
    expect(btn.className).toContain('bg-primary');
  });

  it('applies primary styling to active Terminal button', () => {
    render(<ViewModeToggle viewMode="terminal" onViewModeChange={vi.fn()} />);
    const btn = screen.getByText('Terminal');
    expect(btn.className).toContain('bg-primary');
  });

  it('applies muted styling to inactive button', () => {
    render(<ViewModeToggle viewMode="messages" onViewModeChange={vi.fn()} />);
    const btn = screen.getByText('Terminal');
    expect(btn.className).toContain('bg-muted');
  });

  it('calls onViewModeChange("terminal") when Terminal clicked', () => {
    const handler = vi.fn();
    render(<ViewModeToggle viewMode="messages" onViewModeChange={handler} />);
    fireEvent.click(screen.getByText('Terminal'));
    expect(handler).toHaveBeenCalledWith('terminal');
  });

  it('calls onViewModeChange("messages") when Messages clicked', () => {
    const handler = vi.fn();
    render(<ViewModeToggle viewMode="terminal" onViewModeChange={handler} />);
    fireEvent.click(screen.getByText('Messages'));
    expect(handler).toHaveBeenCalledWith('messages');
  });
});

// ===== MessageList basic rendering =====

describe('MessageList basic rendering', () => {
  it('shows loading skeleton when isLoading=true', () => {
    render(<MessageList {...defaultProps({ isLoading: true })} />);
    const skeletons = screen.getAllByTestId('skeleton');
    expect(skeletons.length).toBeGreaterThanOrEqual(4);
  });

  it('shows error banner when error prop provided', () => {
    render(<MessageList {...defaultProps({ error: 'Something went wrong' })} />);
    const banner = screen.getByTestId('error-banner');
    expect(banner.textContent).toBe('Something went wrong');
  });

  it('shows "No messages yet" when empty and no search', () => {
    render(<MessageList {...defaultProps({ messages: [], totalMessages: 0 })} />);
    expect(screen.getByText('No messages yet')).toBeDefined();
  });

  it('shows message count in toolbar', () => {
    const msgs = [
      makeMsg({ type: 'human', content: 'Hello', timestamp: baseTs }),
      makeMsg({ type: 'assistant', content: 'Hi', timestamp: baseTs }),
    ];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 2 })} />);
    expect(screen.getByText('2 messages')).toBeDefined();
  });

  it('shows partial count when totalMessages > messages.length', () => {
    const msgs = [makeMsg({ type: 'human', content: 'Hello', timestamp: baseTs })];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 100 })} />);
    expect(screen.getByText('1 / 100 messages')).toBeDefined();
  });

  it('shows "Load older messages" button when totalMessages > messages.length', () => {
    const msgs = [makeMsg({ type: 'human', content: 'Hello', timestamp: baseTs })];
    const onLoadMore = vi.fn();
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 50, onLoadMore })} />);
    const loadBtn = screen.getByText(/Load older messages/);
    expect(loadBtn).toBeDefined();
    fireEvent.click(loadBtn);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does not show "Load older messages" when all messages are loaded', () => {
    const msgs = [makeMsg({ type: 'human', content: 'Hello', timestamp: baseTs })];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1 })} />);
    expect(screen.queryByText(/Load older messages/)).toBeNull();
  });

  it('shows both loading skeleton and error when both present', () => {
    render(<MessageList {...defaultProps({ isLoading: true, error: 'Network error' })} />);
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('error-banner').textContent).toBe('Network error');
  });
});

// ===== MessageList message types =====

describe('MessageList message types', () => {
  it('renders human messages', () => {
    const msgs = [makeMsg({ type: 'human', content: 'Hello world', timestamp: baseTs })];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1 })} />);
    expect(screen.getByText('Hello world')).toBeDefined();
  });

  it('renders assistant messages', () => {
    const msgs = [makeMsg({ type: 'assistant', content: 'I can help', timestamp: baseTs })];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1 })} />);
    expect(screen.getByText('I can help')).toBeDefined();
  });

  it('renders thinking messages when showThinking is true (default)', () => {
    const msgs = [makeMsg({ type: 'thinking', content: 'Let me think...', timestamp: baseTs })];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1 })} />);
    const block = screen.getByTestId('thinking-block');
    expect(block.textContent).toContain('Let me think...');
  });

  it('renders subagent messages', () => {
    const msgs = [
      makeMsg({
        type: 'subagent',
        content: 'Delegated work',
        timestamp: baseTs,
        toolName: 'sub-1',
      }),
    ];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1 })} />);
    const block = screen.getByTestId('subagent-block');
    expect(block.textContent).toContain('Delegated work');
  });

  it('renders todo messages', () => {
    const msgs = [makeMsg({ type: 'todo', content: 'Task list', timestamp: baseTs })];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1 })} />);
    const block = screen.getByTestId('todo-block');
    expect(block.textContent).toContain('Task list');
  });

  it('hides tool_use messages by default (showTools starts false)', () => {
    const msgs = [
      makeMsg({ type: 'tool_use', content: 'Read file', toolName: 'Read', timestamp: baseTs }),
    ];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1 })} />);
    expect(screen.queryByText('Read file')).toBeNull();
    // Also no tool label rendered
    expect(screen.queryByText('Tool Call')).toBeNull();
  });

  it('hides tool_result messages by default', () => {
    const msgs = [
      makeMsg({
        type: 'tool_result',
        content: 'file content',
        toolName: 'Read',
        toolId: 'tool-1',
        timestamp: baseTs,
      }),
    ];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1 })} />);
    expect(screen.queryByText('file content')).toBeNull();
  });

  it('shows tool_use messages after clicking Tools toggle', () => {
    const msgs = [
      makeMsg({
        type: 'tool_use',
        content: 'Read command',
        toolName: 'Read',
        toolId: 'tool-1',
        timestamp: baseTs,
      }),
    ];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1 })} />);

    // Click the Tools toggle button (aria-label contains "tool messages")
    const toolsBtn = screen.getByLabelText(/tool messages/i);
    fireEvent.click(toolsBtn);

    // Now tool message should be visible — the collapsed view shows the toolName
    expect(screen.getByText('Read')).toBeDefined();
  });

  it('renders progress messages when isActive (showProgress starts as isActive)', () => {
    const msgs = [makeMsg({ type: 'progress', content: 'Working on it...', timestamp: baseTs })];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1, isActive: true })} />);
    const block = screen.getByTestId('progress-indicator');
    expect(block.textContent).toContain('Working on it...');
  });

  it('hides progress messages when not active (showProgress starts false)', () => {
    const msgs = [makeMsg({ type: 'progress', content: 'Working on it...', timestamp: baseTs })];
    render(
      <MessageList {...defaultProps({ messages: msgs, totalMessages: 1, isActive: false })} />,
    );
    expect(screen.queryByTestId('progress-indicator')).toBeNull();
  });
});

// ===== MessageList filter toggles =====

describe('MessageList filter toggles', () => {
  it('clicking Thinking button toggles thinking visibility off', () => {
    const msgs = [makeMsg({ type: 'thinking', content: 'Deep thought', timestamp: baseTs })];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1 })} />);

    // Initially visible
    expect(screen.getByTestId('thinking-block')).toBeDefined();

    // Click to hide
    const btn = screen.getByLabelText(/thinking/i);
    fireEvent.click(btn);

    expect(screen.queryByTestId('thinking-block')).toBeNull();
  });

  it('clicking Tools button toggles tool visibility on', () => {
    const msgs = [
      makeMsg({
        type: 'tool_use',
        content: 'Read file',
        toolName: 'Read',
        toolId: 'tool-1',
        timestamp: baseTs,
      }),
    ];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1 })} />);

    // Initially hidden
    expect(screen.queryByText('Tool Call')).toBeNull();

    // Click to show
    const btn = screen.getByLabelText(/tool messages/i);
    fireEvent.click(btn);

    // Now visible — collapsed tool shows toolName
    expect(screen.getByText('Read')).toBeDefined();
  });

  it('clicking Progress button toggles progress visibility', () => {
    const msgs = [makeMsg({ type: 'progress', content: 'Building...', timestamp: baseTs })];
    // Start with isActive=true so showProgress defaults to true
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1, isActive: true })} />);

    expect(screen.getByTestId('progress-indicator')).toBeDefined();

    // Toggle off
    const btn = screen.getByLabelText(/progress/i);
    fireEvent.click(btn);

    expect(screen.queryByTestId('progress-indicator')).toBeNull();
  });

  it('clicking Markdown button toggles markdown rendering off', () => {
    const msgs = [makeMsg({ type: 'assistant', content: '**bold text**', timestamp: baseTs })];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1 })} />);

    // Markdown rendering is on by default — should use MarkdownContent
    expect(screen.getByTestId('markdown-content')).toBeDefined();

    // Toggle off — when renderMarkdown is true, aria-label is "Show raw text"
    const btn = screen.getByLabelText('Show raw text');
    fireEvent.click(btn);

    // Now should render via AnsiSpan instead
    expect(screen.queryByTestId('markdown-content')).toBeNull();
    const ansiSpans = screen.getAllByTestId('ansi-span');
    const found = ansiSpans.some((el) => el.textContent === '**bold text**');
    expect(found).toBe(true);
  });

  it('toggle buttons reflect correct aria-pressed state', () => {
    render(
      <MessageList
        {...defaultProps({
          messages: [makeMsg({ type: 'human', content: 'hi', timestamp: baseTs })],
          totalMessages: 1,
        })}
      />,
    );

    const thinkingBtn = screen.getByLabelText(/thinking/i);
    const toolsBtn = screen.getByLabelText(/tool messages/i);

    // Thinking starts true, tools starts false
    expect(thinkingBtn.getAttribute('aria-pressed')).toBe('true');
    expect(toolsBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('double-clicking Thinking restores visibility', () => {
    const msgs = [makeMsg({ type: 'thinking', content: 'Deep thought', timestamp: baseTs })];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1 })} />);

    const btn = screen.getByLabelText(/thinking/i);

    // Toggle off
    fireEvent.click(btn);
    expect(screen.queryByTestId('thinking-block')).toBeNull();

    // Toggle back on
    fireEvent.click(btn);
    expect(screen.getByTestId('thinking-block')).toBeDefined();
  });
});

// ===== MessageList search =====

describe('MessageList search', () => {
  const searchMessages = [
    makeMsg({ type: 'human', content: 'Find the bug', timestamp: baseTs }),
    makeMsg({ type: 'assistant', content: 'I found the issue', timestamp: baseTs }),
    makeMsg({ type: 'human', content: 'Fix the bug please', timestamp: baseTs }),
  ];

  it('search input filters messages by content', () => {
    render(<MessageList {...defaultProps({ messages: searchMessages, totalMessages: 3 })} />);

    const input = screen.getByLabelText('Search messages');
    fireEvent.change(input, { target: { value: 'bug' } });

    // Only messages containing "bug" should remain
    expect(screen.getByText('Find the bug')).toBeDefined();
    expect(screen.getByText('Fix the bug please')).toBeDefined();
    expect(screen.queryByText('I found the issue')).toBeNull();
  });

  it('shows match count when search is active', () => {
    render(<MessageList {...defaultProps({ messages: searchMessages, totalMessages: 3 })} />);

    const input = screen.getByLabelText('Search messages');
    fireEvent.change(input, { target: { value: 'bug' } });

    expect(screen.getByText('2 matches')).toBeDefined();
  });

  it('shows singular "match" for single result', () => {
    render(<MessageList {...defaultProps({ messages: searchMessages, totalMessages: 3 })} />);

    const input = screen.getByLabelText('Search messages');
    fireEvent.change(input, { target: { value: 'issue' } });

    expect(screen.getByText('1 match')).toBeDefined();
  });

  it('shows "No messages match" when search yields no results', () => {
    render(<MessageList {...defaultProps({ messages: searchMessages, totalMessages: 3 })} />);

    const input = screen.getByLabelText('Search messages');
    fireEvent.change(input, { target: { value: 'zzzznotfound' } });

    expect(screen.getByText(/No messages match/)).toBeDefined();
  });

  it('clears search on Escape key', () => {
    render(<MessageList {...defaultProps({ messages: searchMessages, totalMessages: 3 })} />);

    const input = screen.getByLabelText('Search messages');
    fireEvent.change(input, { target: { value: 'bug' } });

    // Verify filtered
    expect(screen.queryByText('I found the issue')).toBeNull();

    // Press Escape
    fireEvent.keyDown(input, { key: 'Escape' });

    // All messages should be back
    expect(screen.getByText('I found the issue')).toBeDefined();
    expect(screen.getByText('Find the bug')).toBeDefined();
    expect(screen.getByText('Fix the bug please')).toBeDefined();
  });

  it('search is case-insensitive', () => {
    render(<MessageList {...defaultProps({ messages: searchMessages, totalMessages: 3 })} />);

    const input = screen.getByLabelText('Search messages');
    fireEvent.change(input, { target: { value: 'BUG' } });

    expect(screen.getByText('Find the bug')).toBeDefined();
    expect(screen.getByText('Fix the bug please')).toBeDefined();
  });

  it('does not show match count when search is empty', () => {
    render(<MessageList {...defaultProps({ messages: searchMessages, totalMessages: 3 })} />);

    // No "match" / "matches" text should appear
    expect(screen.queryByText(/\d+ match/)).toBeNull();
  });

  it('shows "shown" count in toolbar when filters reduce visible messages', () => {
    render(<MessageList {...defaultProps({ messages: searchMessages, totalMessages: 3 })} />);

    const input = screen.getByLabelText('Search messages');
    fireEvent.change(input, { target: { value: 'bug' } });

    // Toolbar should show "2 shown" since we filtered from 3 to 2
    expect(screen.getByText('2 shown')).toBeDefined();
  });
});

// ===== MessageList auto-scroll / follow output =====

describe('MessageList scroll behavior', () => {
  it('shows auto-scroll toggle button in toolbar', () => {
    const msgs = [makeMsg({ type: 'human', content: 'Hello', timestamp: baseTs })];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1, isActive: true })} />);

    const autoScrollBtn = screen.getByLabelText(/auto-scroll/i);
    expect(autoScrollBtn).toBeDefined();
  });

  it('shows "Following" indicator when active and auto-scroll is on', () => {
    const msgs = [makeMsg({ type: 'human', content: 'Hello', timestamp: baseTs })];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1, isActive: true })} />);
    expect(screen.getByText('Following')).toBeDefined();
  });

  it('does not show "Following" indicator when not active', () => {
    const msgs = [makeMsg({ type: 'human', content: 'Hello', timestamp: baseTs })];
    render(
      <MessageList {...defaultProps({ messages: msgs, totalMessages: 1, isActive: false })} />,
    );
    expect(screen.queryByText('Following')).toBeNull();
  });
});

// ===== Tool pairing =====

describe('MessageList tool pairing', () => {
  it('pairs tool_use + tool_result by toolId into a single ToolPairBlock', () => {
    const msgs = [
      makeMsg({
        type: 'tool_use',
        content: 'cat file.ts',
        toolName: 'Read',
        toolId: 'tool-abc',
        timestamp: baseTs,
      }),
      makeMsg({
        type: 'tool_result',
        content: 'export default {}',
        toolName: 'Read',
        toolId: 'tool-abc',
        timestamp: baseTs,
      }),
    ];

    // Must toggle tools on to see them
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 2 })} />);
    const toolsBtn = screen.getByLabelText(/tool messages/i);
    fireEvent.click(toolsBtn);

    // The pair block should show the tool name and "click to expand"
    expect(screen.getByText('Read')).toBeDefined();
    // There should be exactly one "click to expand" (paired), not two separate blocks
    const expandTexts = screen.getAllByText('click to expand');
    expect(expandTexts).toHaveLength(1);
  });

  it('shows unpaired tool_use individually when no matching tool_result', () => {
    const msgs = [
      makeMsg({
        type: 'tool_use',
        content: 'cat file.ts',
        toolName: 'Read',
        toolId: 'tool-orphan',
        timestamp: baseTs,
      }),
    ];

    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1 })} />);
    const toolsBtn = screen.getByLabelText(/tool messages/i);
    fireEvent.click(toolsBtn);

    // Should render as individual collapsed message with "click to expand"
    expect(screen.getByText('click to expand')).toBeDefined();
  });

  it('expands tool pair on click and shows Input/Output sections', () => {
    const msgs = [
      makeMsg({
        type: 'tool_use',
        content: 'cat file.ts',
        toolName: 'Read',
        toolId: 'tool-expand',
        timestamp: baseTs,
      }),
      makeMsg({
        type: 'tool_result',
        content: 'const x = 1;',
        toolName: 'Read',
        toolId: 'tool-expand',
        timestamp: baseTs,
      }),
    ];

    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 2 })} />);
    const toolsBtn = screen.getByLabelText(/tool messages/i);
    fireEvent.click(toolsBtn);

    // Click to expand the tool pair
    fireEvent.click(screen.getByText('click to expand'));

    // Expanded view should show Input and Output sections
    expect(screen.getByText('Input')).toBeDefined();
    expect(screen.getByText('Output')).toBeDefined();
    expect(screen.getByText('cat file.ts')).toBeDefined();
    expect(screen.getByText('const x = 1;')).toBeDefined();
  });

  it('collapses expanded tool pair on collapse click', () => {
    const msgs = [
      makeMsg({
        type: 'tool_use',
        content: 'cat file.ts',
        toolName: 'Read',
        toolId: 'tool-collapse',
        timestamp: baseTs,
      }),
      makeMsg({
        type: 'tool_result',
        content: 'const x = 1;',
        toolName: 'Read',
        toolId: 'tool-collapse',
        timestamp: baseTs,
      }),
    ];

    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 2 })} />);
    const toolsBtn = screen.getByLabelText(/tool messages/i);
    fireEvent.click(toolsBtn);

    // Expand
    fireEvent.click(screen.getByText('click to expand'));
    expect(screen.getByText('Input')).toBeDefined();

    // Collapse
    fireEvent.click(screen.getByText('collapse'));
    expect(screen.queryByText('Input')).toBeNull();
    expect(screen.getByText('click to expand')).toBeDefined();
  });

  it('expanded tool pair shows copy button', () => {
    const msgs = [
      makeMsg({
        type: 'tool_use',
        content: 'cat file.ts',
        toolName: 'Read',
        toolId: 'tool-copy',
        timestamp: baseTs,
      }),
      makeMsg({
        type: 'tool_result',
        content: 'const x = 1;',
        toolName: 'Read',
        toolId: 'tool-copy',
        timestamp: baseTs,
      }),
    ];

    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 2 })} />);
    fireEvent.click(screen.getByLabelText(/tool messages/i));
    fireEvent.click(screen.getByText('click to expand'));

    expect(screen.getByText('copy')).toBeDefined();
  });
});

// ===== Date separators =====

describe('MessageList date separators', () => {
  it('shows date separator when messages cross day boundary', () => {
    const day1 = '2026-03-06T23:00:00Z';
    const day2 = '2026-03-07T02:00:00Z';
    const msgs = [
      makeMsg({ type: 'human', content: 'Hello on day 1', timestamp: day1 }),
      makeMsg({ type: 'assistant', content: 'Hello on day 2', timestamp: day2 }),
    ];

    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 2 })} />);

    // A date separator should appear. The exact text depends on locale,
    // but the function formats with toLocaleDateString using month: 'long', day: 'numeric', year: 'numeric'.
    // We look for the year "2026" as a minimal check.
    const body = document.body.textContent ?? '';
    expect(body).toContain('2026');
    // Both messages should be present
    expect(screen.getByText('Hello on day 1')).toBeDefined();
    expect(screen.getByText('Hello on day 2')).toBeDefined();
  });

  it('does not show separator when <1 hour gap within same day', () => {
    const time1 = '2026-03-07T10:00:00Z';
    const time2 = '2026-03-07T10:30:00Z';
    const msgs = [
      makeMsg({ type: 'human', content: 'First msg', timestamp: time1 }),
      makeMsg({ type: 'assistant', content: 'Second msg', timestamp: time2 }),
    ];

    const { container } = render(
      <MessageList {...defaultProps({ messages: msgs, totalMessages: 2 })} />,
    );

    // Both messages should render but no separator dividers between them.
    // DateSeparator has a specific structure: div with "flex items-center gap-3 py-2 my-1"
    // and a text node. We can check for the absence of separator-specific classes.
    expect(screen.getByText('First msg')).toBeDefined();
    expect(screen.getByText('Second msg')).toBeDefined();

    // No separator text should appear — the separator would contain a time/date string
    // that isn't part of the messages. The separator label class is "text-[10px] text-muted-foreground font-medium shrink-0"
    const separators = container.querySelectorAll('.shrink-0');
    // Filter to only separator-like elements (not toolbar elements)
    const separatorLabels = Array.from(separators).filter(
      (el) =>
        el.className.includes('font-medium') &&
        el.className.includes('py-2') === false &&
        el.closest('.border-b') === null,
    );
    // No date separators expected in the message area
    expect(separatorLabels).toHaveLength(0);
  });
});

// ===== Auto-refresh button =====

describe('MessageList auto-refresh', () => {
  it('shows auto-refresh button when isActiveOrStarting', () => {
    render(
      <MessageList
        {...defaultProps({
          isActiveOrStarting: true,
          autoRefresh: true,
          onAutoRefreshChange: vi.fn(),
        })}
      />,
    );
    expect(screen.getByText('Auto-refresh')).toBeDefined();
  });

  it('does not show auto-refresh button when not active or starting', () => {
    render(
      <MessageList
        {...defaultProps({
          isActiveOrStarting: false,
        })}
      />,
    );
    expect(screen.queryByText('Auto-refresh')).toBeNull();
  });

  it('calls onAutoRefreshChange when auto-refresh button is clicked', () => {
    const handler = vi.fn();
    render(
      <MessageList
        {...defaultProps({
          isActiveOrStarting: true,
          autoRefresh: false,
          onAutoRefreshChange: handler,
        })}
      />,
    );
    fireEvent.click(screen.getByText('Auto-refresh'));
    expect(handler).toHaveBeenCalledWith(true);
  });

  it('calls onAutoRefreshChange(false) when already refreshing', () => {
    const handler = vi.fn();
    render(
      <MessageList
        {...defaultProps({
          isActiveOrStarting: true,
          autoRefresh: true,
          onAutoRefreshChange: handler,
        })}
      />,
    );
    fireEvent.click(screen.getByText('Auto-refresh'));
    expect(handler).toHaveBeenCalledWith(false);
  });
});

// ===== Optimistic and pending messages =====

describe('MessageList optimistic messages', () => {
  it('renders optimistic user messages with "sending..." indicator', () => {
    render(
      <MessageList
        {...defaultProps({
          optimisticMessages: ['Hello from me'],
        })}
      />,
    );
    expect(screen.getByText('Hello from me')).toBeDefined();
    expect(screen.getByText('sending...')).toBeDefined();
  });

  it('renders multiple optimistic messages', () => {
    render(
      <MessageList
        {...defaultProps({
          optimisticMessages: ['First', 'Second'],
        })}
      />,
    );
    expect(screen.getByText('First')).toBeDefined();
    expect(screen.getByText('Second')).toBeDefined();
  });

  it('renders pending user messages', () => {
    render(
      <MessageList
        {...defaultProps({
          pendingUserMessages: ['Pending hello'],
        })}
      />,
    );
    expect(screen.getByText('Pending hello')).toBeDefined();
  });

  it('filters out pending messages that duplicate optimistic messages', () => {
    render(
      <MessageList
        {...defaultProps({
          optimisticMessages: ['Same text'],
          pendingUserMessages: ['Same text'],
        })}
      />,
    );
    // "Same text" should appear only once (from optimistic), not twice
    const matches = screen.getAllByText('Same text');
    expect(matches).toHaveLength(1);
  });
});

// ===== Streaming output =====

describe('MessageList streaming output', () => {
  it('renders live streaming block when connected with output', () => {
    render(
      <MessageList
        {...defaultProps({
          streamConnected: true,
          streamOutput: ['line 1\n', 'line 2\n'],
        })}
      />,
    );
    expect(screen.getByText('Streaming')).toBeDefined();
  });

  it('does not render streaming block when not connected', () => {
    render(
      <MessageList
        {...defaultProps({
          streamConnected: false,
          streamOutput: ['line 1\n'],
        })}
      />,
    );
    expect(screen.queryByText('Streaming')).toBeNull();
  });

  it('does not render streaming block when output is empty', () => {
    render(
      <MessageList
        {...defaultProps({
          streamConnected: true,
          streamOutput: [],
        })}
      />,
    );
    expect(screen.queryByText('Streaming')).toBeNull();
  });
});

// ===== MessageBubble rendering details =====

describe('MessageBubble rendering', () => {
  it('renders assistant messages with MarkdownContent when markdown is on', () => {
    const msgs = [makeMsg({ type: 'assistant', content: '# Header', timestamp: baseTs })];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1 })} />);
    const mdContent = screen.getByTestId('markdown-content');
    expect(mdContent.textContent).toContain('# Header');
  });

  it('renders human messages with MarkdownContent when markdown is on', () => {
    const msgs = [makeMsg({ type: 'human', content: '**bold**', timestamp: baseTs })];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1 })} />);
    const mdContent = screen.getByTestId('markdown-content');
    expect(mdContent.textContent).toContain('**bold**');
  });

  it('renders messages with AnsiSpan when markdown is toggled off', () => {
    const msgs = [makeMsg({ type: 'assistant', content: 'plain text', timestamp: baseTs })];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1 })} />);

    // Turn off markdown — when renderMarkdown is true, aria-label is "Show raw text"
    const mdBtn = screen.getByLabelText('Show raw text');
    fireEvent.click(mdBtn);

    expect(screen.queryByTestId('markdown-content')).toBeNull();
    const ansiSpans = screen.getAllByTestId('ansi-span');
    const found = ansiSpans.some((el) => el.textContent === 'plain text');
    expect(found).toBe(true);
  });

  it('shows "Show less" button for long non-tool messages (starts expanded)', () => {
    // Non-tool messages start expanded: useState(!isTool) = true
    // For long messages (>600 chars), a Show less/Show more button is shown
    const longContent = 'A'.repeat(700);
    const msgs = [makeMsg({ type: 'assistant', content: longContent, timestamp: baseTs })];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1 })} />);

    // Non-tool messages start expanded, so button says "Show less"
    expect(screen.getByText('Show less')).toBeDefined();
  });

  it('toggles to "Show more" after clicking "Show less" on long message', () => {
    const longContent = 'A'.repeat(700);
    const msgs = [makeMsg({ type: 'assistant', content: longContent, timestamp: baseTs })];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1 })} />);

    fireEvent.click(screen.getByText('Show less'));
    expect(screen.getByText('Show more')).toBeDefined();
  });

  it('does not show expand/collapse for short messages', () => {
    const msgs = [makeMsg({ type: 'assistant', content: 'Short', timestamp: baseTs })];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1 })} />);

    expect(screen.queryByText('Show more')).toBeNull();
    expect(screen.queryByText('Show less')).toBeNull();
  });

  it('renders message label from getMessageStyle', () => {
    const msgs = [makeMsg({ type: 'human', content: 'test', timestamp: baseTs })];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1 })} />);
    // The style mock returns label "You" for human
    expect(screen.getByText('You')).toBeDefined();
  });

  it('renders timestamp via formatTime', () => {
    const msgs = [makeMsg({ type: 'human', content: 'test', timestamp: '2026-03-07T15:30:00Z' })];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1 })} />);
    // formatTime mock returns "time:<ts>"
    expect(screen.getByText('time:2026-03-07T15:30:00Z')).toBeDefined();
  });
});

// ===== ViewModeToggle embedded in MessageList =====

describe('MessageList embedded ViewModeToggle', () => {
  it('renders ViewModeToggle in the toolbar', () => {
    render(<MessageList {...defaultProps()} />);
    expect(screen.getByText('Messages')).toBeDefined();
    expect(screen.getByText('Terminal')).toBeDefined();
  });

  it('calls onViewModeChange when toggle is clicked in toolbar', () => {
    const handler = vi.fn();
    render(<MessageList {...defaultProps({ onViewModeChange: handler })} />);
    fireEvent.click(screen.getByText('Terminal'));
    expect(handler).toHaveBeenCalledWith('terminal');
  });
});

// ===== Mixed message rendering =====

describe('MessageList mixed message rendering', () => {
  it('renders a conversation with multiple message types', () => {
    const msgs = [
      makeMsg({ type: 'human', content: 'Hello', timestamp: '2026-03-07T10:00:00Z' }),
      makeMsg({ type: 'thinking', content: 'Analyzing...', timestamp: '2026-03-07T10:00:01Z' }),
      makeMsg({ type: 'assistant', content: 'Hi there', timestamp: '2026-03-07T10:00:02Z' }),
      makeMsg({ type: 'todo', content: 'Task items', timestamp: '2026-03-07T10:00:03Z' }),
    ];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 4 })} />);

    expect(screen.getByText('Hello')).toBeDefined();
    expect(screen.getByTestId('thinking-block').textContent).toContain('Analyzing...');
    expect(screen.getByText('Hi there')).toBeDefined();
    expect(screen.getByTestId('todo-block').textContent).toContain('Task items');
  });

  it('filters only toggled-off types while showing others', () => {
    const msgs = [
      makeMsg({ type: 'human', content: 'Question', timestamp: baseTs }),
      makeMsg({ type: 'thinking', content: 'Hmm...', timestamp: baseTs }),
      makeMsg({ type: 'assistant', content: 'Answer', timestamp: baseTs }),
    ];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 3 })} />);

    // Toggle thinking off
    const btn = screen.getByLabelText(/thinking/i);
    fireEvent.click(btn);

    expect(screen.getByText('Question')).toBeDefined();
    expect(screen.queryByTestId('thinking-block')).toBeNull();
    expect(screen.getByText('Answer')).toBeDefined();
  });

  it('hides all toggleable types simultaneously', () => {
    const msgs = [
      makeMsg({ type: 'human', content: 'User msg', timestamp: baseTs }),
      makeMsg({ type: 'thinking', content: 'Think...', timestamp: baseTs }),
      makeMsg({
        type: 'tool_use',
        content: 'tool input',
        toolName: 'Read',
        toolId: 't1',
        timestamp: baseTs,
      }),
      makeMsg({ type: 'assistant', content: 'Reply', timestamp: baseTs }),
    ];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 4 })} />);

    // Hide thinking (tools already hidden by default)
    fireEvent.click(screen.getByLabelText(/thinking/i));

    // Only human and assistant should remain
    expect(screen.getByText('User msg')).toBeDefined();
    expect(screen.getByText('Reply')).toBeDefined();
    expect(screen.queryByTestId('thinking-block')).toBeNull();
    expect(screen.queryByText('Tool Call')).toBeNull();
  });
});

// ===== Edge cases =====

describe('MessageList edge cases', () => {
  it('handles messages with empty content gracefully', () => {
    const msgs = [makeMsg({ type: 'human', content: '', timestamp: baseTs })];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1 })} />);
    // Should render without crashing — label "You" should appear
    expect(screen.getByText('You')).toBeDefined();
  });

  it('handles messages with undefined timestamp', () => {
    const msgs = [makeMsg({ type: 'human', content: 'No ts' })];
    render(<MessageList {...defaultProps({ messages: msgs, totalMessages: 1 })} />);
    expect(screen.getByText('No ts')).toBeDefined();
  });

  it('renders "No messages yet" not shown when loading', () => {
    // When isLoading=true, the "No messages yet" should not appear even if messages are empty
    render(<MessageList {...defaultProps({ isLoading: true, messages: [], totalMessages: 0 })} />);
    expect(screen.queryByText('No messages yet')).toBeNull();
  });
});
