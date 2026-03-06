import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Mock Toast module
// ---------------------------------------------------------------------------
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock('@/components/Toast', () => ({
  useToast: () => ({
    toast: (type: string, msg: string) => mockToast[type as 'success' | 'error' | 'info']?.(msg),
    success: mockToast.success,
    error: mockToast.error,
    info: mockToast.info,
  }),
  ToastContainer: () => null,
}));

// ---------------------------------------------------------------------------
// Mock @/lib/utils
// ---------------------------------------------------------------------------
vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// ---------------------------------------------------------------------------
// Mock @/components/ui/tooltip (used by SimpleTooltip)
// ---------------------------------------------------------------------------
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div data-testid="tooltip-content">{children}</div>,
}));

// ---------------------------------------------------------------------------
// Mock ansi-to-react — render ANSI codes as spans with data attributes
// ---------------------------------------------------------------------------
vi.mock('ansi-to-react', () => ({
  default: ({ children }: { children: string }) => <span data-testid="ansi-output">{children}</span>,
}));

// ---------------------------------------------------------------------------
// Mock lucide-react icons
// ---------------------------------------------------------------------------
vi.mock('lucide-react', () => ({
  Copy: () => <span data-testid="icon-copy">copy-icon</span>,
  Check: () => <span data-testid="icon-check">check-icon</span>,
}));

// ---------------------------------------------------------------------------
// Mock gitStatusQuery for GitStatusBadge
// ---------------------------------------------------------------------------
const mockGitData = vi.hoisted(() => ({
  current: null as unknown,
  isLoading: false,
  isError: false,
}));

vi.mock('../lib/queries', () => ({
  gitStatusQuery: () => ({
    queryKey: ['git-status', 'machine-1', '/project'],
    queryFn: () => Promise.resolve(mockGitData.current),
  }),
}));

// We need to mock useQuery to control loading/error/data states directly
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQuery: () => ({
      data: mockGitData.current,
      isLoading: mockGitData.isLoading,
      isError: mockGitData.isError,
    }),
  };
});

// ---------------------------------------------------------------------------
// Clipboard mock
// ---------------------------------------------------------------------------
beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
    writable: true,
  });
  mockToast.success.mockClear();
  mockToast.error.mockClear();
  mockGitData.current = null;
  mockGitData.isLoading = false;
  mockGitData.isError = false;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { PathBadge } from './PathBadge';
import { AnsiText, AnsiSpan } from './AnsiText';
import { HighlightText } from './HighlightText';
import { GitStatusBadge } from './GitStatusBadge';
import { CopyableText } from './CopyableText';

// ===========================================================================
// PathBadge
// ===========================================================================

describe('PathBadge', () => {
  it('renders fallback when path is null', () => {
    render(<PathBadge path={null} />);
    expect(screen.getByText('-')).toBeDefined();
  });

  it('renders fallback when path is undefined', () => {
    render(<PathBadge path={undefined} />);
    expect(screen.getByText('-')).toBeDefined();
  });

  it('renders custom fallback text', () => {
    render(<PathBadge path={null} fallback="N/A" />);
    expect(screen.getByText('N/A')).toBeDefined();
  });

  it('renders shortened path for long paths', () => {
    render(<PathBadge path="/Users/someone/projects/agentctl/packages/web" />);
    // shortenPath replaces /Users/someone/ with ~/ and truncates
    // ~/projects/agentctl/packages/web -> segments > 3 -> ~/.../{last2}
    expect(screen.getByText('~/.../', { exact: false })).toBeDefined();
  });

  it('renders a short path directly', () => {
    render(<PathBadge path="/tmp/foo" />);
    // Both button and tooltip contain the text; use getByRole to target the button
    const button = screen.getByRole('button');
    expect(button.textContent).toBe('/tmp/foo');
  });

  it('renders a button with aria-label containing the full path', () => {
    render(<PathBadge path="/home/user/project" />);
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-label')).toBe('Copy path: /home/user/project');
  });

  it('copies path to clipboard on click', async () => {
    render(<PathBadge path="/Users/dev/my-project" />);
    const button = screen.getByRole('button');

    await act(async () => {
      fireEvent.click(button);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('/Users/dev/my-project');
  });

  it('shows success toast after successful copy', async () => {
    render(<PathBadge path="/some/path" />);
    const button = screen.getByRole('button');

    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockToast.success).toHaveBeenCalledWith('Path copied');
  });

  it('shows error toast when clipboard fails', async () => {
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('denied'));
    render(<PathBadge path="/some/path" />);
    const button = screen.getByRole('button');

    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockToast.error).toHaveBeenCalledWith('Failed to copy');
  });

  it('does not attempt copy when path is null', () => {
    render(<PathBadge path={null} />);
    // Fallback is a span, not a button
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows full path in tooltip content', () => {
    render(<PathBadge path="/Users/dev/long/nested/deep/project" />);
    expect(screen.getByText('/Users/dev/long/nested/deep/project')).toBeDefined();
  });
});

