import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared BEFORE importing the component under test
// ---------------------------------------------------------------------------

const mockGetSessionContent = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    getSessionContent: (...args: unknown[]) => mockGetSessionContent(...args),
  },
}));

// Mock Skeleton so we can detect loading state without real CSS
vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: (props: { className?: string }) => (
    <div data-testid="skeleton" className={props.className} />
  ),
}));

// Mock ErrorBanner so we can assert on its props
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

function makeMessages(count: number, types?: string[]): SessionContentResponse {
  const messages = Array.from({ length: count }, (_, i) => ({
    type: types?.[i % types.length] ?? (i % 2 === 0 ? 'human' : 'assistant'),
    content: `Message ${i + 1}`,
    timestamp: '2026-03-06T12:00:00Z',
  }));
  return {
    sessionId: 'sess-001',
    messages,
    totalMessages: count,
  };
}

const DEFAULT_PROPS = {
  sessionId: 'sess-001-aaaa-bbbb-cccc-dddddddddddd',
  machineId: 'machine-01',
  onClose: vi.fn(),
};

afterEach(() => {
  vi.restoreAllMocks();
  DEFAULT_PROPS.onClose.mockClear();
});

// ===========================================================================
// Tests
// ===========================================================================

describe('SessionPreview', () => {
  // -------------------------------------------------------------------------
  // 1. Renders with session ID and machine ID
  // -------------------------------------------------------------------------

  it('renders with session ID and machine ID', async () => {
    const data = makeMessages(2);
    mockGetSessionContent.mockResolvedValue(data);

    render(<SessionPreview {...DEFAULT_PROPS} />);

    // The truncated session ID should appear in the header
    expect(screen.getByText(/sess-001-aaaa-bbbb-cccc-dddddddd/)).toBeDefined();

    // The API should have been called with the correct sessionId and machineId
    expect(mockGetSessionContent).toHaveBeenCalledWith('sess-001-aaaa-bbbb-cccc-dddddddddddd', {
      machineId: 'machine-01',
      projectPath: undefined,
      limit: 200,
    });
  });

  // -------------------------------------------------------------------------
  // 2. Shows loading state while fetching
  // -------------------------------------------------------------------------

  it('shows loading skeletons while fetching', () => {
    // Never resolve the promise so loading stays true
    mockGetSessionContent.mockReturnValue(new Promise(() => {}));

    render(<SessionPreview {...DEFAULT_PROPS} />);

    const skeletons = screen.getAllByTestId('skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 3. Displays messages after loading
  // -------------------------------------------------------------------------

  it('displays messages after loading completes', async () => {
    const data = makeMessages(4);
    mockGetSessionContent.mockResolvedValue(data);

    render(<SessionPreview {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText('Message 1')).toBeDefined();
    });
    expect(screen.getByText('Message 2')).toBeDefined();
    expect(screen.getByText('Message 3')).toBeDefined();
    expect(screen.getByText('Message 4')).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 4. Close button calls onClose
  // -------------------------------------------------------------------------

  it('close button calls onClose', async () => {
    mockGetSessionContent.mockResolvedValue(makeMessages(2));

    render(<SessionPreview {...DEFAULT_PROPS} />);

    const closeBtn = screen.getByText('Close (Esc)');
    fireEvent.click(closeBtn);
    expect(DEFAULT_PROPS.onClose).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 5. Filter toggle (show/hide tools)
  // -------------------------------------------------------------------------

  it('toggles tool message visibility when Show/Hide Tools is clicked', async () => {
    const data: SessionContentResponse = {
      sessionId: 'sess-001',
      messages: [
        { type: 'human', content: 'Hello' },
        { type: 'assistant', content: 'Hi there' },
        { type: 'tool_use', content: 'Running tool', toolName: 'Bash' },
        { type: 'tool_result', content: 'Tool output', toolName: 'Bash' },
      ],
      totalMessages: 4,
    };
    mockGetSessionContent.mockResolvedValue(data);

    render(<SessionPreview {...DEFAULT_PROPS} />);

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeDefined();
    });

    // Initially tools are hidden — only human and assistant shown
    expect(screen.getByText('Hello')).toBeDefined();
    expect(screen.getByText('Hi there')).toBeDefined();
    // Tool messages should not have their content rendered as expanded text
    expect(screen.queryByText('Tool output')).toBeNull();

    // Click "Show Tools" to reveal tool messages
    const toggleBtn = screen.getByRole('button', { name: 'Show tool messages' });
    fireEvent.click(toggleBtn);

    // Now tool messages should appear (collapsed by default, showing tool name)
    await waitFor(() => {
      expect(screen.getByText('Hide Tools')).toBeDefined();
    });
    // Tool_use and tool_result appear as collapsed buttons with tool name
    const bashLabels = screen.getAllByText('Bash');
    expect(bashLabels.length).toBeGreaterThanOrEqual(2);

    // Click "Hide Tools" to hide them again
    const hideBtn = screen.getByRole('button', { name: 'Hide tool messages' });
    fireEvent.click(hideBtn);
    expect(screen.getByText('Show Tools')).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 6. Error state when API fails
  // -------------------------------------------------------------------------

  it('shows error banner when API call fails', async () => {
    mockGetSessionContent.mockRejectedValue(new Error('Network error'));

    render(<SessionPreview {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByTestId('error-banner')).toBeDefined();
    });
    expect(screen.getByText('Network error')).toBeDefined();
  });

  it('retries fetch when Retry button is clicked in error state', async () => {
    mockGetSessionContent.mockRejectedValueOnce(new Error('Network error'));
    mockGetSessionContent.mockResolvedValueOnce(makeMessages(2));

    render(<SessionPreview {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByTestId('error-banner')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Retry'));

    await waitFor(() => {
      expect(screen.getByText('Message 1')).toBeDefined();
    });
    expect(mockGetSessionContent).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // 7. Focus trap behavior
  // -------------------------------------------------------------------------

  it('traps focus within the panel on Tab keydown', async () => {
    mockGetSessionContent.mockResolvedValue(makeMessages(2));

    render(<SessionPreview {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText('Message 1')).toBeDefined();
    });

    const dialog = screen.getByRole('dialog');
    // Get all focusable elements inside the dialog
    const focusableElements = dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    expect(focusableElements.length).toBeGreaterThan(0);

    const firstFocusable = focusableElements[0]!;
    const lastFocusable = focusableElements[focusableElements.length - 1]!;

    // Focus the last element and press Tab — should wrap to first
    lastFocusable.focus();
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
    const preventSpy = vi.spyOn(tabEvent, 'preventDefault');
    document.dispatchEvent(tabEvent);
    expect(preventSpy).toHaveBeenCalled();

    // Focus the first element and press Shift+Tab — should wrap to last
    firstFocusable.focus();
    const shiftTabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
    });
    const preventSpy2 = vi.spyOn(shiftTabEvent, 'preventDefault');
    document.dispatchEvent(shiftTabEvent);
    expect(preventSpy2).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 8. Escape key closes the panel
  // -------------------------------------------------------------------------

  it('calls onClose when Escape key is pressed', async () => {
    mockGetSessionContent.mockResolvedValue(makeMessages(2));

    render(<SessionPreview {...DEFAULT_PROPS} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(DEFAULT_PROPS.onClose).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 9. Backdrop click closes panel
  // -------------------------------------------------------------------------

  it('calls onClose when backdrop is clicked', async () => {
    mockGetSessionContent.mockResolvedValue(makeMessages(2));

    render(<SessionPreview {...DEFAULT_PROPS} />);

    const backdrop = screen.getByLabelText('Close preview');
    fireEvent.click(backdrop);
    expect(DEFAULT_PROPS.onClose).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 10. Message count display
  // -------------------------------------------------------------------------

  it('displays message count in stats bar after loading', async () => {
    const data = makeMessages(6);
    mockGetSessionContent.mockResolvedValue(data);

    render(<SessionPreview {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText('6 total messages')).toBeDefined();
    });
    // Only human and assistant shown by default (3 each out of 6)
    expect(screen.getByText(/6 shown/)).toBeDefined();
  });

  it('shows "conversations only" hint when tools are hidden', async () => {
    const data: SessionContentResponse = {
      sessionId: 'sess-001',
      messages: [
        { type: 'human', content: 'Hello' },
        { type: 'assistant', content: 'Hi' },
        { type: 'tool_use', content: 'tool', toolName: 'Bash' },
      ],
      totalMessages: 3,
    };
    mockGetSessionContent.mockResolvedValue(data);

    render(<SessionPreview {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText('3 total messages')).toBeDefined();
    });

    // By default tools hidden — shows "conversations only" hint
    expect(screen.getByText(/\(conversations only\)/)).toBeDefined();
    expect(screen.getByText(/2 shown/)).toBeDefined();

    // Toggle to show tools — no more "conversations only"
    fireEvent.click(screen.getByRole('button', { name: 'Show tool messages' }));
    expect(screen.queryByText(/\(conversations only\)/)).toBeNull();
    expect(screen.getByText(/3 shown/)).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Bonus: "Showing last N of M" truncation message
  // -------------------------------------------------------------------------

  it('shows truncation message when totalMessages exceeds loaded messages', async () => {
    const data: SessionContentResponse = {
      sessionId: 'sess-001',
      messages: [
        { type: 'human', content: 'Hello' },
        { type: 'assistant', content: 'Hi' },
      ],
      totalMessages: 500,
    };
    mockGetSessionContent.mockResolvedValue(data);

    render(<SessionPreview {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText(/Showing last 2 of 500 messages/)).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Bonus: dialog aria attributes
  // -------------------------------------------------------------------------

  it('renders with dialog role and aria-modal', async () => {
    mockGetSessionContent.mockResolvedValue(makeMessages(2));

    render(<SessionPreview {...DEFAULT_PROPS} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('session-preview-title');
  });

  // -------------------------------------------------------------------------
  // Bonus: No messages found
  // -------------------------------------------------------------------------

  it('shows "No messages found" when session has no human/assistant messages', async () => {
    const data: SessionContentResponse = {
      sessionId: 'sess-001',
      messages: [{ type: 'tool_use', content: 'tool run', toolName: 'Bash' }],
      totalMessages: 1,
    };
    mockGetSessionContent.mockResolvedValue(data);

    render(<SessionPreview {...DEFAULT_PROPS} />);

    await waitFor(() => {
      // With tools hidden by default and only tool messages, visibleMessages is empty
      expect(screen.getByText('No messages found in this session')).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Bonus: status border class
  // -------------------------------------------------------------------------

  it('applies active status border class', async () => {
    mockGetSessionContent.mockResolvedValue(makeMessages(2));

    render(<SessionPreview {...DEFAULT_PROPS} status="active" />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('border-l-green-500');
  });

  it('applies error status border class', async () => {
    mockGetSessionContent.mockResolvedValue(makeMessages(2));

    render(<SessionPreview {...DEFAULT_PROPS} status="error" />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('border-l-red-500');
  });

  // -------------------------------------------------------------------------
  // Bonus: passes projectPath to API
  // -------------------------------------------------------------------------

  it('passes projectPath to the API when provided', async () => {
    mockGetSessionContent.mockResolvedValue(makeMessages(2));

    render(<SessionPreview {...DEFAULT_PROPS} projectPath="/home/user/project" />);

    expect(mockGetSessionContent).toHaveBeenCalledWith('sess-001-aaaa-bbbb-cccc-dddddddddddd', {
      machineId: 'machine-01',
      projectPath: '/home/user/project',
      limit: 200,
    });
  });
});
