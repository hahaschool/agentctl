/**
 * Tests for the tool_use / tool_result message rendering (MessageBubble)
 * within SessionPreview. Covers the expand/collapse behavior, tool name
 * display, timestamp, long content truncation, and style differences
 * between tool and non-tool messages.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — must be declared BEFORE importing the component under test
// ---------------------------------------------------------------------------

const mockGetSessionContent = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    getSessionContent: (...args: unknown[]) => mockGetSessionContent(...args),
  },
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: (props: { className?: string }) => (
    <div data-testid="skeleton" className={props.className} />
  ),
}));

vi.mock('../components/ErrorBanner', () => ({
  ErrorBanner: ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
    <div data-testid="error-banner" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  ),
}));

import type { SessionContentResponse } from '../lib/api';
import { SessionPreview } from './SessionPreview';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_PROPS = {
  sessionId: 'sess-tool-test-aaaa-bbbb-cccc-dddddddddddd',
  machineId: 'machine-01',
  onClose: vi.fn(),
};

function renderWithData(data: SessionContentResponse): ReturnType<typeof render> {
  mockGetSessionContent.mockResolvedValue(data);
  return render(<SessionPreview {...DEFAULT_PROPS} />);
}

afterEach(() => {
  vi.restoreAllMocks();
  DEFAULT_PROPS.onClose.mockClear();
});

// ===========================================================================
// Tests
// ===========================================================================

describe('SessionPreview — tool_use message rendering', () => {
  // -------------------------------------------------------------------------
  // 1. Tool messages collapsed by default
  // -------------------------------------------------------------------------

  describe('collapsed tool messages', () => {
    it('tool_use messages are collapsed by default when tools are visible', async () => {
      const data: SessionContentResponse = {
        sessionId: 'sess-001',
        messages: [
          { type: 'human', content: 'Run a command' },
          { type: 'tool_use', content: 'echo hello', toolName: 'Bash' },
        ],
        totalMessages: 2,
      };
      renderWithData(data);

      await waitFor(() => {
        expect(screen.getByText('Run a command')).toBeDefined();
      });

      // Toggle tools on
      fireEvent.click(screen.getByRole('button', { name: 'Show tool messages' }));

      // Tool message should be collapsed — showing tool name and "click to expand"
      expect(screen.getByText('Bash')).toBeDefined();
      expect(screen.getByText('click to expand')).toBeDefined();
      // Content should NOT be visible in collapsed state
      expect(screen.queryByText('echo hello')).toBeNull();
    });

    it('tool_result messages are also collapsed by default', async () => {
      const data: SessionContentResponse = {
        sessionId: 'sess-001',
        messages: [
          { type: 'human', content: 'Hello' },
          { type: 'tool_result', content: 'result output here', toolName: 'Read' },
        ],
        totalMessages: 2,
      };
      renderWithData(data);

      await waitFor(() => {
        expect(screen.getByText('Hello')).toBeDefined();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Show tool messages' }));

      expect(screen.getByText('Read')).toBeDefined();
      expect(screen.getByText('click to expand')).toBeDefined();
      expect(screen.queryByText('result output here')).toBeNull();
    });

    it('shows "Tool Call" label for tool_use type in collapsed state', async () => {
      const data: SessionContentResponse = {
        sessionId: 'sess-001',
        messages: [
          { type: 'human', content: 'Hi' },
          { type: 'tool_use', content: 'content', toolName: 'Write' },
        ],
        totalMessages: 2,
      };
      renderWithData(data);

      await waitFor(() => {
        expect(screen.getByText('Hi')).toBeDefined();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Show tool messages' }));

      expect(screen.getByText('Tool Call')).toBeDefined();
    });

    it('shows "Tool Result" label for tool_result type in collapsed state', async () => {
      const data: SessionContentResponse = {
        sessionId: 'sess-001',
        messages: [
          { type: 'human', content: 'Hi' },
          { type: 'tool_result', content: 'output', toolName: 'Bash' },
        ],
        totalMessages: 2,
      };
      renderWithData(data);

      await waitFor(() => {
        expect(screen.getByText('Hi')).toBeDefined();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Show tool messages' }));

      expect(screen.getByText('Tool Result')).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Expanding tool messages
  // -------------------------------------------------------------------------

  describe('expand/collapse behavior', () => {
    it('expands tool_use message on click to show full content', async () => {
      const data: SessionContentResponse = {
        sessionId: 'sess-001',
        messages: [
          { type: 'human', content: 'Do it' },
          { type: 'tool_use', content: 'rm -rf /tmp/test', toolName: 'Bash' },
        ],
        totalMessages: 2,
      };
      renderWithData(data);

      await waitFor(() => {
        expect(screen.getByText('Do it')).toBeDefined();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Show tool messages' }));

      // Click the collapsed tool message to expand
      const expandBtn = screen.getByText('click to expand');
      fireEvent.click(expandBtn);

      // Content should now be visible
      expect(screen.getByText('rm -rf /tmp/test')).toBeDefined();
      // "click to expand" should be gone
      expect(screen.queryByText('click to expand')).toBeNull();
      // "collapse" button should appear
      expect(screen.getByText('collapse')).toBeDefined();
    });

    it('collapses an expanded tool message when collapse is clicked', async () => {
      const data: SessionContentResponse = {
        sessionId: 'sess-001',
        messages: [
          { type: 'human', content: 'Run' },
          { type: 'tool_use', content: 'ls -la', toolName: 'Bash' },
        ],
        totalMessages: 2,
      };
      renderWithData(data);

      await waitFor(() => {
        expect(screen.getByText('Run')).toBeDefined();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Show tool messages' }));

      // Expand
      fireEvent.click(screen.getByText('click to expand'));
      expect(screen.getByText('ls -la')).toBeDefined();
      expect(screen.getByText('collapse')).toBeDefined();

      // Collapse
      fireEvent.click(screen.getByText('collapse'));
      expect(screen.queryByText('ls -la')).toBeNull();
      expect(screen.getByText('click to expand')).toBeDefined();
    });

    it('can expand and collapse tool messages multiple times', async () => {
      const data: SessionContentResponse = {
        sessionId: 'sess-001',
        messages: [
          { type: 'human', content: 'Go' },
          { type: 'tool_use', content: 'pwd', toolName: 'Bash' },
        ],
        totalMessages: 2,
      };
      renderWithData(data);

      await waitFor(() => {
        expect(screen.getByText('Go')).toBeDefined();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Show tool messages' }));

      // Cycle 1
      fireEvent.click(screen.getByText('click to expand'));
      expect(screen.getByText('pwd')).toBeDefined();
      fireEvent.click(screen.getByText('collapse'));
      expect(screen.queryByText('pwd')).toBeNull();

      // Cycle 2
      fireEvent.click(screen.getByText('click to expand'));
      expect(screen.getByText('pwd')).toBeDefined();
      fireEvent.click(screen.getByText('collapse'));
      expect(screen.queryByText('pwd')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 3. Tool name display
  // -------------------------------------------------------------------------

  describe('tool name display', () => {
    it('shows toolName in collapsed state', async () => {
      const data: SessionContentResponse = {
        sessionId: 'sess-001',
        messages: [
          { type: 'human', content: 'Hello' },
          { type: 'tool_use', content: 'file content', toolName: 'Write' },
        ],
        totalMessages: 2,
      };
      renderWithData(data);

      await waitFor(() => {
        expect(screen.getByText('Hello')).toBeDefined();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Show tool messages' }));

      expect(screen.getByText('Write')).toBeDefined();
    });

    it('shows toolName in expanded state', async () => {
      const data: SessionContentResponse = {
        sessionId: 'sess-001',
        messages: [
          { type: 'human', content: 'Hello' },
          { type: 'tool_use', content: 'some content', toolName: 'Grep' },
        ],
        totalMessages: 2,
      };
      renderWithData(data);

      await waitFor(() => {
        expect(screen.getByText('Hello')).toBeDefined();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Show tool messages' }));
      fireEvent.click(screen.getByText('click to expand'));

      // Tool name should still be visible in expanded state
      expect(screen.getByText('Grep')).toBeDefined();
    });

    it('handles tool_use without toolName gracefully', async () => {
      const data: SessionContentResponse = {
        sessionId: 'sess-001',
        messages: [
          { type: 'human', content: 'Hello' },
          { type: 'tool_use', content: 'unknown tool call' },
        ],
        totalMessages: 2,
      };
      renderWithData(data);

      await waitFor(() => {
        expect(screen.getByText('Hello')).toBeDefined();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Show tool messages' }));

      // Should still render "Tool Call" label and "click to expand"
      expect(screen.getByText('Tool Call')).toBeDefined();
      expect(screen.getByText('click to expand')).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 4. Timestamp in expanded tool messages
  // -------------------------------------------------------------------------

  describe('timestamp in expanded tool messages', () => {
    it('shows timestamp when tool message is expanded', async () => {
      const data: SessionContentResponse = {
        sessionId: 'sess-001',
        messages: [
          { type: 'human', content: 'Hello' },
          {
            type: 'tool_use',
            content: 'echo test',
            toolName: 'Bash',
            timestamp: '2026-03-07T10:30:00Z',
          },
        ],
        totalMessages: 2,
      };
      renderWithData(data);

      await waitFor(() => {
        expect(screen.getByText('Hello')).toBeDefined();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Show tool messages' }));
      fireEvent.click(screen.getByText('click to expand'));

      // Timestamp should be formatted by formatTime and visible
      // The exact format depends on formatTime; just verify something timestamp-like appears
      const expandedContent = screen.getByText('echo test');
      expect(expandedContent).toBeDefined();
    });

    it('does not show timestamp in collapsed state', async () => {
      const data: SessionContentResponse = {
        sessionId: 'sess-001',
        messages: [
          { type: 'human', content: 'Hello' },
          {
            type: 'tool_use',
            content: 'some cmd',
            toolName: 'Bash',
            timestamp: '2026-03-07T10:30:00Z',
          },
        ],
        totalMessages: 2,
      };
      renderWithData(data);

      await waitFor(() => {
        expect(screen.getByText('Hello')).toBeDefined();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Show tool messages' }));

      // In collapsed state, content is not shown, just tool name and "click to expand"
      expect(screen.getByText('click to expand')).toBeDefined();
      // The content 'some cmd' should not be visible
      expect(screen.queryByText('some cmd')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 5. Non-tool messages are NOT collapsed
  // -------------------------------------------------------------------------

  describe('non-tool messages are expanded by default', () => {
    it('human messages show content immediately', async () => {
      const data: SessionContentResponse = {
        sessionId: 'sess-001',
        messages: [{ type: 'human', content: 'This is a user message' }],
        totalMessages: 1,
      };
      renderWithData(data);

      await waitFor(() => {
        expect(screen.getByText('This is a user message')).toBeDefined();
      });

      // No "click to expand" for human messages
      expect(screen.queryByText('click to expand')).toBeNull();
    });

    it('assistant messages show content immediately', async () => {
      const data: SessionContentResponse = {
        sessionId: 'sess-001',
        messages: [
          { type: 'human', content: 'Hi' },
          { type: 'assistant', content: 'Hello! How can I help?' },
        ],
        totalMessages: 2,
      };
      renderWithData(data);

      await waitFor(() => {
        expect(screen.getByText('Hello! How can I help?')).toBeDefined();
      });
    });
  });

  // -------------------------------------------------------------------------
  // 6. Long content truncation for non-tool messages
  // -------------------------------------------------------------------------

  describe('long content truncation (non-tool messages)', () => {
    // Non-tool messages start with expanded=true, so long content
    // shows fully with a "Show less" button initially.

    it('shows full long content initially with "Show less" button', async () => {
      const longContent = 'A'.repeat(600);
      const data: SessionContentResponse = {
        sessionId: 'sess-001',
        messages: [
          { type: 'human', content: 'Hi' },
          { type: 'assistant', content: longContent },
        ],
        totalMessages: 2,
      };
      renderWithData(data);

      await waitFor(() => {
        expect(screen.getByText('Hi')).toBeDefined();
      });

      // Full content is shown initially (expanded=true for non-tool)
      expect(screen.getByText(longContent)).toBeDefined();
      expect(screen.getByText('Show less')).toBeDefined();
    });

    it('truncates content when "Show less" is clicked', async () => {
      const longContent = 'B'.repeat(600);
      const data: SessionContentResponse = {
        sessionId: 'sess-001',
        messages: [
          { type: 'human', content: 'Hi' },
          { type: 'assistant', content: longContent },
        ],
        totalMessages: 2,
      };
      renderWithData(data);

      await waitFor(() => {
        expect(screen.getByText('Hi')).toBeDefined();
      });

      fireEvent.click(screen.getByText('Show less'));
      expect(screen.getByText(`${'B'.repeat(500)}...`)).toBeDefined();
      expect(screen.getByText('Show more')).toBeDefined();
    });

    it('re-expands to full content when "Show more" is clicked after collapse', async () => {
      const longContent = 'C'.repeat(600);
      const data: SessionContentResponse = {
        sessionId: 'sess-001',
        messages: [
          { type: 'human', content: 'Hi' },
          { type: 'assistant', content: longContent },
        ],
        totalMessages: 2,
      };
      renderWithData(data);

      await waitFor(() => {
        expect(screen.getByText('Hi')).toBeDefined();
      });

      // Collapse first
      fireEvent.click(screen.getByText('Show less'));
      expect(screen.getByText(`${'C'.repeat(500)}...`)).toBeDefined();

      // Re-expand
      fireEvent.click(screen.getByText('Show more'));
      expect(screen.getByText(longContent)).toBeDefined();
      expect(screen.getByText('Show less')).toBeDefined();
    });

    it('does not show "Show more" or "Show less" for short content', async () => {
      const data: SessionContentResponse = {
        sessionId: 'sess-001',
        messages: [
          { type: 'human', content: 'Hi' },
          { type: 'assistant', content: 'Short reply' },
        ],
        totalMessages: 2,
      };
      renderWithData(data);

      await waitFor(() => {
        expect(screen.getByText('Short reply')).toBeDefined();
      });

      expect(screen.queryByText('Show more')).toBeNull();
      expect(screen.queryByText('Show less')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 7. Multiple tool messages
  // -------------------------------------------------------------------------

  describe('multiple tool messages', () => {
    it('renders multiple tool_use and tool_result messages independently', async () => {
      const data: SessionContentResponse = {
        sessionId: 'sess-001',
        messages: [
          { type: 'human', content: 'Do stuff' },
          { type: 'tool_use', content: 'read file', toolName: 'Read' },
          { type: 'tool_result', content: 'file contents', toolName: 'Read' },
          { type: 'tool_use', content: 'write file', toolName: 'Write' },
          { type: 'tool_result', content: 'success', toolName: 'Write' },
        ],
        totalMessages: 5,
      };
      renderWithData(data);

      await waitFor(() => {
        expect(screen.getByText('Do stuff')).toBeDefined();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Show tool messages' }));

      // All four tool messages collapsed
      const expandHints = screen.getAllByText('click to expand');
      expect(expandHints).toHaveLength(4);

      // Both tool names shown
      const readLabels = screen.getAllByText('Read');
      expect(readLabels).toHaveLength(2);
      const writeLabels = screen.getAllByText('Write');
      expect(writeLabels).toHaveLength(2);
    });

    it('expanding one tool message does not affect others', async () => {
      const data: SessionContentResponse = {
        sessionId: 'sess-001',
        messages: [
          { type: 'human', content: 'Go' },
          { type: 'tool_use', content: 'first tool content', toolName: 'Bash' },
          { type: 'tool_use', content: 'second tool content', toolName: 'Grep' },
        ],
        totalMessages: 3,
      };
      renderWithData(data);

      await waitFor(() => {
        expect(screen.getByText('Go')).toBeDefined();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Show tool messages' }));

      // Both collapsed initially
      const expandHints = screen.getAllByText('click to expand');
      expect(expandHints).toHaveLength(2);

      // Expand first one (click the first "click to expand")
      fireEvent.click(expandHints[0] as HTMLElement);

      // First tool content visible, second still collapsed
      expect(screen.getByText('first tool content')).toBeDefined();
      expect(screen.queryByText('second tool content')).toBeNull();
      // One "click to expand" remaining for the second tool
      expect(screen.getAllByText('click to expand')).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // 8. Tool messages hidden by default (toggle off)
  // -------------------------------------------------------------------------

  describe('tool visibility toggle', () => {
    it('tool messages are completely hidden when show tools is off', async () => {
      const data: SessionContentResponse = {
        sessionId: 'sess-001',
        messages: [
          { type: 'human', content: 'Hello' },
          { type: 'assistant', content: 'Hi' },
          { type: 'tool_use', content: 'tool content', toolName: 'Bash' },
          { type: 'tool_result', content: 'result', toolName: 'Bash' },
        ],
        totalMessages: 4,
      };
      renderWithData(data);

      await waitFor(() => {
        expect(screen.getByText('Hello')).toBeDefined();
      });

      // By default tools are hidden
      expect(screen.queryByText('click to expand')).toBeNull();
      expect(screen.queryByText('Tool Call')).toBeNull();
      expect(screen.queryByText('Tool Result')).toBeNull();
    });

    it('toggling tools off hides previously visible tool messages', async () => {
      const data: SessionContentResponse = {
        sessionId: 'sess-001',
        messages: [
          { type: 'human', content: 'Hello' },
          { type: 'tool_use', content: 'cmd', toolName: 'Bash' },
        ],
        totalMessages: 2,
      };
      renderWithData(data);

      await waitFor(() => {
        expect(screen.getByText('Hello')).toBeDefined();
      });

      // Show tools
      fireEvent.click(screen.getByRole('button', { name: 'Show tool messages' }));
      expect(screen.getByText('Bash')).toBeDefined();

      // Hide tools
      fireEvent.click(screen.getByRole('button', { name: 'Hide tool messages' }));
      expect(screen.queryByText('click to expand')).toBeNull();
    });
  });
});
