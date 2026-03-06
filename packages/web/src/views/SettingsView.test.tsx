import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockHealthQuery } = vi.hoisted(() => ({
  mockHealthQuery: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock dependencies — BEFORE component import
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href} data-testid={`link-${href}`}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className: string }) => (
    <div className={className} data-testid="skeleton" />
  ),
}));

vi.mock('@/lib/queries', () => ({
  healthQuery: () => mockHealthQuery(),
}));

// Stub child sections — they have their own complex dependencies
vi.mock('./AccountsSection', () => ({
  AccountsSection: () => <div data-testid="accounts-section">AccountsSection</div>,
}));

vi.mock('./FailoverSection', () => ({
  FailoverSection: () => <div data-testid="failover-section">FailoverSection</div>,
}));

vi.mock('./PreferencesSection', () => ({
  PreferencesSection: () => <div data-testid="preferences-section">PreferencesSection</div>,
}));

vi.mock('./ProjectAccountsSection', () => ({
  ProjectAccountsSection: () => (
    <div data-testid="project-accounts-section">ProjectAccountsSection</div>
  ),
}));

// ---------------------------------------------------------------------------
// Component import (after mocks)
// ---------------------------------------------------------------------------

import { SettingsView } from './SettingsView';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsView />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockHealthQuery.mockReturnValue({
      queryKey: ['health'],
      queryFn: vi.fn().mockResolvedValue({
        status: 'ok',
        timestamp: new Date().toISOString(),
        dependencies: {
          postgres: { status: 'ok', latencyMs: 10 },
          redis: { status: 'ok', latencyMs: 5 },
          litellm: { status: 'ok', latencyMs: 20 },
        },
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Page Heading
  // =========================================================================

  it('renders the page heading', () => {
    renderSettings();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('Settings');
  });

  it('renders the page description', () => {
    renderSettings();
    expect(
      screen.getByText('Configure accounts, preferences, and system connections.'),
    ).toBeDefined();
  });

  // =========================================================================
  // Settings Group Sections
  // =========================================================================

  it('renders the API Accounts group heading', () => {
    renderSettings();
    expect(screen.getByText('API Accounts')).toBeDefined();
  });

  it('renders the Appearance & Preferences group heading', () => {
    renderSettings();
    expect(screen.getByText('Appearance & Preferences')).toBeDefined();
  });

  it('renders the System group heading', () => {
    renderSettings();
    const headings = screen.getAllByText('System');
    // "System" appears as both a group heading (h2) and a theme option label
    const h2Heading = headings.find((el) => el.tagName === 'H2');
    expect(h2Heading).toBeDefined();
  });

  // =========================================================================
  // Child Sections Visibility
  // =========================================================================

  it('renders the AccountsSection component', () => {
    renderSettings();
    expect(screen.getByTestId('accounts-section')).toBeDefined();
  });

  it('renders the FailoverSection component', () => {
    renderSettings();
    expect(screen.getByTestId('failover-section')).toBeDefined();
  });

  it('renders the PreferencesSection component', () => {
    renderSettings();
    expect(screen.getByTestId('preferences-section')).toBeDefined();
  });

  it('renders the ProjectAccountsSection component', () => {
    renderSettings();
    expect(screen.getByTestId('project-accounts-section')).toBeDefined();
  });

  // =========================================================================
  // Theme Section
  // =========================================================================

  it('renders the Theme heading', () => {
    renderSettings();
    expect(screen.getByText('Theme')).toBeDefined();
  });

  it('renders theme description text', () => {
    renderSettings();
    expect(screen.getByText('Choose your preferred color scheme.')).toBeDefined();
  });

  it('renders all three theme option labels', () => {
    renderSettings();
    // "System" also appears as a group heading, so use getAllByText
    const systemLabels = screen.getAllByText('System');
    expect(systemLabels.length).toBeGreaterThanOrEqual(2); // group heading + theme label
    expect(screen.getByText('Light')).toBeDefined();
    expect(screen.getByText('Dark')).toBeDefined();
  });

  it('renders theme preview cards as buttons', () => {
    renderSettings();
    const buttons = screen.getAllByRole('button');
    // At least 3 theme buttons + retry button
    const themeButtons = buttons.filter(
      (b) =>
        b.textContent === 'System' ||
        b.textContent === 'Light' ||
        b.textContent === 'Dark',
    );
    expect(themeButtons.length).toBe(3);
  });

  // =========================================================================
  // Router Config Link
  // =========================================================================

  it('renders the LLM Router heading', () => {
    renderSettings();
    expect(screen.getByText('LLM Router')).toBeDefined();
  });

  it('renders the router description', () => {
    renderSettings();
    expect(
      screen.getByText('Multi-provider failover routing via LiteLLM.'),
    ).toBeDefined();
  });

  it('renders a link to /settings/router', () => {
    renderSettings();
    const link = screen.getByTestId('link-/settings/router');
    expect(link).toBeDefined();
  });

  // =========================================================================
  // Connection Section (Control Plane)
  // =========================================================================

  it('renders the Control Plane heading', () => {
    renderSettings();
    expect(screen.getByText('Control Plane')).toBeDefined();
  });

  it('shows Connected status when health is ok', async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByText('Connected')).toBeDefined();
    });
  });

  it('shows dependency cards when health data has dependencies', async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByText('postgres')).toBeDefined();
      expect(screen.getByText('redis')).toBeDefined();
      expect(screen.getByText('litellm')).toBeDefined();
    });
  });

  it('shows latency values for healthy dependencies', async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByText('10ms')).toBeDefined();
      expect(screen.getByText('5ms')).toBeDefined();
      expect(screen.getByText('20ms')).toBeDefined();
    });
  });

  it('renders retry health check button', () => {
    renderSettings();
    const retryButton = screen.getByLabelText('Retry health check');
    expect(retryButton).toBeDefined();
  });

  // =========================================================================
  // Keyboard Shortcuts Section
  // =========================================================================

  it('renders the Keyboard Shortcuts heading', () => {
    renderSettings();
    expect(screen.getByText('Keyboard Shortcuts')).toBeDefined();
  });

  it('renders shortcut key badges as kbd elements', () => {
    renderSettings();
    // At least one <kbd> element should be present for shortcuts
    const kbdElements = document.querySelectorAll('kbd');
    expect(kbdElements.length).toBeGreaterThan(0);
  });

  // =========================================================================
  // About Section
  // =========================================================================

  it('renders the About AgentCTL heading', () => {
    renderSettings();
    expect(screen.getByText('About AgentCTL')).toBeDefined();
  });

  it('shows version number', () => {
    renderSettings();
    expect(screen.getByText('0.1.0')).toBeDefined();
  });

  it('shows framework info', () => {
    renderSettings();
    expect(screen.getByText('Next.js + React 19')).toBeDefined();
  });

  it('shows UI toolkit info', () => {
    renderSettings();
    expect(screen.getByText('Tailwind v4 + shadcn')).toBeDefined();
  });

  it('shows data layer info', () => {
    renderSettings();
    expect(screen.getByText('TanStack Query v5')).toBeDefined();
  });

  it('shows all about labels', () => {
    renderSettings();
    expect(screen.getByText('Version')).toBeDefined();
    expect(screen.getByText('Framework')).toBeDefined();
    expect(screen.getByText('UI')).toBeDefined();
    expect(screen.getByText('Data')).toBeDefined();
  });

  // =========================================================================
  // Health Error States
  // =========================================================================

  it('shows Unreachable when health query errors', async () => {
    mockHealthQuery.mockReturnValue({
      queryKey: ['health'],
      queryFn: vi.fn().mockRejectedValue(new Error('Network error')),
    });

    renderSettings();
    await waitFor(() => {
      expect(screen.getByText('Unreachable')).toBeDefined();
    });
  });

  it('shows Degraded when health status is not ok', async () => {
    mockHealthQuery.mockReturnValue({
      queryKey: ['health'],
      queryFn: vi.fn().mockResolvedValue({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        dependencies: {},
      }),
    });

    renderSettings();
    await waitFor(() => {
      expect(screen.getByText('Degraded')).toBeDefined();
    });
  });

  // =========================================================================
  // API Accounts group description
  // =========================================================================

  it('shows API Accounts group description', () => {
    renderSettings();
    expect(
      screen.getByText(
        'Manage provider credentials and configure how requests are routed between accounts.',
      ),
    ).toBeDefined();
  });
});
