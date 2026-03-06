import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — must be declared before component imports
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

const mockGitStatusQuery = vi.fn();
vi.mock('../lib/queries', () => ({
  gitStatusQuery: (...args: unknown[]) => mockGitStatusQuery(...args),
}));

const mockUseQuery = vi.fn();
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (...args: unknown[]) => mockUseQuery(...args),
  };
});

vi.mock('@/lib/keyboard-shortcuts', () => ({
  SHORTCUT_GROUPS: [
    {
      title: 'Global',
      shortcuts: [
        { keys: ['?'], desc: 'Show keyboard shortcuts' },
        { keys: ['Esc'], desc: 'Close panels' },
      ],
    },
    {
      title: 'Sessions',
      shortcuts: [
        { keys: ['r'], desc: 'Refresh' },
        { keys: ['n'], desc: 'New session' },
      ],
    },
  ],
}));

// ---------------------------------------------------------------------------
// Component imports — AFTER mocks
// ---------------------------------------------------------------------------

import { GitStatusBadge } from './GitStatusBadge';
import { KeyboardHelpOverlay } from './KeyboardHelpOverlay';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderWithQuery(ui: React.ReactElement): ReturnType<typeof render> {
  const qc = createQueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// GitStatusBadge
// ===========================================================================

describe('GitStatusBadge', () => {
  const defaultProps = { machineId: 'mac-1', projectPath: '/home/project' };

  it('shows loading state when query is loading', () => {
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderWithQuery(<GitStatusBadge {...defaultProps} />);
    expect(screen.getByText('git: loading...')).toBeDefined();
  });

  it('returns null on error', () => {
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    const { container } = renderWithQuery(<GitStatusBadge {...defaultProps} />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null when data is null', () => {
    mockUseQuery.mockReturnValue({ data: null, isLoading: false, isError: false });
    const { container } = renderWithQuery(<GitStatusBadge {...defaultProps} />);
    expect(container.innerHTML).toBe('');
  });

  it('displays the branch name', () => {
    mockUseQuery.mockReturnValue({
      data: {
        branch: 'feat/cool',
        status: { clean: true, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0 },
        isWorktree: false,
        lastCommit: null,
        worktrees: [],
      },
      isLoading: false,
      isError: false,
    });
    renderWithQuery(<GitStatusBadge {...defaultProps} />);
    expect(screen.getByText('feat/cool')).toBeDefined();
    expect(screen.getByText('branch:')).toBeDefined();
  });

  it('shows "clean" when status is clean', () => {
    mockUseQuery.mockReturnValue({
      data: {
        branch: 'main',
        status: { clean: true, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0 },
        isWorktree: false,
        lastCommit: null,
        worktrees: [],
      },
      isLoading: false,
      isError: false,
    });
    renderWithQuery(<GitStatusBadge {...defaultProps} />);
    expect(screen.getByText('clean')).toBeDefined();
  });

  it('shows dirty status summary when files are modified', () => {
    mockUseQuery.mockReturnValue({
      data: {
        branch: 'dev',
        status: { clean: false, staged: 2, modified: 3, untracked: 1, ahead: 0, behind: 0 },
        isWorktree: false,
        lastCommit: null,
        worktrees: [],
      },
      isLoading: false,
      isError: false,
    });
    renderWithQuery(<GitStatusBadge {...defaultProps} />);
    expect(screen.getByText('2 staged, 3 modified, 1 untracked')).toBeDefined();
  });

  it('displays ahead/behind indicators', () => {
    mockUseQuery.mockReturnValue({
      data: {
        branch: 'main',
        status: { clean: true, staged: 0, modified: 0, untracked: 0, ahead: 3, behind: 1 },
        isWorktree: false,
        lastCommit: null,
        worktrees: [],
      },
      isLoading: false,
      isError: false,
    });
    renderWithQuery(<GitStatusBadge {...defaultProps} />);
    expect(screen.getByText('\u21913 \u21931')).toBeDefined();
  });

  it('shows worktree badge when isWorktree is true', () => {
    mockUseQuery.mockReturnValue({
      data: {
        branch: 'main',
        status: { clean: true, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0 },
        isWorktree: true,
        lastCommit: null,
        worktrees: [],
      },
      isLoading: false,
      isError: false,
    });
    renderWithQuery(<GitStatusBadge {...defaultProps} />);
    expect(screen.getByText('worktree')).toBeDefined();
  });

  it('displays last commit hash and message', () => {
    mockUseQuery.mockReturnValue({
      data: {
        branch: 'main',
        status: { clean: true, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0 },
        isWorktree: false,
        lastCommit: { hash: 'abc1234', message: 'fix: resolve bug', author: 'dev', date: '2026-01-01' },
        worktrees: [],
      },
      isLoading: false,
      isError: false,
    });
    renderWithQuery(<GitStatusBadge {...defaultProps} />);
    expect(screen.getByText('abc1234')).toBeDefined();
    expect(screen.getByText('fix: resolve bug')).toBeDefined();
  });

  it('shows worktree expand toggle when multiple worktrees exist', () => {
    mockUseQuery.mockReturnValue({
      data: {
        branch: 'main',
        status: { clean: true, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0 },
        isWorktree: false,
        lastCommit: null,
        worktrees: [
          { path: '/repo/.trees/wt1', branch: 'main', isMain: true },
          { path: '/repo/.trees/wt2', branch: 'feat/a', isMain: false },
        ],
      },
      isLoading: false,
      isError: false,
    });
    renderWithQuery(<GitStatusBadge {...defaultProps} />);
    const toggle = screen.getByRole('button', { name: /Show 2 worktrees/ });
    expect(toggle).toBeDefined();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('expands and collapses worktree list on toggle click', () => {
    mockUseQuery.mockReturnValue({
      data: {
        branch: 'main',
        status: { clean: true, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0 },
        isWorktree: false,
        lastCommit: null,
        worktrees: [
          { path: '/repo/.trees/wt1', branch: 'main', isMain: true },
          { path: '/repo/.trees/wt2', branch: 'feat/a', isMain: false },
        ],
      },
      isLoading: false,
      isError: false,
    });
    renderWithQuery(<GitStatusBadge {...defaultProps} />);
    const toggle = screen.getByRole('button', { name: /Show 2 worktrees/ });

    // Expand
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('feat/a')).toBeDefined();
    expect(screen.getByText('hide')).toBeDefined();

    // Collapse
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});

// ===========================================================================
// KeyboardHelpOverlay
// ===========================================================================

describe('KeyboardHelpOverlay', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<KeyboardHelpOverlay open={false} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows overlay when open', () => {
    render(<KeyboardHelpOverlay open={true} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { hidden: true, name: 'Keyboard shortcuts' })).toBeDefined();
    expect(screen.getByText('Keyboard Shortcuts')).toBeDefined();
  });

  it('displays shortcut groups', () => {
    render(<KeyboardHelpOverlay open={true} onClose={vi.fn()} />);
    expect(screen.getByText('Global')).toBeDefined();
    expect(screen.getByText('Sessions')).toBeDefined();
    expect(screen.getByText('Show keyboard shortcuts')).toBeDefined();
    expect(screen.getByText('Close panels')).toBeDefined();
    expect(screen.getByText('Refresh')).toBeDefined();
    expect(screen.getByText('New session')).toBeDefined();
  });

  it('close button calls onClose', () => {
    const onClose = vi.fn();
    render(<KeyboardHelpOverlay open={true} onClose={onClose} />);
    const closeBtn = screen.getByLabelText('Close');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('backdrop click calls onClose', () => {
    const onClose = vi.fn();
    const { container } = render(<KeyboardHelpOverlay open={true} onClose={onClose} />);
    // The outermost div is the backdrop wrapper
    const backdrop = container.firstChild as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape key calls onClose', () => {
    const onClose = vi.fn();
    render(<KeyboardHelpOverlay open={true} onClose={onClose} />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders kbd elements for shortcut keys', () => {
    const { container } = render(<KeyboardHelpOverlay open={true} onClose={vi.fn()} />);
    const kbds = container.querySelectorAll('kbd');
    // At minimum: ?, Esc (in Global group), r, n (in Sessions group), Esc (close btn), ?, Esc (footer)
    expect(kbds.length).toBeGreaterThanOrEqual(4);
    const kbdTexts = Array.from(kbds).map((kbd) => kbd.textContent?.trim());
    expect(kbdTexts).toContain('?');
    expect(kbdTexts).toContain('Esc');
    expect(kbdTexts).toContain('r');
    expect(kbdTexts).toContain('n');
  });
});
