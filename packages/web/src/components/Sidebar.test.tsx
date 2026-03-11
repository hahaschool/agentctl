import { fireEvent, render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the component under test
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
const mockPathname = vi.fn<() => string>(() => '/');

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({ push: mockPush, replace: vi.fn(), back: vi.fn(), forward: vi.fn() }),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: vi.fn() }),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [k: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Mock heavy child components that are not under test
vi.mock('./CommandPalette', () => ({
  CommandPalette: () => <div data-testid="command-palette" />,
}));

vi.mock('./KeyboardHelpOverlay', () => ({
  KeyboardHelpOverlay: () => <div data-testid="keyboard-help-overlay" />,
}));

vi.mock('./NotificationBell', () => ({
  NotificationBell: () => <div data-testid="notification-bell" />,
}));

vi.mock('./ConnectionBanner', () => ({
  ConnectionBanner: () => <div data-testid="connection-banner" />,
}));

vi.mock('./WsStatusIndicator', () => ({
  WsStatusIndicator: () => <div data-testid="ws-status" />,
}));

vi.mock('@/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() }),
  ToastContainer: () => null,
}));

vi.mock('../contexts/notification-context', () => ({
  useNotificationContext: () => ({
    notifications: [],
    unreadCount: 0,
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    clearAll: vi.fn(),
  }),
}));

vi.mock('../hooks/use-websocket', () => ({
  useWebSocket: () => ({ status: 'connected' }),
}));

import { Sidebar } from './Sidebar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
  mockPathname.mockReturnValue('/');
  mockPush.mockClear();
});

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/', shortcut: '1' },
  { label: 'Machines', href: '/machines', shortcut: '2' },
  { label: 'Agents', href: '/agents', shortcut: '3' },
  { label: 'Sessions', href: '/sessions', shortcut: '4' },
  { label: 'Discover', href: '/discover', shortcut: '5' },
  { label: 'Logs', href: '/logs', shortcut: '6' },
  { label: 'Settings', href: '/settings', shortcut: '7' },
  { label: 'Memory', href: '/memory', shortcut: '8' },
];

// ===========================================================================
// Sidebar — Navigation links
// ===========================================================================

