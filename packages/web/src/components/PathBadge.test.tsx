import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before component imports
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('./SimpleTooltip', () => ({
  SimpleTooltip: ({ content, children }: { content: string; children: React.ReactNode }) => (
    <div data-testid="simple-tooltip" data-tooltip-content={content}>
      {children}
    </div>
  ),
}));

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

import { PathBadge } from './PathBadge';

afterEach(() => {
  vi.restoreAllMocks();
  mockToast.success.mockClear();
  mockToast.error.mockClear();
});

// Set up clipboard mock
beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
    writable: true,
  });
});

describe('PathBadge', () => {
  describe('rendering with valid path', () => {
    it('renders a shortened path for a long path', () => {
      render(<PathBadge path="/Users/john/projects/agentctl/packages/web" />);
      // shortenPath replaces /Users/john/ with ~/ and truncates
      const button = screen.getByRole('button');
      expect(button.textContent).toBeDefined();
      expect(button.textContent!.length).toBeGreaterThan(0);
    });

    it('renders the full path in the tooltip', () => {
      const fullPath = '/Users/john/projects/agentctl/packages/web';
      render(<PathBadge path={fullPath} />);
      const tooltip = screen.getByTestId('simple-tooltip');
      expect(tooltip.getAttribute('data-tooltip-content')).toBe(fullPath);
    });

    it('renders a button element for clickable copy', () => {
      render(<PathBadge path="/home/user/project" />);
      const button = screen.getByRole('button');
      expect(button.tagName).toBe('BUTTON');
    });

    it('sets aria-label with the full path', () => {
      const fullPath = '/home/user/project';
      render(<PathBadge path={fullPath} />);
      const button = screen.getByRole('button');
      expect(button.getAttribute('aria-label')).toBe(`Copy path: ${fullPath}`);
    });
  });

  describe('fallback when path is null/undefined', () => {
    it('renders fallback text "-" when path is null', () => {
      render(<PathBadge path={null} />);
      expect(screen.getByText('-')).toBeDefined();
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('renders fallback text "-" when path is undefined', () => {
      render(<PathBadge path={undefined} />);
      expect(screen.getByText('-')).toBeDefined();
    });

    it('renders custom fallback text', () => {
      render(<PathBadge path={null} fallback="N/A" />);
      expect(screen.getByText('N/A')).toBeDefined();
      expect(screen.queryByText('-')).toBeNull();
    });

    it('does not render a button when path is null', () => {
      render(<PathBadge path={null} />);
      expect(screen.queryByRole('button')).toBeNull();
    });
  });

  describe('truncation behavior', () => {
    it('shows shortened path for deeply nested paths', () => {
      render(<PathBadge path="/Users/dev/a/b/c/d/e/f/project" />);
      const button = screen.getByRole('button');
      // shortenPath should truncate to last 2 segments with ~/.../ prefix
      expect(button.textContent).toContain('...');
    });

    it('shows short paths without truncation', () => {
      render(<PathBadge path="/tmp/test" />);
      const button = screen.getByRole('button');
      expect(button.textContent).toBe('/tmp/test');
    });
  });

  describe('copy to clipboard', () => {
    it('copies full path to clipboard on click and shows success toast', async () => {
      const fullPath = '/home/user/project';
      render(<PathBadge path={fullPath} />);
      const button = screen.getByRole('button');
      fireEvent.click(button);

      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(fullPath);
      });
      await waitFor(() => {
        expect(mockToast.success).toHaveBeenCalledWith('Path copied');
      });
    });

    it('shows error toast when clipboard write fails', async () => {
      (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('denied'),
      );
      render(<PathBadge path="/home/user/project" />);
      const button = screen.getByRole('button');
      fireEvent.click(button);

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('Failed to copy');
      });
    });

    it('does not attempt copy when path is null', () => {
      render(<PathBadge path={null} />);
      // Fallback is a span, not a button — no click action possible
      expect(screen.queryByRole('button')).toBeNull();
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    });
  });

  describe('className prop', () => {
    it('applies additional className when path is present', () => {
      render(<PathBadge path="/tmp/test" className="extra-class" />);
      const button = screen.getByRole('button');
      expect(button.className).toContain('extra-class');
    });

    it('applies additional className when path is null (fallback)', () => {
      render(<PathBadge path={null} className="extra-class" />);
      const span = screen.getByText('-');
      expect(span.className).toContain('extra-class');
    });
  });
});
