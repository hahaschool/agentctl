import { act, fireEvent, render, screen } from '@testing-library/react';
import { ConfirmButton } from './ConfirmButton';
import { CopyableText } from './CopyableText';
import { EmptyState } from './EmptyState';
import { StatusBadge } from './StatusBadge';

// ---------------------------------------------------------------------------
// Mock sonner (used by useToast inside CopyableText)
// ---------------------------------------------------------------------------
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
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
// StatusBadge
// ===========================================================================

describe('StatusBadge', () => {
  it('renders the status text', () => {
    render(<StatusBadge status="running" />);
    expect(screen.getByText('running')).toBeDefined();
  });

  it('applies green CSS classes for "running" status', () => {
    const { container } = render(<StatusBadge status="running" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-green-500');
    expect(badge.className).toContain('bg-green-500/10');
  });

  it('applies green CSS classes for "online" status', () => {
    const { container } = render(<StatusBadge status="online" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-green-500');
  });

  it('applies green CSS classes for "active" status', () => {
    const { container } = render(<StatusBadge status="active" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-green-500');
  });

  it('applies green CSS classes for "ok" status', () => {
    const { container } = render(<StatusBadge status="ok" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-green-500');
  });

  it('applies blue CSS classes for "registered" status', () => {
    const { container } = render(<StatusBadge status="registered" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-blue-500');
    expect(badge.className).toContain('bg-blue-500/10');
  });

  it('applies yellow CSS classes for "starting" status', () => {
    const { container } = render(<StatusBadge status="starting" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-yellow-500');
    expect(badge.className).toContain('bg-yellow-500/10');
  });

  it('applies yellow CSS classes for "stopping" status', () => {
    const { container } = render(<StatusBadge status="stopping" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-yellow-500');
  });

  it('applies yellow CSS classes for "degraded" status', () => {
    const { container } = render(<StatusBadge status="degraded" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-yellow-500');
  });

  it('applies orange CSS classes for "paused" status', () => {
    const { container } = render(<StatusBadge status="paused" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-orange-500');
    expect(badge.className).toContain('bg-orange-500/10');
  });

  it('applies muted CSS classes for "offline" status', () => {
    const { container } = render(<StatusBadge status="offline" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('bg-muted');
    expect(badge.className).toContain('text-muted-foreground');
  });

  it('applies muted CSS classes for "stopped" status', () => {
    const { container } = render(<StatusBadge status="stopped" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-muted-foreground');
  });

  it('applies muted CSS classes for "idle" status', () => {
    const { container } = render(<StatusBadge status="idle" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-muted-foreground');
  });

  it('applies muted CSS classes for "ended" status', () => {
    const { container } = render(<StatusBadge status="ended" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-muted-foreground');
  });

  it('applies red CSS classes for "error" status', () => {
    const { container } = render(<StatusBadge status="error" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-red-500');
    expect(badge.className).toContain('bg-red-500/10');
  });

  it('applies red CSS classes for "timeout" status', () => {
    const { container } = render(<StatusBadge status="timeout" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-red-500');
  });

  it('applies animate-pulse to the dot for pulse statuses (running)', () => {
    const { container } = render(<StatusBadge status="running" />);
    const dot = container.querySelector('span > span') as HTMLElement;
    expect(dot.className).toContain('animate-pulse');
  });

  it('applies animate-pulse to the dot for "online"', () => {
    const { container } = render(<StatusBadge status="online" />);
    const dot = container.querySelector('span > span') as HTMLElement;
    expect(dot.className).toContain('animate-pulse');
  });

  it('applies animate-pulse to the dot for "active"', () => {
    const { container } = render(<StatusBadge status="active" />);
    const dot = container.querySelector('span > span') as HTMLElement;
    expect(dot.className).toContain('animate-pulse');
  });

  it('applies animate-pulse to the dot for "starting"', () => {
    const { container } = render(<StatusBadge status="starting" />);
    const dot = container.querySelector('span > span') as HTMLElement;
    expect(dot.className).toContain('animate-pulse');
  });

  it('does NOT apply animate-pulse for non-pulse statuses ("stopped")', () => {
    const { container } = render(<StatusBadge status="stopped" />);
    const dot = container.querySelector('span > span') as HTMLElement;
    expect(dot.className).not.toContain('animate-pulse');
  });

  it('does NOT apply animate-pulse for "error" status', () => {
    const { container } = render(<StatusBadge status="error" />);
    const dot = container.querySelector('span > span') as HTMLElement;
    expect(dot.className).not.toContain('animate-pulse');
  });

  it('falls back to muted classes for unknown status', () => {
    const { container } = render(<StatusBadge status="unknown-xyz" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('bg-muted');
  });
});

// ===========================================================================
// CopyableText
// ===========================================================================

describe('CopyableText', () => {
  it('renders a button element', () => {
    render(<CopyableText value="hello-world" />);
    expect(screen.getByRole('button')).toBeDefined();
  });

  it('shows the full value when shorter than maxDisplay', () => {
    render(<CopyableText value="abc" maxDisplay={8} />);
    expect(screen.getByText('abc')).toBeDefined();
  });

  it('shows truncated value (first maxDisplay chars) when value is longer', () => {
    render(<CopyableText value="1234567890" maxDisplay={6} />);
    expect(screen.getByText('123456')).toBeDefined();
  });

  it('shows full value at exactly maxDisplay length', () => {
    render(<CopyableText value="12345678" maxDisplay={8} />);
    expect(screen.getByText('12345678')).toBeDefined();
  });

  it('uses label prop as display text when provided, ignoring truncation', () => {
    render(<CopyableText value="some-very-long-value" maxDisplay={4} label="Custom Label" />);
    expect(screen.getByText('Custom Label')).toBeDefined();
  });

  it('sets title to "Click to copy: <value>" before click', () => {
    render(<CopyableText value="secret-key" />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('title')).toBe('Click to copy: secret-key');
  });

  it('calls navigator.clipboard.writeText with the full value on click', async () => {
    render(<CopyableText value="my-api-key-123" maxDisplay={4} />);
    const btn = screen.getByRole('button');

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('my-api-key-123');
  });

  it('shows "Copied!" text after a successful click', async () => {
    render(<CopyableText value="test-value" />);
    const btn = screen.getByRole('button');

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(screen.getByText('Copied!')).toBeDefined();
  });

  it('updates title to "Copied!" after a successful click', async () => {
    render(<CopyableText value="test-value" />);
    const btn = screen.getByRole('button');

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(btn.getAttribute('title')).toBe('Copied!');
  });

  it('reverts back to original display text after 1500ms', async () => {
    vi.useFakeTimers();
    render(<CopyableText value="test-value" />);
    const btn = screen.getByRole('button');

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(screen.getByText('Copied!')).toBeDefined();

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.getByText('test-val')).toBeDefined();
  });

  it('applies custom className to the button', () => {
    render(<CopyableText value="val" className="custom-class" />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('custom-class');
  });
});

// ===========================================================================
// ConfirmButton
// ===========================================================================

describe('ConfirmButton', () => {
  it('renders with the initial label', () => {
    render(<ConfirmButton label="Delete" onConfirm={() => {}} />);
    expect(screen.getByText('Delete')).toBeDefined();
  });

  it('changes label to confirmLabel on first click', () => {
    render(<ConfirmButton label="Delete" confirmLabel="Are you sure?" onConfirm={() => {}} />);
    const btn = screen.getByRole('button');

    fireEvent.click(btn);

    expect(screen.getByText('Are you sure?')).toBeDefined();
  });

  it('uses default confirmLabel "Confirm?" when not provided', () => {
    render(<ConfirmButton label="Delete" onConfirm={() => {}} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Confirm?')).toBeDefined();
  });

  it('does NOT call onConfirm on first click', () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Delete" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('calls onConfirm on second click (confirmation)', () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Delete" onConfirm={onConfirm} />);
    const btn = screen.getByRole('button');

    fireEvent.click(btn); // first click → confirming state
    fireEvent.click(btn); // second click → confirm

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('reverts label back to original after second click', () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Delete" onConfirm={onConfirm} />);
    const btn = screen.getByRole('button');

    fireEvent.click(btn);
    fireEvent.click(btn);

    expect(screen.getByText('Delete')).toBeDefined();
  });

  it('auto-reverts to original label after timeout', async () => {
    vi.useFakeTimers();
    render(<ConfirmButton label="Delete" onConfirm={() => {}} timeout={3000} />);
    const btn = screen.getByRole('button');

    fireEvent.click(btn);
    expect(screen.getByText('Confirm?')).toBeDefined();

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByText('Delete')).toBeDefined();
  });

  it('does NOT call onConfirm if timeout revert happens first', async () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Delete" onConfirm={onConfirm} timeout={3000} />);
    const btn = screen.getByRole('button');

    fireEvent.click(btn); // enter confirming state

    await act(async () => {
      vi.advanceTimersByTime(3000); // auto-revert
    });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('Delete')).toBeDefined();
  });

  it('is disabled when disabled prop is true', () => {
    render(<ConfirmButton label="Delete" onConfirm={() => {}} disabled />);
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('does not call onConfirm or change state when disabled', () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Delete" onConfirm={onConfirm} disabled />);
    const btn = screen.getByRole('button');

    fireEvent.click(btn);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('Delete')).toBeDefined();
  });

  it('applies className in default state', () => {
    render(
      <ConfirmButton
        label="Delete"
        onConfirm={() => {}}
        className="btn-default"
        confirmClassName="btn-confirm"
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('btn-default');
  });

  it('applies confirmClassName in confirming state', () => {
    render(
      <ConfirmButton
        label="Delete"
        onConfirm={() => {}}
        className="btn-default"
        confirmClassName="btn-confirm"
      />,
    );
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    expect(btn.className).toContain('btn-confirm');
  });

  it('applies cursor-not-allowed class when disabled', () => {
    render(<ConfirmButton label="Delete" onConfirm={() => {}} disabled />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('cursor-not-allowed');
  });

  it('uses custom timeout when provided', async () => {
    vi.useFakeTimers();
    render(<ConfirmButton label="Remove" onConfirm={() => {}} timeout={1000} />);
    const btn = screen.getByRole('button');

    fireEvent.click(btn);
    expect(screen.getByText('Confirm?')).toBeDefined();

    await act(async () => {
      vi.advanceTimersByTime(999);
    });
    // should still be in confirming state
    expect(screen.getByText('Confirm?')).toBeDefined();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    // now should revert
    expect(screen.getByText('Remove')).toBeDefined();
  });
});

// ===========================================================================
// EmptyState
// ===========================================================================

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="No items found" />);
    expect(screen.getByText('No items found')).toBeDefined();
  });

  it('renders the icon when provided', () => {
    render(<EmptyState title="Empty" icon="🗂️" />);
    expect(screen.getByText('🗂️')).toBeDefined();
  });

  it('does NOT render icon element when icon is not provided', () => {
    const { container } = render(<EmptyState title="Empty" />);
    // The icon wrapper div should not be present
    const divs = container.querySelectorAll('div');
    const textContents = Array.from(divs).map((d) => d.textContent);
    // None of the divs should contain an icon
    expect(textContents.some((t) => t?.includes('🗂️'))).toBe(false);
  });

  it('renders the description when provided', () => {
    render(<EmptyState title="Empty" description="Create one to get started." />);
    expect(screen.getByText('Create one to get started.')).toBeDefined();
  });

  it('does NOT render description element when description is not provided', () => {
    render(<EmptyState title="Empty" />);
    expect(screen.queryByText('Create one to get started.')).toBeNull();
  });

  it('renders the action node when provided', () => {
    render(<EmptyState title="Empty" action={<button type="button">Create New</button>} />);
    expect(screen.getByRole('button', { name: 'Create New' })).toBeDefined();
  });

  it('does NOT render action wrapper when action is not provided', () => {
    const { container } = render(<EmptyState title="No data" />);
    // The container should only have title text, no extra children with mt-3
    const actionDiv = Array.from(container.querySelectorAll('div')).find((d) =>
      d.className.includes('mt-3'),
    );
    expect(actionDiv).toBeUndefined();
  });

  it('renders all props together correctly', () => {
    render(
      <EmptyState
        icon="📋"
        title="No sessions"
        description="Start a new session to begin."
        action={<button type="button">New Session</button>}
      />,
    );
    expect(screen.getByText('📋')).toBeDefined();
    expect(screen.getByText('No sessions')).toBeDefined();
    expect(screen.getByText('Start a new session to begin.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'New Session' })).toBeDefined();
  });

  it('renders with only required title prop', () => {
    const { container } = render(<EmptyState title="Minimal" />);
    expect(container.textContent).toContain('Minimal');
  });
});
