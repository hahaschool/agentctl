import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (...args: unknown[]) => mockUseQuery(...args),
  };
});

import { GitStatusBadge } from './GitStatusBadge';

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

const defaultProps = { machineId: 'mac-1', projectPath: '/home/project' };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GitStatusBadge', () => {
  describe('loading state', () => {
    it('shows loading indicator when query is loading', () => {
      mockUseQuery.mockReturnValue({ data: undefined, isLoading: true, isError: false });
      renderWithQuery(<GitStatusBadge {...defaultProps} />);
      expect(screen.getByText('git: loading...')).toBeDefined();
    });
  });

  describe('error / null states', () => {
    it('returns null on query error', () => {
      mockUseQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true });
      const { container } = renderWithQuery(<GitStatusBadge {...defaultProps} />);
      expect(container.innerHTML).toBe('');
    });

    it('returns null when data is null', () => {
      mockUseQuery.mockReturnValue({ data: null, isLoading: false, isError: false });
      const { container } = renderWithQuery(<GitStatusBadge {...defaultProps} />);
      expect(container.innerHTML).toBe('');
    });

    it('returns null when data is undefined and not loading', () => {
      mockUseQuery.mockReturnValue({ data: undefined, isLoading: false, isError: false });
      const { container } = renderWithQuery(<GitStatusBadge {...defaultProps} />);
      expect(container.innerHTML).toBe('');
    });
  });

  describe('clean status', () => {
    it('displays branch name and "clean" text', () => {
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
      expect(screen.getByText('main')).toBeDefined();
      expect(screen.getByText('branch:')).toBeDefined();
      expect(screen.getByText('clean')).toBeDefined();
    });
  });

  describe('dirty status', () => {
    it('shows staged count', () => {
      mockUseQuery.mockReturnValue({
        data: {
          branch: 'dev',
          status: { clean: false, staged: 5, modified: 0, untracked: 0, ahead: 0, behind: 0 },
          isWorktree: false,
          lastCommit: null,
          worktrees: [],
        },
        isLoading: false,
        isError: false,
      });
      renderWithQuery(<GitStatusBadge {...defaultProps} />);
      expect(screen.getByText('5 staged')).toBeDefined();
    });

    it('shows modified count', () => {
      mockUseQuery.mockReturnValue({
        data: {
          branch: 'dev',
          status: { clean: false, staged: 0, modified: 3, untracked: 0, ahead: 0, behind: 0 },
          isWorktree: false,
          lastCommit: null,
          worktrees: [],
        },
        isLoading: false,
        isError: false,
      });
      renderWithQuery(<GitStatusBadge {...defaultProps} />);
      expect(screen.getByText('3 modified')).toBeDefined();
    });

    it('shows untracked count', () => {
      mockUseQuery.mockReturnValue({
        data: {
          branch: 'dev',
          status: { clean: false, staged: 0, modified: 0, untracked: 7, ahead: 0, behind: 0 },
          isWorktree: false,
          lastCommit: null,
          worktrees: [],
        },
        isLoading: false,
        isError: false,
      });
      renderWithQuery(<GitStatusBadge {...defaultProps} />);
      expect(screen.getByText('7 untracked')).toBeDefined();
    });

    it('shows combined dirty status summary', () => {
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
  });

  describe('ahead / behind indicators', () => {
    it('displays ahead indicator', () => {
      mockUseQuery.mockReturnValue({
        data: {
          branch: 'main',
          status: { clean: true, staged: 0, modified: 0, untracked: 0, ahead: 5, behind: 0 },
          isWorktree: false,
          lastCommit: null,
          worktrees: [],
        },
        isLoading: false,
        isError: false,
      });
      renderWithQuery(<GitStatusBadge {...defaultProps} />);
      expect(screen.getByText('\u21915')).toBeDefined();
    });

    it('displays behind indicator', () => {
      mockUseQuery.mockReturnValue({
        data: {
          branch: 'main',
          status: { clean: true, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 2 },
          isWorktree: false,
          lastCommit: null,
          worktrees: [],
        },
        isLoading: false,
        isError: false,
      });
      renderWithQuery(<GitStatusBadge {...defaultProps} />);
      expect(screen.getByText('\u21932')).toBeDefined();
    });

    it('displays both ahead and behind indicators', () => {
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

    it('does not render ahead/behind when both are 0', () => {
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
      expect(screen.queryByText(/\u2191/)).toBeNull();
      expect(screen.queryByText(/\u2193/)).toBeNull();
    });
  });

  describe('worktree badge', () => {
    it('shows "worktree" badge when isWorktree is true', () => {
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

    it('does not show "worktree" badge when isWorktree is false', () => {
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
      expect(screen.queryByText('worktree')).toBeNull();
    });
  });

  describe('last commit', () => {
    it('displays last commit hash and message', () => {
      mockUseQuery.mockReturnValue({
        data: {
          branch: 'main',
          status: { clean: true, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0 },
          isWorktree: false,
          lastCommit: {
            hash: 'abc1234',
            message: 'fix: resolve bug',
            author: 'dev',
            date: '2026-01-01',
          },
          worktrees: [],
        },
        isLoading: false,
        isError: false,
      });
      renderWithQuery(<GitStatusBadge {...defaultProps} />);
      expect(screen.getByText('abc1234')).toBeDefined();
      expect(screen.getByText('fix: resolve bug')).toBeDefined();
    });

    it('does not render commit info when lastCommit is null', () => {
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
      expect(screen.queryByText('abc1234')).toBeNull();
    });
  });

  describe('worktree expand / collapse', () => {
    const worktreeData = {
      branch: 'main',
      status: { clean: true, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0 },
      isWorktree: false,
      lastCommit: null,
      worktrees: [
        { path: '/repo/.trees/wt1', branch: 'main', isMain: true },
        { path: '/repo/.trees/wt2', branch: 'feat/a', isMain: false },
      ],
    };

    it('shows toggle button when multiple worktrees exist', () => {
      mockUseQuery.mockReturnValue({ data: worktreeData, isLoading: false, isError: false });
      renderWithQuery(<GitStatusBadge {...defaultProps} />);
      const toggle = screen.getByRole('button', { name: /Show 2 worktrees/ });
      expect(toggle).toBeDefined();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
    });

    it('does not show toggle when only one worktree exists', () => {
      mockUseQuery.mockReturnValue({
        data: {
          ...worktreeData,
          worktrees: [{ path: '/repo/.trees/wt1', branch: 'main', isMain: true }],
        },
        isLoading: false,
        isError: false,
      });
      renderWithQuery(<GitStatusBadge {...defaultProps} />);
      expect(screen.queryByRole('button', { name: /worktrees/ })).toBeNull();
    });

    it('expands worktree list on toggle click', () => {
      mockUseQuery.mockReturnValue({ data: worktreeData, isLoading: false, isError: false });
      renderWithQuery(<GitStatusBadge {...defaultProps} />);
      const toggle = screen.getByRole('button', { name: /Show 2 worktrees/ });

      fireEvent.click(toggle);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByText('feat/a')).toBeDefined();
      expect(screen.getByText('hide')).toBeDefined();
    });

    it('collapses worktree list on second toggle click', () => {
      mockUseQuery.mockReturnValue({ data: worktreeData, isLoading: false, isError: false });
      renderWithQuery(<GitStatusBadge {...defaultProps} />);
      const toggle = screen.getByRole('button', { name: /Show 2 worktrees/ });

      // Expand
      fireEvent.click(toggle);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');

      // Collapse
      fireEvent.click(toggle);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
    });

    it('shows "main" badge on main worktree entries', () => {
      mockUseQuery.mockReturnValue({ data: worktreeData, isLoading: false, isError: false });
      renderWithQuery(<GitStatusBadge {...defaultProps} />);
      const toggle = screen.getByRole('button', { name: /Show 2 worktrees/ });
      fireEvent.click(toggle);
      // "main" appears as both the branch name and the worktree badge
      const mainElements = screen.getAllByText('main');
      expect(mainElements.length).toBeGreaterThanOrEqual(2);
    });

    it('shows "(detached)" for worktree with null branch', () => {
      mockUseQuery.mockReturnValue({
        data: {
          ...worktreeData,
          worktrees: [
            { path: '/repo/.trees/wt1', branch: 'main', isMain: true },
            { path: '/repo/.trees/detached', branch: null, isMain: false },
          ],
        },
        isLoading: false,
        isError: false,
      });
      renderWithQuery(<GitStatusBadge {...defaultProps} />);
      const toggle = screen.getByRole('button', { name: /Show 2 worktrees/ });
      fireEvent.click(toggle);
      expect(screen.getByText('(detached)')).toBeDefined();
    });
  });

  describe('className prop', () => {
    it('applies custom className', () => {
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
      const { container } = renderWithQuery(
        <GitStatusBadge {...defaultProps} className="my-extra" />,
      );
      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toContain('my-extra');
    });
  });
});