// ===========================================================================
// AnsiText
// ===========================================================================

describe('AnsiText', () => {
  it('renders children inside a pre element', () => {
    const { container } = render(<AnsiText>Hello world</AnsiText>);
    const pre = container.querySelector('pre');
    expect(pre).toBeDefined();
    expect(pre).not.toBeNull();
  });

  it('passes text to ansi-to-react component', () => {
    render(<AnsiText>some ansi text</AnsiText>);
    const output = screen.getByTestId('ansi-output');
    expect(output.textContent).toBe('some ansi text');
  });

  it('applies className to pre element', () => {
    const { container } = render(<AnsiText className="custom-class">text</AnsiText>);
    const pre = container.querySelector('pre');
    expect(pre?.className).toContain('custom-class');
  });

  it('handles text with ANSI escape sequences', () => {
    const ansiText = '\x1b[31mred text\x1b[0m';
    render(<AnsiText>{ansiText}</AnsiText>);
    const output = screen.getByTestId('ansi-output');
    expect(output.textContent).toBe(ansiText);
  });

  it('handles empty string', () => {
    render(<AnsiText>{''}</AnsiText>);
    const output = screen.getByTestId('ansi-output');
    expect(output.textContent).toBe('');
  });
});

describe('AnsiSpan', () => {
  it('renders children inside a span (not pre)', () => {
    const { container } = render(<AnsiSpan>Hello</AnsiSpan>);
    const pre = container.querySelector('pre');
    expect(pre).toBeNull();
    const span = container.querySelector('span');
    expect(span).not.toBeNull();
  });

  it('passes text to ansi-to-react component', () => {
    render(<AnsiSpan>inline ansi</AnsiSpan>);
    const output = screen.getByTestId('ansi-output');
    expect(output.textContent).toBe('inline ansi');
  });

  it('applies className to the outer span', () => {
    const { container } = render(<AnsiSpan className="inline-style">text</AnsiSpan>);
    // The outermost span should have the className
    const outerSpan = container.firstElementChild;
    expect(outerSpan?.className).toContain('inline-style');
  });
});

// ===========================================================================
// HighlightText
// ===========================================================================

describe('HighlightText', () => {
  it('renders plain text when highlight is empty', () => {
    render(<HighlightText text="Hello world" highlight="" />);
    expect(screen.getByText('Hello world')).toBeDefined();
    expect(screen.queryByRole('mark')).toBeNull();
  });

  it('renders plain text when highlight is whitespace', () => {
    render(<HighlightText text="Hello world" highlight="   " />);
    expect(screen.getByText('Hello world')).toBeDefined();
  });

  it('highlights matching substring', () => {
    const { container } = render(<HighlightText text="Hello world" highlight="world" />);
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe('world');
  });

  it('highlights case-insensitively', () => {
    const { container } = render(<HighlightText text="Hello World" highlight="hello" />);
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe('Hello');
  });

  it('highlights multiple occurrences', () => {
    const { container } = render(<HighlightText text="foo bar foo baz foo" highlight="foo" />);
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(3);
  });

  it('renders no marks when highlight does not match', () => {
    const { container } = render(<HighlightText text="Hello world" highlight="xyz" />);
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(0);
  });

  it('escapes regex special characters in highlight', () => {
    const { container } = render(<HighlightText text="price is $100.00" highlight="$100.00" />);
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe('$100.00');
  });

  it('applies className to the outer span', () => {
    const { container } = render(
      <HighlightText text="test" highlight="" className="my-class" />,
    );
    const span = container.firstElementChild;
    expect(span?.className).toContain('my-class');
  });

  it('applies highlight CSS classes to mark elements', () => {
    const { container } = render(<HighlightText text="hello" highlight="hello" />);
    const mark = container.querySelector('mark');
    expect(mark?.className).toContain('bg-yellow-500/30');
  });
});

// ===========================================================================
// GitStatusBadge
// ===========================================================================

