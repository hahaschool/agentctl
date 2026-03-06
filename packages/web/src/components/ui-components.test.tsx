import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AlertCircle } from 'lucide-react';

import { CopyableText } from './CopyableText';
import { EmptyState } from './EmptyState';

// ---------------------------------------------------------------------------
// Mock Toast module (used by useToast inside CopyableText)
// ---------------------------------------------------------------------------
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock('@/components/Toast', () => ({
  toast: mockToast,
  useToast: () => ({
    toast: (type: string, msg: string) => mockToast[type as 'success' | 'error' | 'info']?.(msg),
    success: mockToast.success,
    error: mockToast.error,
    info: mockToast.info,
  }),
  ToastContainer: () => null,
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
// CopyableText — supplementary tests (icon rendering & error handling)
// ===========================================================================

describe('CopyableText', () => {
  it('renders a Copy SVG icon before clicking', () => {
    const { container } = render(<CopyableText value="test-value" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeDefined();
    expect(svg).not.toBeNull();
  });

  it('renders a Check SVG icon after clicking (copied state)', async () => {
    const { container } = render(<CopyableText value="test-value" />);
    const btn = screen.getByRole('button');

    await act(async () => {
      fireEvent.click(btn);
    });

    // After click, the SVG should change from Copy to Check
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    // The button text should be "Copied!" confirming the icon switched
    expect(screen.getByText('Copied!')).toBeDefined();
  });

  it('calls toast.error when clipboard write fails', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('Clipboard denied'));

    render(<CopyableText value="secret" />);
    const btn = screen.getByRole('button');

    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Failed to copy');
    });
  });

  it('does not show "Copied!" when clipboard write fails', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('Denied'));

    render(<CopyableText value="test" />);
    const btn = screen.getByRole('button');

    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => {
      expect(screen.queryByText('Copied!')).toBeNull();
    });
  });

  it('renders truncated text using default maxDisplay of 8', () => {
    render(<CopyableText value="abcdefghijklmnop" />);
    expect(screen.getByText('abcdefgh')).toBeDefined();
  });

  it('stops event propagation on click', async () => {
    const parentClick = vi.fn();
    render(
      // biome-ignore lint/a11y/useKeyWithClickEvents: test-only wrapper
      // biome-ignore lint/a11y/noStaticElementInteractions: test-only wrapper
      <div onClick={parentClick}>
        <CopyableText value="val" />
      </div>,
    );
    const btn = screen.getByRole('button');

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(parentClick).not.toHaveBeenCalled();
  });

  it('handles empty string value gracefully', () => {
    render(<CopyableText value="" />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('title')).toBe('Click to copy: ');
  });
});

// ===========================================================================
// EmptyState — supplementary tests (component icon & variant spacing)
// ===========================================================================

describe('EmptyState', () => {
  it('renders a component icon as an SVG (Lucide icon)', () => {
    const { container } = render(<EmptyState title="No data" icon={AlertCircle} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('wraps a component icon in a rounded-full container', () => {
    const { container } = render(<EmptyState title="No data" icon={AlertCircle} />);
    const iconWrapper = container.querySelector('.rounded-full');
    expect(iconWrapper).not.toBeNull();
  });

  it('does not render a rounded-full wrapper for string icons', () => {
    const { container } = render(<EmptyState title="No data" icon="📋" />);
    const iconWrapper = container.querySelector('.rounded-full');
    expect(iconWrapper).toBeNull();
  });

  it('uses larger icon container (w-16 h-16) in default variant with component icon', () => {
    const { container } = render(<EmptyState title="No data" icon={AlertCircle} />);
    const iconWrapper = container.querySelector('.rounded-full');
    expect(iconWrapper?.className).toContain('w-16');
    expect(iconWrapper?.className).toContain('h-16');
  });

  it('uses smaller icon container (w-10 h-10) in compact variant with component icon', () => {
    const { container } = render(
      <EmptyState title="No data" icon={AlertCircle} variant="compact" />,
    );
    const iconWrapper = container.querySelector('.rounded-full');
    expect(iconWrapper?.className).toContain('w-10');
    expect(iconWrapper?.className).toContain('h-10');
  });

  it('applies larger padding (py-16) in default variant', () => {
    const { container } = render(<EmptyState title="Empty" />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain('py-16');
  });

  it('applies smaller padding (py-6) in compact variant', () => {
    const { container } = render(<EmptyState title="Empty" variant="compact" />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain('py-6');
  });

  it('uses text-4xl for string icon in default variant', () => {
    const { container } = render(<EmptyState title="Empty" icon="📋" />);
    const iconDiv = container.querySelector('.text-4xl');
    expect(iconDiv).not.toBeNull();
    expect(iconDiv?.textContent).toBe('📋');
  });

  it('uses text-2xl for string icon in compact variant', () => {
    const { container } = render(<EmptyState title="Empty" icon="📋" variant="compact" />);
    const iconDiv = container.querySelector('.text-2xl');
    expect(iconDiv).not.toBeNull();
    expect(iconDiv?.textContent).toBe('📋');
  });

  it('uses text-[15px] for title in default variant', () => {
    const { container } = render(<EmptyState title="Default Title" />);
    const titleDiv = container.querySelector('.text-\\[15px\\]');
    expect(titleDiv).not.toBeNull();
    expect(titleDiv?.textContent).toBe('Default Title');
  });

  it('uses text-[13px] for title in compact variant', () => {
    const { container } = render(<EmptyState title="Compact Title" variant="compact" />);
    const titleDiv = container.querySelector('.text-\\[13px\\]');
    expect(titleDiv).not.toBeNull();
    expect(titleDiv?.textContent).toBe('Compact Title');
  });

  it('applies mt-4 to action wrapper in default variant', () => {
    const { container } = render(
      <EmptyState title="Empty" action={<button type="button">Act</button>} />,
    );
    const actionWrapper = Array.from(container.querySelectorAll('div')).find((d) =>
      d.className.includes('mt-4'),
    );
    expect(actionWrapper).toBeDefined();
  });

  it('applies mt-2 to action wrapper in compact variant', () => {
    const { container } = render(
      <EmptyState title="Empty" variant="compact" action={<button type="button">Act</button>} />,
    );
    const actionWrapper = Array.from(container.querySelectorAll('div')).find((d) =>
      d.className.includes('mt-2'),
    );
    expect(actionWrapper).toBeDefined();
  });

  it('uses text-[13px] for description in default variant', () => {
    const { container } = render(<EmptyState title="T" description="Some description" />);
    const descDiv = Array.from(container.querySelectorAll('div')).find(
      (d) => d.textContent === 'Some description',
    );
    expect(descDiv?.className).toContain('text-[13px]');
  });

  it('uses text-[11px] for description in compact variant', () => {
    const { container } = render(
      <EmptyState title="T" description="Some description" variant="compact" />,
    );
    const descDiv = Array.from(container.querySelectorAll('div')).find(
      (d) => d.textContent === 'Some description',
    );
    expect(descDiv?.className).toContain('text-[11px]');
  });
});
