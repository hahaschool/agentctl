import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('lucide-react', () => ({
  RefreshCw: (props: Record<string, unknown>) => <svg data-testid="refresh-icon" {...props} />,
}));

import { RefreshButton } from './RefreshButton';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RefreshButton', () => {
  describe('click handler', () => {
    it('calls onClick when clicked', () => {
      const handler = vi.fn();
      render(<RefreshButton onClick={handler} />);
      fireEvent.click(screen.getByTestId('refresh-button'));
      expect(handler).toHaveBeenCalledOnce();
    });

    it('does not fire onClick when disabled (isFetching)', () => {
      const handler = vi.fn();
      render(<RefreshButton onClick={handler} isFetching />);
      fireEvent.click(screen.getByTestId('refresh-button'));
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('label rendering', () => {
    it('renders default "Refresh" label when no label prop', () => {
      render(<RefreshButton onClick={vi.fn()} />);
      expect(screen.getByText('Refresh')).toBeDefined();
    });

    it('renders custom label', () => {
      render(<RefreshButton onClick={vi.fn()} label="Reload" />);
      expect(screen.getByText('Reload')).toBeDefined();
      expect(screen.queryByText('Refresh')).toBeNull();
    });

    it('uses label for aria-label attribute', () => {
      render(<RefreshButton onClick={vi.fn()} label="Sync now" />);
      const btn = screen.getByTestId('refresh-button');
      expect(btn.getAttribute('aria-label')).toBe('Sync now');
    });

    it('falls back to "Refresh" for aria-label when label is empty string', () => {
      render(<RefreshButton onClick={vi.fn()} label="" />);
      const btn = screen.getByTestId('refresh-button');
      expect(btn.getAttribute('aria-label')).toBe('Refresh');
    });
  });

  describe('loading / spinning state', () => {
    it('applies animate-spin class to icon when isFetching is true', () => {
      render(<RefreshButton onClick={vi.fn()} isFetching />);
      const icon = screen.getByTestId('refresh-icon');
      expect(icon.className).toContain('animate-spin');
    });

    it('does not apply animate-spin class when isFetching is false', () => {
      render(<RefreshButton onClick={vi.fn()} isFetching={false} />);
      const icon = screen.getByTestId('refresh-icon');
      expect(icon.className).not.toContain('animate-spin');
    });

    it('applies opacity-70 class to button when fetching', () => {
      render(<RefreshButton onClick={vi.fn()} isFetching />);
      const btn = screen.getByTestId('refresh-button');
      expect(btn.className).toContain('opacity-70');
    });

    it('does not apply opacity-70 when not fetching', () => {
      render(<RefreshButton onClick={vi.fn()} />);
      const btn = screen.getByTestId('refresh-button');
      expect(btn.className).not.toContain('opacity-70');
    });
  });

  describe('disabled state', () => {
    it('is disabled when isFetching is true', () => {
      render(<RefreshButton onClick={vi.fn()} isFetching />);
      const btn = screen.getByTestId('refresh-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it('is enabled when isFetching is false', () => {
      render(<RefreshButton onClick={vi.fn()} isFetching={false} />);
      const btn = screen.getByTestId('refresh-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    it('is enabled when isFetching is undefined', () => {
      render(<RefreshButton onClick={vi.fn()} />);
      const btn = screen.getByTestId('refresh-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
  });

  describe('className prop', () => {
    it('applies additional className to button', () => {
      render(<RefreshButton onClick={vi.fn()} className="my-custom-class" />);
      const btn = screen.getByTestId('refresh-button');
      expect(btn.className).toContain('my-custom-class');
    });
  });

  describe('button type', () => {
    it('renders a button with type="button"', () => {
      render(<RefreshButton onClick={vi.fn()} />);
      const btn = screen.getByTestId('refresh-button') as HTMLButtonElement;
      expect(btn.type).toBe('button');
    });
  });
});