describe('GitStatusBadge', () => {
  it('renders loading state', () => {
    mockGitData.isLoading = true;
    render(<GitStatusBadge machineId="m1" projectPath="/project" />);
    expect(screen.getByText('git: loading...')).toBeDefined();
  });

  it('returns null on error', () => {
    mockGitData.isError = true;
    const { container } = render(<GitStatusBadge machineId="m1" projectPath="/project" />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null when data is null', () => {
    mockGitData.current = null;
    const { container } = render(<GitStatusBadge machineId="m1" projectPath="/project" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders branch name', () => {
    mockGitData.current = {
      branch: 'main',
      worktree: '/project',
      isWorktree: false,
      bareRepo: null,
      status: { clean: true, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0 },
      lastCommit: null,
      worktrees: [],
    };
    render(<GitStatusBadge machineId="m1" projectPath="/project" />);
    expect(screen.getByText('main')).toBeDefined();
  });

  it('shows "clean" when status is clean', () => {
    mockGitData.current = {
      branch: 'main',
      worktree: '/project',
      isWorktree: false,
      bareRepo: null,
      status: { clean: true, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0 },
      lastCommit: null,
      worktrees: [],
    };
    render(<GitStatusBadge machineId="m1" projectPath="/project" />);
    expect(screen.getByText('clean')).toBeDefined();
  });

  it('shows staged/modified/untracked counts', () => {
    mockGitData.current = {
      branch: 'dev',
      worktree: '/project',
      isWorktree: false,
      bareRepo: null,
      status: { clean: false, staged: 2, modified: 3, untracked: 1, ahead: 0, behind: 0 },
      lastCommit: null,
      worktrees: [],
    };
    render(<GitStatusBadge machineId="m1" projectPath="/project" />);
    expect(screen.getByText('2 staged, 3 modified, 1 untracked')).toBeDefined();
  });

  it('shows ahead/behind indicators', () => {
    mockGitData.current = {
      branch: 'feature',
      worktree: '/project',
      isWorktree: false,
      bareRepo: null,
      status: { clean: true, staged: 0, modified: 0, untracked: 0, ahead: 3, behind: 1 },
      lastCommit: null,
      worktrees: [],
    };
    render(<GitStatusBadge machineId="m1" projectPath="/project" />);
    // Unicode arrows: \u2191 = up, \u2193 = down
    expect(screen.getByText('\u21913 \u21931')).toBeDefined();
  });

  it('does not show ahead/behind when both are 0', () => {
    mockGitData.current = {
      branch: 'main',
      worktree: '/project',
      isWorktree: false,
      bareRepo: null,
      status: { clean: true, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0 },
      lastCommit: null,
      worktrees: [],
    };
    const { container } = render(<GitStatusBadge machineId="m1" projectPath="/project" />);
    // No element with blue text class for ahead/behind
    const blueSpan = container.querySelector('.text-blue-600');
    expect(blueSpan).toBeNull();
  });

  it('shows worktree badge when isWorktree is true', () => {
    mockGitData.current = {
      branch: 'feature',
      worktree: '/project/.trees/wt1',
      isWorktree: true,
      bareRepo: '/project/.bare',
      status: { clean: true, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0 },
      lastCommit: null,
      worktrees: [],
    };
    render(<GitStatusBadge machineId="m1" projectPath="/project" />);
    expect(screen.getByText('worktree')).toBeDefined();
  });

  it('does not show worktree badge when isWorktree is false', () => {
    mockGitData.current = {
      branch: 'main',
      worktree: '/project',
      isWorktree: false,
      bareRepo: null,
      status: { clean: true, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0 },
      lastCommit: null,
      worktrees: [],
    };
    render(<GitStatusBadge machineId="m1" projectPath="/project" />);
    expect(screen.queryByText('worktree')).toBeNull();
  });

  it('shows last commit hash and message', () => {
    mockGitData.current = {
      branch: 'main',
      worktree: '/project',
      isWorktree: false,
      bareRepo: null,
      status: { clean: true, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0 },
      lastCommit: { hash: 'abc1234', message: 'fix: broken tests', author: 'dev', date: '2026-03-01' },
      worktrees: [],
    };
    render(<GitStatusBadge machineId="m1" projectPath="/project" />);
    expect(screen.getByText('abc1234')).toBeDefined();
    expect(screen.getByText('fix: broken tests')).toBeDefined();
  });

  it('shows worktree count toggle when multiple worktrees exist', () => {
    mockGitData.current = {
      branch: 'main',
      worktree: '/project',
      isWorktree: false,
      bareRepo: null,
      status: { clean: true, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0 },
      lastCommit: null,
      worktrees: [
        { path: '/project', branch: 'main', isMain: true },
        { path: '/project/.trees/wt1', branch: 'feature-a', isMain: false },
      ],
    };
    render(<GitStatusBadge machineId="m1" projectPath="/project" />);
    expect(screen.getByText('2 worktrees')).toBeDefined();
  });

  it('expands worktree list on toggle click', () => {
    mockGitData.current = {
      branch: 'main',
      worktree: '/project',
      isWorktree: false,
      bareRepo: null,
      status: { clean: true, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0 },
      lastCommit: null,
      worktrees: [
        { path: '/project', branch: 'main', isMain: true },
        { path: '/project/.trees/wt1', branch: 'feature-a', isMain: false },
      ],
    };
    render(<GitStatusBadge machineId="m1" projectPath="/project" />);

    const toggle = screen.getByText('2 worktrees');
    fireEvent.click(toggle);

    // After expanding, should show worktree branches
    expect(screen.getByText('feature-a')).toBeDefined();
    // Toggle text should change to "hide"
    expect(screen.getByText('hide')).toBeDefined();
  });

  it('does not show toggle when only one worktree', () => {
    mockGitData.current = {
      branch: 'main',
      worktree: '/project',
      isWorktree: false,
      bareRepo: null,
      status: { clean: true, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0 },
      lastCommit: null,
      worktrees: [{ path: '/project', branch: 'main', isMain: true }],
    };
    render(<GitStatusBadge machineId="m1" projectPath="/project" />);
    expect(screen.queryByText('1 worktrees')).toBeNull();
  });

  it('shows "main" badge for main worktree entry', () => {
    mockGitData.current = {
      branch: 'main',
      worktree: '/project',
      isWorktree: false,
      bareRepo: null,
      status: { clean: true, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0 },
      lastCommit: null,
      worktrees: [
        { path: '/project', branch: 'main', isMain: true },
        { path: '/project/.trees/wt1', branch: 'dev', isMain: false },
      ],
    };
    render(<GitStatusBadge machineId="m1" projectPath="/project" />);
    fireEvent.click(screen.getByText('2 worktrees'));

    // "main" appears both as branch name and as a badge
    const mainTexts = screen.getAllByText('main');
    // At least 2: one in branch display, one as badge in expanded list
    expect(mainTexts.length).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================================================
// CopyableText
// ===========================================================================

describe('CopyableText', () => {
  it('renders truncated value by default (maxDisplay=8)', () => {
    render(<CopyableText value="abcdefghijklmnop" />);
    // Should show first 8 chars
    expect(screen.getByText('abcdefgh')).toBeDefined();
  });

  it('renders full value when shorter than maxDisplay', () => {
    render(<CopyableText value="short" />);
    expect(screen.getByText('short')).toBeDefined();
  });

  it('renders full value when exactly maxDisplay length', () => {
    render(<CopyableText value="12345678" />);
    expect(screen.getByText('12345678')).toBeDefined();
  });

  it('respects custom maxDisplay', () => {
    render(<CopyableText value="abcdefghij" maxDisplay={4} />);
    expect(screen.getByText('abcd')).toBeDefined();
  });

  it('renders label instead of value when label is provided', () => {
    render(<CopyableText value="secret-value-123456" label="API Key" />);
    expect(screen.getByText('API Key')).toBeDefined();
    expect(screen.queryByText('secret-v')).toBeNull();
  });

  it('copies full value to clipboard on click', async () => {
    render(<CopyableText value="full-value-to-copy" />);
    const button = screen.getByRole('button');

    await act(async () => {
      fireEvent.click(button);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('full-value-to-copy');
  });

  it('shows "Copied!" text after successful copy', async () => {
    render(<CopyableText value="test-value" />);
    const button = screen.getByRole('button');

    await act(async () => {
      fireEvent.click(button);
    });

    expect(screen.getByText('Copied!')).toBeDefined();
  });

  it('shows check icon after successful copy', async () => {
    render(<CopyableText value="test-value" />);
    const button = screen.getByRole('button');

    await act(async () => {
      fireEvent.click(button);
    });

    expect(screen.getByTestId('icon-check')).toBeDefined();
  });

  it('shows copy icon before copying', () => {
    render(<CopyableText value="test-value" />);
    expect(screen.getByTestId('icon-copy')).toBeDefined();
  });

  it('reverts to original state after 1500ms', async () => {
    vi.useFakeTimers();
    render(<CopyableText value="test-value" />);
    const button = screen.getByRole('button');

    await act(async () => {
      fireEvent.click(button);
    });

    expect(screen.getByText('Copied!')).toBeDefined();

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    // Should revert to showing the truncated value
    expect(screen.getByText('test-val')).toBeDefined();
    expect(screen.queryByText('Copied!')).toBeNull();
  });

  it('shows error toast when clipboard fails', async () => {
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('denied'));
    render(<CopyableText value="test" />);
    const button = screen.getByRole('button');

    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockToast.error).toHaveBeenCalledWith('Failed to copy');
  });

  it('has title attribute showing "Click to copy" with value', () => {
    render(<CopyableText value="my-id-123" />);
    const button = screen.getByRole('button');
    expect(button.getAttribute('title')).toBe('Click to copy: my-id-123');
  });

  it('stops event propagation on click', async () => {
    const parentClick = vi.fn();
    render(
      // biome-ignore lint/a11y/useKeyWithClickEvents: test only
      <div onClick={parentClick}>
        <CopyableText value="test" />
      </div>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });

    expect(parentClick).not.toHaveBeenCalled();
  });
});
