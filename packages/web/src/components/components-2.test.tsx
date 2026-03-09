import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AnsiSpan, AnsiText } from './AnsiText';
import { ConnectionBanner } from './ConnectionBanner';
import { ErrorBanner } from './ErrorBanner';
import { ErrorBoundary } from './ErrorBoundary';
import { HighlightText } from './HighlightText';
import { LiveTimeAgo } from './LiveTimeAgo';
import { PathBadge } from './PathBadge';
import { WsStatusIndicator } from './WsStatusIndicator';

// ---------------------------------------------------------------------------
// Mock sonner (used by useToast inside PathBadge)
// ---------------------------------------------------------------------------
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock @/components/ui/tooltip (used by SimpleTooltip inside PathBadge)
// ---------------------------------------------------------------------------
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// ---------------------------------------------------------------------------
// Mock ansi-to-react
// ---------------------------------------------------------------------------
vi.mock('ansi-to-react', () => ({
  default: ({ children }: { children: string }) => <span>{children}</span>,
}));

// ---------------------------------------------------------------------------
// Mock clipboard API
// ---------------------------------------------------------------------------
beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ===========================================================================
// ErrorBoundary
// ===========================================================================

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>Child content</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Child content')).toBeDefined();
  });

  it('displays default error UI when error occurs and no fallback is provided', () => {
    const ThrowError = () => {
      throw new Error('Test error message');
    };

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeDefined();
    expect(screen.getByText('Test error message')).toBeDefined();
  });

  it('displays fallback when provided and error occurs', () => {
    const ThrowError = () => {
      throw new Error('Test error');
    };

    const fallback = <div>Custom fallback UI</div>;

    render(
      <ErrorBoundary fallback={fallback}>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Custom fallback UI')).toBeDefined();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('renders a Try Again button on error', () => {
    const ThrowError = () => {
      throw new Error('Test error');
    };

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    const tryAgainBtn = screen.getByRole('button', { name: 'Try Again' });
    expect(tryAgainBtn).toBeDefined();
  });

  it('recovers from error when Try Again button is clicked', () => {
    let shouldThrow = true;

    const ConditionalError = () => {
      if (shouldThrow) {
        throw new Error('Temporary error');
      }
      return <div>Recovered content</div>;
    };

    const { rerender } = render(
      <ErrorBoundary>
        <ConditionalError />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeDefined();

    shouldThrow = false;

    const tryAgainBtn = screen.getByRole('button', { name: 'Try Again' });
    fireEvent.click(tryAgainBtn);

    rerender(
      <ErrorBoundary>
        <ConditionalError />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Recovered content')).toBeDefined();
  });

  it('renders error UI with title and Try Again button', () => {
    const ThrowError = () => {
      throw new Error('Something failed');
    };

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    // Verify the error UI structure
    expect(screen.getByText('Something went wrong')).toBeDefined();
    expect(screen.getByText('Something failed')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeDefined();
  });

  it('applies the expected CSS classes to the error container', () => {
    const ThrowError = () => {
      throw new Error('Test');
    };

    const { container } = render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    const errorContainer = container.querySelector('.flex');
    expect(errorContainer?.className).toContain('flex');
    expect(errorContainer?.className).toContain('flex-col');
    expect(errorContainer?.className).toContain('items-center');
    expect(errorContainer?.className).toContain('justify-center');
  });
});

// ===========================================================================
// ConnectionBanner
// ===========================================================================

describe('ConnectionBanner', () => {
  it('renders nothing when status is "connected"', () => {
    const { container } = render(<ConnectionBanner status="connected" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when status is "connecting"', () => {
    const { container } = render(<ConnectionBanner status="connecting" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders banner when status is "disconnected"', () => {
    render(<ConnectionBanner status="disconnected" />);
    expect(screen.getByText('Connection lost — displayed data may be stale')).toBeDefined();
  });

  it('renders a Dismiss button when disconnected', () => {
    render(<ConnectionBanner status="disconnected" />);
    const dismissBtn = screen.getByRole('button', { name: 'Dismiss' });
    expect(dismissBtn).toBeDefined();
  });

  it('hides banner when Dismiss button is clicked', () => {
    render(<ConnectionBanner status="disconnected" />);
    const dismissBtn = screen.getByRole('button', { name: 'Dismiss' });

    fireEvent.click(dismissBtn);

    expect(screen.queryByText('Connection lost — displayed data may be stale')).toBeNull();
  });

  it('resets dismissed state when connection is restored and lost again', async () => {
    const { rerender } = render(<ConnectionBanner status="disconnected" />);

    // Dismiss the banner
    const dismissBtn = screen.getByRole('button', { name: 'Dismiss' });
    fireEvent.click(dismissBtn);
    expect(screen.queryByText('Connection lost — displayed data may be stale')).toBeNull();

    // Simulate reconnection
    rerender(<ConnectionBanner status="connected" />);
    expect(screen.queryByText('Connection lost — displayed data may be stale')).toBeNull();

    // Simulate disconnection again
    rerender(<ConnectionBanner status="disconnected" />);

    // Banner should be visible again (dismissed state reset)
    await waitFor(() => {
      expect(screen.getByText('Connection lost — displayed data may be stale')).toBeDefined();
    });
  });

  it('has role="alert" for accessibility', () => {
    render(<ConnectionBanner status="disconnected" />);
    const alertElement = screen.getByRole('alert');
    expect(alertElement).toBeDefined();
  });

  it('applies yellow color classes for warning styling', () => {
    const { container } = render(<ConnectionBanner status="disconnected" />);
    const alertElement = container.querySelector('[role="alert"]');
    expect(alertElement?.className).toContain('bg-yellow-500');
    expect(alertElement?.className).toContain('text-yellow-600');
  });
});

// ===========================================================================
// ErrorBanner
// ===========================================================================

describe('ErrorBanner', () => {
  it('renders the error message', () => {
    render(<ErrorBanner message="An error occurred" />);
    expect(screen.getByText('An error occurred')).toBeDefined();
  });

  it('does not render Retry button when onRetry is not provided', () => {
    render(<ErrorBanner message="Error message" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders Retry button when onRetry is provided', () => {
    render(<ErrorBanner message="Error message" onRetry={() => {}} />);
    const retryBtn = screen.getByRole('button', { name: 'Retry' });
    expect(retryBtn).toBeDefined();
  });

  it('calls onRetry when Retry button is clicked', () => {
    const onRetry = vi.fn();
    render(<ErrorBanner message="Error message" onRetry={onRetry} />);
    const retryBtn = screen.getByRole('button', { name: 'Retry' });

    fireEvent.click(retryBtn);

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('has role="alert" for accessibility', () => {
    render(<ErrorBanner message="Error" />);
    const alertElement = screen.getByRole('alert');
    expect(alertElement).toBeDefined();
  });

  it('applies red color classes for error styling', () => {
    const { container } = render(<ErrorBanner message="Error" />);
    const banner = container.querySelector('[role="alert"]');
    expect(banner?.className).toContain('bg-red-900');
    expect(banner?.className).toContain('text-red-300');
  });

  it('applies custom className prop', () => {
    const { container } = render(<ErrorBanner message="Error" className="custom-class" />);
    const banner = container.querySelector('[role="alert"]');
    expect(banner?.className).toContain('custom-class');
  });

  it('renders error message and retry button together', () => {
    const onRetry = vi.fn();
    render(<ErrorBanner message="Something failed" onRetry={onRetry} />);

    expect(screen.getByText('Something failed')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined();
  });
});

// ===========================================================================
// PathBadge
// ===========================================================================

describe('PathBadge', () => {
  it('renders fallback when path is null', () => {
    render(<PathBadge path={null} fallback="No path" />);
    expect(screen.getByText('No path')).toBeDefined();
  });

  it('renders fallback when path is undefined', () => {
    render(<PathBadge path={undefined} fallback="Empty" />);
    expect(screen.getByText('Empty')).toBeDefined();
  });

  it('renders default fallback "-" when path is not provided', () => {
    render(<PathBadge path={null} />);
    expect(screen.getByText('-')).toBeDefined();
  });

  it('renders shortened path when path is provided', () => {
    render(<PathBadge path="/users/john/projects/my-app/src/index.ts" />);
    // shortenPath should shorten the path
    const button = screen.getByRole('button');
    expect(button.textContent).toBeTruthy();
    expect(button.textContent?.length).toBeLessThan(32);
  });

  it('renders as a button element', () => {
    render(<PathBadge path="/some/path" />);
    const button = screen.getByRole('button');
    expect(button.tagName).toBe('BUTTON');
  });

  it('renders as non-interactive text when copyable is false', () => {
    const { container } = render(<PathBadge path="/some/path" copyable={false} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('span')).toBeTruthy();
  });

  it('has aria-label describing the path', () => {
    render(<PathBadge path="/users/john/file.ts" />);
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-label')).toContain('Copy path');
    expect(button.getAttribute('aria-label')).toContain('/users/john/file.ts');
  });

  it('copies the full path to clipboard on click', async () => {
    render(<PathBadge path="/users/john/file.ts" />);
    const button = screen.getByRole('button');

    await act(async () => {
      fireEvent.click(button);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('/users/john/file.ts');
  });

  it('shows success toast on successful copy', async () => {
    const { toast } = await import('sonner');
    vi.mocked(navigator.clipboard.writeText).mockResolvedValueOnce(undefined);

    render(<PathBadge path="/users/john/file.ts" />);
    const button = screen.getByRole('button');

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Path copied');
    });
  });

  it('shows error toast on failed copy', async () => {
    const { toast } = await import('sonner');
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('Copy failed'));

    render(<PathBadge path="/users/john/file.ts" />);
    const button = screen.getByRole('button');

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to copy');
    });
  });

  it('applies custom className', () => {
    const { container } = render(<PathBadge path="/some/path" className="custom-class" />);
    const button = container.querySelector('button');
    expect(button?.className).toContain('custom-class');
  });

  it('applies muted-foreground class when path is null', () => {
    const { container } = render(<PathBadge path={null} />);
    const span = container.querySelector('span');
    expect(span?.className).toContain('text-muted-foreground');
  });

  it('does not copy when path is null', async () => {
    render(<PathBadge path={null} />);

    // The fallback is a span, not a button
    const span = screen.getByText('-');
    expect(span.tagName).toBe('SPAN');
  });
});

// ===========================================================================
// LiveTimeAgo
// ===========================================================================

describe('LiveTimeAgo', () => {
  it('renders fallback when date is empty string', () => {
    render(<LiveTimeAgo date="" fallback="No date" />);
    expect(screen.getByText('No date')).toBeDefined();
  });

  it('renders fallback when date is null-like (falsy)', () => {
    render(<LiveTimeAgo date="" fallback="Empty" />);
    expect(screen.getByText('Empty')).toBeDefined();
  });

  it('renders relative time for a valid date', () => {
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();

    render(<LiveTimeAgo date={fiveMinutesAgo} />);

    const span = screen.getByText(/ago/);
    expect(span).toBeDefined();
  });

  it('sets title attribute to formatted date string', () => {
    const date = '2024-01-15T10:30:00Z';
    const { container } = render(<LiveTimeAgo date={date} />);
    const span = container.querySelector('span');

    expect(span?.getAttribute('title')).toBeTruthy();
  });

  it('applies custom className', () => {
    const date = new Date().toISOString();
    const { container } = render(<LiveTimeAgo date={date} className="custom-class" />);
    const span = container.querySelector('span');

    expect(span?.className).toContain('custom-class');
  });

  it('updates time periodically based on interval', async () => {
    vi.useFakeTimers();

    const date = new Date(Date.now() - 65 * 1000).toISOString(); // 65 seconds ago
    render(<LiveTimeAgo date={date} interval={30_000} />);

    // First render should show "1m ago" or similar
    let textContent = screen.getByText(/ago/).textContent;
    expect(textContent).toContain('ago');

    // Advance by interval time
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    // Component should have re-rendered with updated time
    // (text might be slightly different, but still shows "ago")
    textContent = screen.getByText(/ago/).textContent;
    expect(textContent).toContain('ago');

    vi.useRealTimers();
  });

  it('cleans up timer on unmount', () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    const date = new Date().toISOString();
    const { unmount } = render(<LiveTimeAgo date={date} interval={30_000} />);

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('uses default 30 second interval when not provided', () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(global, 'setInterval');

    const date = new Date().toISOString();
    render(<LiveTimeAgo date={date} />);

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
    vi.useRealTimers();
  });

  it('uses custom interval when provided', () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(global, 'setInterval');

    const date = new Date().toISOString();
    render(<LiveTimeAgo date={date} interval={5000} />);

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    vi.useRealTimers();
  });
});

// ===========================================================================
// HighlightText
// ===========================================================================

describe('HighlightText', () => {
  it('renders text without highlighting when highlight is empty', () => {
    render(<HighlightText text="Hello World" highlight="" />);
    expect(screen.getByText('Hello World')).toBeDefined();
  });

  it('renders text without highlighting when highlight is whitespace only', () => {
    render(<HighlightText text="Hello World" highlight="   " />);
    expect(screen.getByText('Hello World')).toBeDefined();
  });

  it('highlights matching substring', () => {
    const { container } = render(<HighlightText text="Hello World" highlight="World" />);
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBeGreaterThan(0);
    expect(marks[0]?.textContent).toBe('World');
  });

  it('performs case-insensitive matching', () => {
    const { container } = render(<HighlightText text="Hello World" highlight="hello" />);
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBeGreaterThan(0);
    expect(marks[0]?.textContent).toBe('Hello');
  });

  it('highlights multiple occurrences', () => {
    const { container } = render(<HighlightText text="banana" highlight="an" />);
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(2);
    expect(marks[0]?.textContent).toBe('an');
    expect(marks[1]?.textContent).toBe('an');
  });

  it('escapes special regex characters in highlight string', () => {
    const { container } = render(<HighlightText text="test (test) test" highlight="(test)" />);
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBeGreaterThan(0);
    expect(marks[0]?.textContent).toBe('(test)');
  });

  it('applies custom className to root span', () => {
    const { container } = render(
      <HighlightText text="Hello World" highlight="World" className="custom-class" />,
    );
    const span = container.querySelector('span');
    expect(span?.className).toContain('custom-class');
  });

  it('applies yellow background to highlighted marks', () => {
    const { container } = render(<HighlightText text="Hello World" highlight="World" />);
    const mark = container.querySelector('mark');
    expect(mark?.className).toContain('bg-yellow-500');
  });

  it('renders non-matching text without mark elements', () => {
    const { container } = render(<HighlightText text="Hello World" highlight="xyz" />);
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(0);
    expect(screen.getByText('Hello World')).toBeDefined();
  });

  it('handles empty text', () => {
    const { container } = render(<HighlightText text="" highlight="test" />);
    const span = container.querySelector('span');
    expect(span).toBeDefined();
    expect(span?.textContent).toBe('');
  });

  it('handles text with special characters', () => {
    const { container } = render(<HighlightText text="path/to/file.js" highlight="/" />);
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(2);
  });
});

// ===========================================================================
// WsStatusIndicator
// ===========================================================================

describe('WsStatusIndicator', () => {
  it('renders with connected status', () => {
    render(<WsStatusIndicator status="connected" />);
    expect(screen.getByText('Connected')).toBeDefined();
  });

  it('renders with connecting status', () => {
    render(<WsStatusIndicator status="connecting" />);
    expect(screen.getByText('Connecting')).toBeDefined();
  });

  it('renders with disconnected status', () => {
    render(<WsStatusIndicator status="disconnected" />);
    expect(screen.getByText('Disconnected')).toBeDefined();
  });

  it('applies green color classes for connected status', () => {
    const { container } = render(<WsStatusIndicator status="connected" />);
    const span = container.querySelector('span');
    expect(span?.className).toContain('text-green-500');
  });

  it('applies yellow color classes for connecting status', () => {
    const { container } = render(<WsStatusIndicator status="connecting" />);
    const span = container.querySelector('span');
    expect(span?.className).toContain('text-yellow-500');
  });

  it('applies muted color classes for disconnected status', () => {
    const { container } = render(<WsStatusIndicator status="disconnected" />);
    const span = container.querySelector('span');
    expect(span?.className).toContain('text-muted-foreground');
  });

  it('renders a status dot with appropriate background color', () => {
    const { container } = render(<WsStatusIndicator status="connected" />);
    const dot = container.querySelector('[class*="rounded-full"]');
    expect(dot).toBeDefined();
    expect(dot?.className).toContain('bg-green-500');
  });

  it('hides the label text when compact mode is enabled', () => {
    render(<WsStatusIndicator status="connected" compact />);
    expect(screen.queryByText('Connected')).toBeNull();
  });

  it('shows the label text when compact mode is disabled', () => {
    render(<WsStatusIndicator status="connected" compact={false} />);
    expect(screen.getByText('Connected')).toBeDefined();
  });

  it('sets title attribute for tooltip', () => {
    const { container } = render(<WsStatusIndicator status="connected" />);
    const span = container.querySelector('span');
    expect(span?.getAttribute('title')).toContain('WebSocket');
  });

  it('applies text-[10px] class when compact is true', () => {
    const { container } = render(<WsStatusIndicator status="connected" compact />);
    const span = container.querySelector('span');
    expect(span?.className).toContain('text-[10px]');
  });

  it('applies text-[11px] class when compact is false', () => {
    const { container } = render(<WsStatusIndicator status="connected" compact={false} />);
    const span = container.querySelector('span');
    expect(span?.className).toContain('text-[11px]');
  });
});

// ===========================================================================
// AnsiText
// ===========================================================================

describe('AnsiText', () => {
  it('renders as <pre> element', () => {
    const { container } = render(<AnsiText>Hello</AnsiText>);
    expect(container.querySelector('pre')).toBeDefined();
  });

  it('renders children text content', () => {
    render(<AnsiText>Hello World</AnsiText>);
    expect(screen.getByText('Hello World')).toBeDefined();
  });

  it('applies custom className', () => {
    const { container } = render(<AnsiText className="custom-class">Text</AnsiText>);
    const pre = container.querySelector('pre');
    expect(pre?.className).toContain('custom-class');
  });

  it('passes text content to ansi-to-react for processing', () => {
    const ansiText = '\u001B[32mGreen Text\u001B[0m';
    const { container } = render(<AnsiText>{ansiText}</AnsiText>);
    const pre = container.querySelector('pre');
    expect(pre).toBeDefined();
    // The mocked ansi-to-react just renders the text as-is
    expect(container.textContent).toContain('Green');
  });

  it('handles multiline text', () => {
    const multilineText = 'Line 1\nLine 2\nLine 3';
    const { container } = render(<AnsiText>{multilineText}</AnsiText>);
    expect(container.textContent).toContain('Line 1');
    expect(container.textContent).toContain('Line 2');
    expect(container.textContent).toContain('Line 3');
  });
});

// ===========================================================================
// AnsiSpan
// ===========================================================================

describe('AnsiSpan', () => {
  it('renders as <span> element (wrapped by mocked component)', () => {
    const { container } = render(<AnsiSpan>Hello</AnsiSpan>);
    const span = container.querySelector('span');
    expect(span).toBeDefined();
  });

  it('renders children text content', () => {
    const { container } = render(<AnsiSpan>Hello World</AnsiSpan>);
    expect(container.textContent).toContain('Hello World');
  });

  it('applies custom className', () => {
    const { container } = render(<AnsiSpan className="custom-class">Text</AnsiSpan>);
    const span = container.querySelector('span');
    expect(span?.className).toContain('custom-class');
  });

  it('passes text content to ansi-to-react for processing', () => {
    const ansiText = '\u001B[31mRed Text\u001B[0m';
    const { container } = render(<AnsiSpan>{ansiText}</AnsiSpan>);
    const span = container.querySelector('span');
    expect(span).toBeDefined();
    // The mocked ansi-to-react just renders the text as-is
    expect(container.textContent).toContain('Red');
  });

  it('handles text with newlines', () => {
    const text = 'Start\nMiddle\nEnd';
    const { container } = render(<AnsiSpan>{text}</AnsiSpan>);
    expect(container.textContent).toContain('Start');
    expect(container.textContent).toContain('Middle');
    expect(container.textContent).toContain('End');
  });
});
