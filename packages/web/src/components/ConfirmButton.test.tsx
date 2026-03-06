import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { ConfirmButton } from './ConfirmButton';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ConfirmButton', () => {
  describe('initial state', () => {
    it('renders with the provided label', () => {
      render(<ConfirmButton label="Delete" onConfirm={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Delete' })).toBeDefined();
    });

    it('does not show confirm text initially', () => {
      render(<ConfirmButton label="Delete" confirmLabel="Really delete?" onConfirm={vi.fn()} />);
      expect(screen.queryByText(/Really delete/)).toBeNull();
    });
  });

  describe('two-click confirmation pattern', () => {
    it('shows confirm text after first click', () => {
      vi.useFakeTimers();
      render(<ConfirmButton label="Delete" confirmLabel="Really delete?" onConfirm={vi.fn()} />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByText(/Really delete\?/)).toBeDefined();
    });

    it('does not call onConfirm on first click', () => {
      vi.useFakeTimers();
      const onConfirm = vi.fn();
      render(<ConfirmButton label="Delete" onConfirm={onConfirm} />);
      fireEvent.click(screen.getByRole('button'));
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('calls onConfirm on second click', () => {
      vi.useFakeTimers();
      const onConfirm = vi.fn();
      render(<ConfirmButton label="Delete" onConfirm={onConfirm} />);
      const btn = screen.getByRole('button');
      fireEvent.click(btn);
      fireEvent.click(btn);
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('reverts to original label after confirm executes', () => {
      vi.useFakeTimers();
      const onConfirm = vi.fn();
      render(<ConfirmButton label="Delete" onConfirm={onConfirm} />);
      const btn = screen.getByRole('button');
      fireEvent.click(btn); // enter confirming
      fireEvent.click(btn); // confirm
      expect(screen.getByText('Delete')).toBeDefined();
    });

    it('uses default confirmLabel "Confirm?" when none provided', () => {
      vi.useFakeTimers();
      render(<ConfirmButton label="Remove" onConfirm={vi.fn()} />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByText(/Confirm\?/)).toBeDefined();
    });
  });

  describe('auto-revert timeout', () => {
    it('reverts to original label after timeout expires', () => {
      vi.useFakeTimers();
      render(
        <ConfirmButton label="Delete" confirmLabel="Sure?" onConfirm={vi.fn()} timeout={2000} />,
      );
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByText(/Sure\?/)).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.getByText('Delete')).toBeDefined();
    });

    it('does not revert before timeout expires', () => {
      vi.useFakeTimers();
      render(
        <ConfirmButton label="Delete" confirmLabel="Sure?" onConfirm={vi.fn()} timeout={3000} />,
      );
      fireEvent.click(screen.getByRole('button'));
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(screen.getByText(/Sure\?/)).toBeDefined();
    });

    it('displays countdown seconds while in confirm state', () => {
      vi.useFakeTimers();
      render(<ConfirmButton label="Delete" onConfirm={vi.fn()} timeout={3000} />);
      fireEvent.click(screen.getByRole('button'));
      // Should show 3s initially (ceil of 3000/1000)
      expect(screen.getByText('(3s)')).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByText('(2s)')).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByText('(1s)')).toBeDefined();
    });

    it('uses default 3000ms timeout', () => {
      vi.useFakeTimers();
      render(<ConfirmButton label="Delete" confirmLabel="Sure?" onConfirm={vi.fn()} />);
      fireEvent.click(screen.getByRole('button'));

      // Not yet reverted at 2.9s
      act(() => {
        vi.advanceTimersByTime(2900);
      });
      expect(screen.getByText(/Sure\?/)).toBeDefined();

      // Reverted at 3s
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.getByText('Delete')).toBeDefined();
    });
  });

  describe('disabled state', () => {
    it('renders as disabled when disabled=true', () => {
      render(<ConfirmButton label="Delete" onConfirm={vi.fn()} disabled />);
      expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
    });

    it('does not enter confirming state when disabled', () => {
      vi.useFakeTimers();
      render(<ConfirmButton label="Delete" confirmLabel="Sure?" onConfirm={vi.fn()} disabled />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.queryByText(/Sure\?/)).toBeNull();
      expect(screen.getByText('Delete')).toBeDefined();
    });

    it('does not call onConfirm when disabled', () => {
      vi.useFakeTimers();
      const onConfirm = vi.fn();
      render(<ConfirmButton label="Delete" onConfirm={onConfirm} disabled />);
      fireEvent.click(screen.getByRole('button'));
      fireEvent.click(screen.getByRole('button'));
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe('className props', () => {
    it('applies className in default state', () => {
      render(<ConfirmButton label="Delete" onConfirm={vi.fn()} className="btn-danger" />);
      expect(screen.getByRole('button').className).toContain('btn-danger');
    });

    it('applies confirmClassName in confirming state', () => {
      vi.useFakeTimers();
      render(
        <ConfirmButton
          label="Delete"
          onConfirm={vi.fn()}
          className="btn-danger"
          confirmClassName="btn-warning"
        />,
      );
      fireEvent.click(screen.getByRole('button'));
      const btn = screen.getByRole('button');
      expect(btn.className).toContain('btn-warning');
      expect(btn.className).not.toContain('btn-danger');
    });
  });

  describe('accessibility', () => {
    it('has aria-live="polite" for state change announcements', () => {
      render(<ConfirmButton label="Delete" onConfirm={vi.fn()} />);
      expect(screen.getByRole('button').getAttribute('aria-live')).toBe('polite');
    });
  });
});
