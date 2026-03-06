import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before component imports
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock('./Toast', () => ({
  useToast: () => ({
    toast: (type: string, msg: string) => mockToast[type as 'success' | 'error' | 'info']?.(msg),
    success: mockToast.success,
    error: mockToast.error,
    info: mockToast.info,
  }),
  ToastContainer: () => null,
}));

import { DetailRow } from './DetailRow';

afterEach(() => {
  vi.restoreAllMocks();
  mockToast.success.mockClear();
  mockToast.error.mockClear();
  mockToast.info.mockClear();
});

// Set up clipboard mock
beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
    writable: true,
  });
});

describe('DetailRow', () => {
  describe('basic rendering', () => {
    it('renders label and value', () => {
      render(<DetailRow label="Machine ID" value="m-abc-123" />);
      expect(screen.getByText('Machine ID')).toBeDefined();
      expect(screen.getByText('m-abc-123')).toBeDefined();
    });

    it('renders dash value when value is "-"', () => {
      render(<DetailRow label="Status" value="-" />);
      expect(screen.getByText('Status')).toBeDefined();
      expect(screen.getByText('-')).toBeDefined();
    });
  });

  describe('mono prop', () => {
    it('applies mono font class when mono=true', () => {
      const { container } = render(<DetailRow label="ID" value="abc-123" mono />);
      const valueDiv = container.querySelector('.font-mono');
      expect(valueDiv).not.toBeNull();
    });

    it('does not apply mono font class when mono is not set', () => {
      const { container } = render(<DetailRow label="Name" value="My Agent" />);
      const valueDiv = container.querySelector('.font-mono');
      expect(valueDiv).toBeNull();
    });

    it('does not apply mono font class when mono=false', () => {
      const { container } = render(<DetailRow label="Name" value="My Agent" mono={false} />);
      const valueDiv = container.querySelector('.font-mono');
      expect(valueDiv).toBeNull();
    });
  });

  describe('copy button visibility', () => {
    it('shows copy button when mono=true and value is not dash', () => {
      render(<DetailRow label="ID" value="abc-123" mono />);
      expect(screen.getByRole('button', { name: /copy/i })).toBeDefined();
    });

    it('does NOT show copy button when mono=false', () => {
      render(<DetailRow label="Name" value="My Agent" />);
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('does NOT show copy button when value is "-"', () => {
      render(<DetailRow label="ID" value="-" mono />);
      expect(screen.queryByRole('button')).toBeNull();
    });
  });

  describe('clipboard copy', () => {
    it('copy button writes value to clipboard', async () => {
      render(<DetailRow label="ID" value="sess-xyz-789" mono />);
      const button = screen.getByRole('button');
      fireEvent.click(button);

      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('sess-xyz-789');
      });
    });

    it('shows "Copied" feedback after clicking copy', async () => {
      vi.useFakeTimers();
      render(<DetailRow label="ID" value="sess-xyz-789" mono />);
      const button = screen.getByRole('button');

      expect(button.textContent).toBe('Copy');

      fireEvent.click(button);

      await act(async () => {
        await Promise.resolve(); // flush microtask (.then)
      });

      expect(button.textContent).toBe('Copied');

      vi.useRealTimers();
    });

    it('resets "Copied" text after timeout', async () => {
      vi.useFakeTimers();
      render(<DetailRow label="ID" value="sess-xyz-789" mono />);
      const button = screen.getByRole('button');

      fireEvent.click(button);

      await act(async () => {
        await Promise.resolve();
      });
      expect(button.textContent).toBe('Copied');

      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(button.textContent).toBe('Copy');

      vi.useRealTimers();
    });

    it('updates button title to "Copied!" after successful copy', async () => {
      vi.useFakeTimers();
      render(<DetailRow label="ID" value="abc" mono />);
      const button = screen.getByRole('button');

      expect(button.getAttribute('title')).toBe('Copy to clipboard');

      fireEvent.click(button);

      await act(async () => {
        await Promise.resolve();
      });

      expect(button.getAttribute('title')).toBe('Copied!');

      vi.useRealTimers();
    });

    it('shows error toast when clipboard write fails', async () => {
      (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('denied'),
      );
      render(<DetailRow label="ID" value="abc-123" mono />);
      const button = screen.getByRole('button');
      fireEvent.click(button);

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('Failed to copy');
      });
    });

    it('does not write to clipboard when value is "-" even if mono=true', () => {
      // Button won't render, but verify no clipboard call even if handleCopy were invoked
      render(<DetailRow label="ID" value="-" mono />);
      expect(screen.queryByRole('button')).toBeNull();
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    });
  });

  describe('multiple rows', () => {
    it('multiple rows render independently', () => {
      render(
        <div>
          <DetailRow label="Agent ID" value="agent-001" mono />
          <DetailRow label="Machine" value="mac-mini" />
          <DetailRow label="Session" value="sess-abc" mono />
        </div>,
      );

      expect(screen.getByText('Agent ID')).toBeDefined();
      expect(screen.getByText('agent-001')).toBeDefined();
      expect(screen.getByText('Machine')).toBeDefined();
      expect(screen.getByText('mac-mini')).toBeDefined();
      expect(screen.getByText('Session')).toBeDefined();
      expect(screen.getByText('sess-abc')).toBeDefined();

      // Only mono rows get copy buttons (agent-001, sess-abc)
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBe(2);
    });
  });

  describe('copy button styling', () => {
    it('copy button has opacity-0 class before copy (hidden until hover)', () => {
      render(<DetailRow label="ID" value="abc" mono />);
      const button = screen.getByRole('button');
      expect(button.className).toContain('opacity-0');
    });

    it('copy button shows green styling after successful copy', async () => {
      vi.useFakeTimers();
      render(<DetailRow label="ID" value="abc" mono />);
      const button = screen.getByRole('button');

      fireEvent.click(button);

      await act(async () => {
        await Promise.resolve();
      });

      expect(button.className).toContain('text-green-500');
      expect(button.className).toContain('opacity-100');

      vi.useRealTimers();
    });
  });
});
