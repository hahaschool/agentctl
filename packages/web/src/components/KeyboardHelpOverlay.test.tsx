import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/lib/keyboard-shortcuts', () => ({
  SHORTCUT_GROUPS: [
    {
      title: 'Global',
      shortcuts: [
        { keys: ['?'], desc: 'Show keyboard shortcuts' },
        { keys: ['\u2318K'], desc: 'Command palette' },
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

import { KeyboardHelpOverlay } from './KeyboardHelpOverlay';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KeyboardHelpOverlay', () => {
  describe('open/close state', () => {
    it('returns null when open is false', () => {
      const { container } = render(<KeyboardHelpOverlay open={false} onClose={vi.fn()} />);
      expect(container.innerHTML).toBe('');
    });

    it('renders the dialog when open is true', () => {
      render(<KeyboardHelpOverlay open={true} onClose={vi.fn()} />);
      expect(screen.getByRole('dialog', { hidden: true })).toBeDefined();
    });

    it('exposes the dialog to assistive tech when open', () => {
      render(<KeyboardHelpOverlay open={true} onClose={vi.fn()} />);
      expect(screen.getByRole('dialog')).toBeDefined();
    });

    it('shows the heading "Keyboard Shortcuts"', () => {
      render(<KeyboardHelpOverlay open={true} onClose={vi.fn()} />);
      expect(screen.getByText('Keyboard Shortcuts')).toBeDefined();
    });
  });

  describe('shortcut groups rendering', () => {
    it('renders all group titles', () => {
      render(<KeyboardHelpOverlay open={true} onClose={vi.fn()} />);
      expect(screen.getByText('Global')).toBeDefined();
      expect(screen.getByText('Sessions')).toBeDefined();
    });

    it('renders shortcut descriptions within groups', () => {
      render(<KeyboardHelpOverlay open={true} onClose={vi.fn()} />);
      expect(screen.getByText('Show keyboard shortcuts')).toBeDefined();
      expect(screen.getByText('Command palette')).toBeDefined();
      expect(screen.getByText('Close panels')).toBeDefined();
      expect(screen.getByText('Refresh')).toBeDefined();
      expect(screen.getByText('New session')).toBeDefined();
    });

    it('renders shortcut keys as <kbd> elements', () => {
      const { container } = render(<KeyboardHelpOverlay open={true} onClose={vi.fn()} />);
      const kbdElements = container.querySelectorAll('kbd');
      // 3 Global keys (?, CmdK, Esc) + 2 Sessions keys (r, n) + Esc button in header + ? and Esc in footer = 10 total
      // Just check that the shortcut keys are present
      const kbdTexts = Array.from(kbdElements).map((el) => el.textContent);
      expect(kbdTexts).toContain('?');
      expect(kbdTexts).toContain('\u2318K');
      expect(kbdTexts).toContain('r');
      expect(kbdTexts).toContain('n');
    });
  });

  describe('close behavior', () => {
    it('calls onClose when Escape key is pressed', () => {
      const onClose = vi.fn();
      render(<KeyboardHelpOverlay open={true} onClose={onClose} />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when ? key is pressed', () => {
      const onClose = vi.fn();
      render(<KeyboardHelpOverlay open={true} onClose={onClose} />);
      fireEvent.keyDown(document, { key: '?' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when backdrop is clicked', () => {
      const onClose = vi.fn();
      render(<KeyboardHelpOverlay open={true} onClose={onClose} />);
      const backdrop = screen.getByRole('button', { name: 'Close keyboard shortcuts overlay' });
      fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose when clicking inside the dialog panel', () => {
      const onClose = vi.fn();
      render(<KeyboardHelpOverlay open={true} onClose={onClose} />);
      fireEvent.click(screen.getByRole('dialog', { hidden: true }));
      expect(onClose).not.toHaveBeenCalled();
    });

    it('calls onClose when the Esc button in header is clicked', () => {
      const onClose = vi.fn();
      render(<KeyboardHelpOverlay open={true} onClose={onClose} />);
      fireEvent.click(screen.getByRole('button', { name: 'Close', hidden: true }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('keyboard listener lifecycle', () => {
    it('does not register keydown listener when closed', () => {
      const addSpy = vi.spyOn(document, 'addEventListener');
      render(<KeyboardHelpOverlay open={false} onClose={vi.fn()} />);
      const keydownCalls = addSpy.mock.calls.filter(([event]) => event === 'keydown');
      expect(keydownCalls).toHaveLength(0);
    });

    it('removes keydown listener on unmount', () => {
      const removeSpy = vi.spyOn(document, 'removeEventListener');
      const { unmount } = render(<KeyboardHelpOverlay open={true} onClose={vi.fn()} />);
      unmount();
      const keydownCalls = removeSpy.mock.calls.filter(([event]) => event === 'keydown');
      expect(keydownCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('footer content', () => {
    it('renders the footer hint about ? and Esc keys', () => {
      render(<KeyboardHelpOverlay open={true} onClose={vi.fn()} />);
      expect(screen.getByText(/to close/)).toBeDefined();
    });
  });
});