describe('Sidebar', () => {
  describe('navigation links', () => {
    it('renders all navigation links', () => {
      render(<Sidebar />);
      for (const item of NAV_ITEMS) {
        const links = screen.getAllByText(item.label);
        expect(links.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('each navigation link has the correct href', () => {
      render(<Sidebar />);
      for (const item of NAV_ITEMS) {
        // getAllByRole('link') returns <a> elements; filter by text
        const links = screen.getAllByRole('link', { name: new RegExp(item.label) });
        expect(links.length).toBeGreaterThanOrEqual(1);
        expect(links[0]?.getAttribute('href')).toBe(item.href);
      }
    });
  });

  // =========================================================================
  // Active route highlighting
  // =========================================================================

  describe('active route highlighting', () => {
    it('marks Dashboard as active when pathname is "/"', () => {
      mockPathname.mockReturnValue('/');
      render(<Sidebar />);
      const links = screen.getAllByRole('link', { name: /Dashboard/ });
      expect(links[0]?.getAttribute('aria-current')).toBe('page');
    });

    it('marks Machines as active when pathname starts with "/machines"', () => {
      mockPathname.mockReturnValue('/machines/abc-123');
      render(<Sidebar />);
      const links = screen.getAllByRole('link', { name: /Machines/ });
      expect(links[0]?.getAttribute('aria-current')).toBe('page');
    });

    it('marks Sessions as active when pathname is "/sessions"', () => {
      mockPathname.mockReturnValue('/sessions');
      render(<Sidebar />);
      const links = screen.getAllByRole('link', { name: /Sessions/ });
      expect(links[0]?.getAttribute('aria-current')).toBe('page');
    });

    it('does not mark Dashboard as active when on another page', () => {
      mockPathname.mockReturnValue('/agents');
      render(<Sidebar />);
      const links = screen.getAllByRole('link', { name: /Dashboard/ });
      expect(links[0]?.getAttribute('aria-current')).toBeNull();
    });

    it('does not mark Machines as active when on "/sessions"', () => {
      mockPathname.mockReturnValue('/sessions');
      render(<Sidebar />);
      const links = screen.getAllByRole('link', { name: /Machines/ });
      expect(links[0]?.getAttribute('aria-current')).toBeNull();
    });

    it('applies active CSS classes to the current route link', () => {
      mockPathname.mockReturnValue('/agents');
      render(<Sidebar />);
      const links = screen.getAllByRole('link', { name: /Agents/ });
      expect(links[0]?.className).toContain('font-semibold');
      expect(links[0]?.className).toContain('border-l-primary');
    });

    it('applies inactive CSS classes to non-current route links', () => {
      mockPathname.mockReturnValue('/agents');
      render(<Sidebar />);
      const links = screen.getAllByRole('link', { name: /Dashboard/ });
      expect(links[0]?.className).toContain('font-normal');
      expect(links[0]?.className).toContain('border-l-transparent');
    });
  });

  // =========================================================================
  // Version number
  // =========================================================================

  describe('version display', () => {
    it('shows the version number text', () => {
      render(<Sidebar />);
      expect(screen.getByText('v0.1.0')).toBeDefined();
    });
  });

  // =========================================================================
  // Theme toggle
  // =========================================================================

  describe('theme toggle', () => {
    it('renders a theme toggle button with an appropriate aria-label', () => {
      render(<Sidebar />);
      const btn = screen.getByRole('button', { name: /Switch to .* mode/ });
      expect(btn).toBeDefined();
    });

    it('shows "Switch to light mode" when theme is dark', () => {
      render(<Sidebar />);
      const btn = screen.getByRole('button', { name: 'Switch to light mode' });
      expect(btn).toBeDefined();
    });
  });

  // =========================================================================
  // Mobile hamburger button
  // =========================================================================

  describe('mobile hamburger', () => {
    it('renders a button with "Toggle navigation" aria-label', () => {
      render(<Sidebar />);
      const btn = screen.getByRole('button', { name: 'Toggle navigation' });
      expect(btn).toBeDefined();
    });

    it('renders a close navigation button', () => {
      render(<Sidebar />);
      const btn = screen.getByRole('button', { name: 'Close navigation' });
      expect(btn).toBeDefined();
    });
  });

  // =========================================================================
  // Keyboard shortcut badges
  // =========================================================================

  describe('keyboard shortcut badges', () => {
    it('displays shortcut numbers for each nav item', () => {
      render(<Sidebar />);
      for (const item of NAV_ITEMS) {
        // Each shortcut digit appears as a <span> inside the nav link
        const elements = screen.getAllByText(item.shortcut);
        expect(elements.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('displays keyboard hint text for 1-8 Nav', () => {
      render(<Sidebar />);
      expect(screen.getByText(/Nav/)).toBeDefined();
    });

    it('displays keyboard hint text for search shortcut', () => {
      render(<Sidebar />);
      expect(screen.getByText(/Search/)).toBeDefined();
    });

    it('displays keyboard hint text for help shortcut', () => {
      render(<Sidebar />);
      expect(screen.getByText(/Help/)).toBeDefined();
    });
  });

  // =========================================================================
  // Branding
  // =========================================================================

  describe('branding', () => {
    it('shows the AgentCTL brand name', () => {
      render(<Sidebar />);
      const brandElements = screen.getAllByText('AgentCTL');
      expect(brandElements.length).toBeGreaterThanOrEqual(1);
    });

    it('shows the BETA badge', () => {
      render(<Sidebar />);
      const betaElements = screen.getAllByText('BETA');
      expect(betaElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // Child component rendering
  // =========================================================================

  describe('child components', () => {
    it('renders the CommandPalette component', () => {
      render(<Sidebar />);
      expect(screen.getByTestId('command-palette')).toBeDefined();
    });

    it('renders the KeyboardHelpOverlay component', () => {
      render(<Sidebar />);
      expect(screen.getByTestId('keyboard-help-overlay')).toBeDefined();
    });

    it('renders the NotificationBell component', () => {
      render(<Sidebar />);
      expect(screen.getByTestId('notification-bell')).toBeDefined();
    });

    it('renders the ConnectionBanner component', () => {
      render(<Sidebar />);
      expect(screen.getByTestId('connection-banner')).toBeDefined();
    });

    it('renders WsStatusIndicator components', () => {
      render(<Sidebar />);
      const indicators = screen.getAllByTestId('ws-status');
      expect(indicators.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // Keyboard navigation shortcuts
  // =========================================================================

  describe('keyboard navigation', () => {
    it('navigates to Dashboard when "1" key is pressed', () => {
      render(<Sidebar />);
      fireEvent.keyDown(document, { key: '1' });
      expect(mockPush).toHaveBeenCalledWith('/');
    });

    it('navigates to Machines when "2" key is pressed', () => {
      render(<Sidebar />);
      fireEvent.keyDown(document, { key: '2' });
      expect(mockPush).toHaveBeenCalledWith('/machines');
    });

    it('navigates to Agents when "3" key is pressed', () => {
      render(<Sidebar />);
      fireEvent.keyDown(document, { key: '3' });
      expect(mockPush).toHaveBeenCalledWith('/agents');
    });

    it('navigates to Sessions when "4" key is pressed', () => {
      render(<Sidebar />);
      fireEvent.keyDown(document, { key: '4' });
      expect(mockPush).toHaveBeenCalledWith('/sessions');
    });

    it('navigates to Discover when "5" key is pressed', () => {
      render(<Sidebar />);
      fireEvent.keyDown(document, { key: '5' });
      expect(mockPush).toHaveBeenCalledWith('/discover');
    });

    it('navigates to Logs when "6" key is pressed', () => {
      render(<Sidebar />);
      fireEvent.keyDown(document, { key: '6' });
      expect(mockPush).toHaveBeenCalledWith('/logs');
    });

    it('navigates to Settings when "7" key is pressed', () => {
      render(<Sidebar />);
      fireEvent.keyDown(document, { key: '7' });
      expect(mockPush).toHaveBeenCalledWith('/settings');
    });

    it('does not navigate for unrecognized keys', () => {
      render(<Sidebar />);
      fireEvent.keyDown(document, { key: '9' });
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('does not navigate when key is pressed inside an input', () => {
      render(
        <div>
          <Sidebar />
          <input data-testid="test-input" />
        </div>,
      );
      const input = screen.getByTestId('test-input');
      fireEvent.keyDown(input, { key: '1' });
      expect(mockPush).not.toHaveBeenCalled();
    });
  });
});
