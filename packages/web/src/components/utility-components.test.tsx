import { act, render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock Toast module (used by useToast)
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
// Mock @/lib/utils
// ---------------------------------------------------------------------------
vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// ---------------------------------------------------------------------------
// Mock @/components/ui/tooltip (used by SimpleTooltip inside StatCard)
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

import { ConnectionBanner } from './ConnectionBanner';
import { StatCard } from './StatCard';

// ===========================================================================
// StatCard (not covered in any existing test file)
// ===========================================================================

describe('StatCard', () => {
  it('renders the label text', () => {
    render(<StatCard label="Total Sessions" value="42" />);
    expect(screen.getByText('Total Sessions')).toBeDefined();
  });

  it('renders the value text', () => {
    render(<StatCard label="Active Agents" value="7" />);
    expect(screen.getByText('7')).toBeDefined();
  });

  it('sets data-testid based on label', () => {
    render(<StatCard label="Total Cost" value="$1.23" />);
    const card = screen.getByTestId('stat-card-Total Cost');
    expect(card).toBeDefined();
  });

  it('sets data-testid on value element based on label', () => {
    render(<StatCard label="Errors" value="0" />);
    const valueEl = screen.getByTestId('stat-value-Errors');
    expect(valueEl.textContent).toBe('0');
  });

  it('does not render sublabel when not provided', () => {
    const { container } = render(<StatCard label="Agents" value="5" />);
    expect(container.querySelector('[data-testid="stat-sublabel-Agents"]')).toBeNull();
  });

  it('renders sublabel when provided', () => {
    render(<StatCard label="Sessions" value="100" sublabel="+12 today" />);
    const sublabel = screen.getByTestId('stat-sublabel-Sessions');
    expect(sublabel.textContent).toBe('+12 today');
  });

  it('applies green accent border class when accent is green', () => {
    render(<StatCard label="Uptime" value="99.9%" accent="green" />);
    const card = screen.getByTestId('stat-card-Uptime');
    expect(card.className).toContain('border-l-green-500/60');
    expect(card.className).toContain('border-l-[3px]');
  });

  it('applies yellow accent border class when accent is yellow', () => {
    render(<StatCard label="Warnings" value="3" accent="yellow" />);
    const card = screen.getByTestId('stat-card-Warnings');
    expect(card.className).toContain('border-l-yellow-500/60');
  });

  it('applies red accent border class when accent is red', () => {
    render(<StatCard label="Errors" value="1" accent="red" />);
    const card = screen.getByTestId('stat-card-Errors');
    expect(card.className).toContain('border-l-red-500/60');
  });

  it('applies blue accent border class when accent is blue', () => {
    render(<StatCard label="Queued" value="8" accent="blue" />);
    const card = screen.getByTestId('stat-card-Queued');
    expect(card.className).toContain('border-l-blue-500/60');
  });

  it('applies purple accent border class when accent is purple', () => {
    render(<StatCard label="Models" value="4" accent="purple" />);
    const card = screen.getByTestId('stat-card-Models');
    expect(card.className).toContain('border-l-purple-500/60');
  });

  it('does not apply accent border classes when accent is not provided', () => {
    render(<StatCard label="Plain" value="0" />);
    const card = screen.getByTestId('stat-card-Plain');
    expect(card.className).not.toContain('border-l-[3px]');
    expect(card.className).not.toContain('border-l-green');
    expect(card.className).not.toContain('border-l-red');
  });

  it('renders tooltip info icon when tooltip prop is provided', () => {
    const { container } = render(
      <StatCard label="Cost" value="$5.00" tooltip="Total API cost this month" />,
    );
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('does not render info icon when tooltip is not provided', () => {
    const { container } = render(<StatCard label="Cost" value="$5.00" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeNull();
  });

  it('renders the label inside tooltip span when tooltip is provided', () => {
    render(<StatCard label="Revenue" value="$99" tooltip="Monthly revenue" />);
    expect(screen.getByText('Revenue')).toBeDefined();
  });

  it('applies bg-card class to the card container', () => {
    render(<StatCard label="Test" value="1" />);
    const card = screen.getByTestId('stat-card-Test');
    expect(card.className).toContain('bg-card');
  });

  it('applies text-2xl and font-semibold to the value', () => {
    render(<StatCard label="Big" value="999" />);
    const valueEl = screen.getByTestId('stat-value-Big');
    expect(valueEl.className).toContain('text-2xl');
    expect(valueEl.className).toContain('font-semibold');
  });
});

// ===========================================================================
// ConnectionBanner — elapsed timer and Retry now button (not covered elsewhere)
// ===========================================================================

describe('ConnectionBanner — elapsed timer', () => {
  it('displays elapsed time in seconds after disconnection', async () => {
    vi.useFakeTimers();

    render(<ConnectionBanner status="disconnected" />);

    // Initial render: 0s
    expect(screen.getByText(/0s ago/)).toBeDefined();

    // Advance 5 seconds
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByText(/5s ago/)).toBeDefined();
  });

  it('displays elapsed time in minutes after 60+ seconds', async () => {
    vi.useFakeTimers();

    render(<ConnectionBanner status="disconnected" />);

    await act(async () => {
      vi.advanceTimersByTime(90_000);
    });

    expect(screen.getByText(/1m ago/)).toBeDefined();
  });

  it('renders "Retry now" button when disconnected', () => {
    render(<ConnectionBanner status="disconnected" />);
    expect(screen.getByText('Retry now')).toBeDefined();
  });

  it('resets elapsed to 0 when reconnected then disconnected again', async () => {
    vi.useFakeTimers();

    const { rerender } = render(<ConnectionBanner status="disconnected" />);

    // Advance some time
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText(/10s ago/)).toBeDefined();

    // Reconnect
    rerender(<ConnectionBanner status="connected" />);

    // Disconnect again
    rerender(<ConnectionBanner status="disconnected" />);

    // Elapsed should reset to 0
    expect(screen.getByText(/0s ago/)).toBeDefined();
  });
});
