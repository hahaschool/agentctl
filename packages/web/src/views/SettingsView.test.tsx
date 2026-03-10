import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockHealthQuery } = vi.hoisted(() => ({
  mockHealthQuery: vi.fn(),
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

vi.mock('./RuntimeAccessSection', () => ({
  RuntimeAccessSection: () => <div data-testid="runtime-access-section">RuntimeAccessSection</div>,
}));

vi.mock('./RuntimeConsistencySection', () => ({
  RuntimeConsistencySection: () => (
    <div data-testid="runtime-consistency-section">RuntimeConsistencySection</div>
  ),
}));

vi.mock('./settings/RuntimeProfilesSection', () => ({
  RuntimeProfilesSection: () => (
    <div data-testid="runtime-profiles-section">RuntimeProfilesSection</div>
  ),
}));

vi.mock('./settings/WorkersSyncSection', () => ({
  WorkersSyncSection: () => <div data-testid="workers-sync-section">WorkersSyncSection</div>,
}));

import { SettingsView } from './SettingsView';

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

  it('renders the runtime-centric page heading', () => {
    renderSettings();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Runtime Control Center');
  });

  it('renders the runtime-centric page description', () => {
    renderSettings();
    expect(screen.getByText(/Configure managed runtimes, worker sync, and mixed access custody/)).toBeDefined();
  });

  it('renders the left navigation items', () => {
    renderSettings();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getByText('Overview')).toBeDefined();
    expect(within(nav).getByText('Runtime Profiles')).toBeDefined();
    expect(within(nav).getByText('Credentials & Access')).toBeDefined();
    expect(within(nav).getByText('Workers & Sync')).toBeDefined();
    expect(within(nav).getByText('Routing & Autonomy')).toBeDefined();
    expect(within(nav).getByText('Appearance & Preferences')).toBeDefined();
  });

  it('renders the top-level section headings', () => {
    renderSettings();
    expect(screen.getAllByText('Overview').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Runtime Profiles').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Credentials & Access').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Workers & Sync').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Routing & Autonomy').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Appearance & Preferences').length).toBeGreaterThan(0);
  });

  it('renders child runtime-centric sections', () => {
    renderSettings();
    expect(screen.getByTestId('runtime-profiles-section')).toBeDefined();
    expect(screen.getByTestId('accounts-section')).toBeDefined();
    expect(screen.getByTestId('project-accounts-section')).toBeDefined();
    expect(screen.getByTestId('workers-sync-section')).toBeDefined();
    expect(screen.getByTestId('failover-section')).toBeDefined();
    expect(screen.getByTestId('preferences-section')).toBeDefined();
  });

  it('renders the ProjectAccountsSection component', () => {
    renderSettings();
    expect(screen.getByTestId('project-accounts-section')).toBeDefined();
  });

  it('renders the RuntimeAccessSection component', () => {
    renderSettings();
    expect(screen.getByTestId('runtime-access-section')).toBeDefined();
  });

  it('renders the RuntimeConsistencySection component', () => {
    renderSettings();
    expect(screen.getByTestId('runtime-consistency-section')).toBeDefined();
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
      (b) => b.textContent === 'System' || b.textContent === 'Light' || b.textContent === 'Dark',
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
    expect(screen.getByText('Multi-provider failover routing via LiteLLM.')).toBeDefined();
  });

  it('renders a link to /settings/router', () => {
    renderSettings();
    const link = screen.getByTestId('link-/settings/router');
    expect(link).toBeDefined();
  });

  // =========================================================================
  // Connection Section (Control Plane)
  // =========================================================================

  it('still renders the control plane health block', async () => {
    renderSettings();
    expect(screen.getByText('Control Plane')).toBeDefined();
    await waitFor(() => {
      expect(screen.getByText('Connected')).toBeDefined();
    });
  });

  it('still renders the LiteLLM router link', () => {
    renderSettings();
    expect(screen.getByText('LLM Router')).toBeDefined();
    expect(screen.getByTestId('link-/settings/router')).toBeDefined();
  });

  it('still renders the theme and about subsections', () => {
    renderSettings();
    expect(screen.getByText('Theme')).toBeDefined();
    expect(screen.getByText('Keyboard Shortcuts')).toBeDefined();
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
  // Theme Section — interaction
  // =========================================================================

  it('renders three theme buttons that are clickable', () => {
    renderSettings();
    const buttons = screen.getAllByRole('button');
    const themeButtons = buttons.filter(
      (b) => b.textContent === 'System' || b.textContent === 'Light' || b.textContent === 'Dark',
    );
    expect(themeButtons.length).toBe(3);
    // Each button should be of type="button"
    for (const btn of themeButtons) {
      expect(btn.getAttribute('type')).toBe('button');
    }
  });

  // =========================================================================
  // Keyboard Shortcuts — specific shortcut descriptions
  // =========================================================================

  it('renders navigation shortcut descriptions', () => {
    renderSettings();
    expect(screen.getByText('Dashboard')).toBeDefined();
    expect(screen.getByText('Machines')).toBeDefined();
    expect(screen.getByText('Agents')).toBeDefined();
    expect(screen.getByText('Sessions')).toBeDefined();
    // "Settings" appears as both h1 and shortcut desc — use getAllByText
    const settingsEls = screen.getAllByText('Settings');
    expect(settingsEls.length).toBeGreaterThanOrEqual(2);
  });

  it('renders global shortcut descriptions', () => {
    renderSettings();
    expect(screen.getByText('Command palette')).toBeDefined();
    expect(screen.getByText('Refresh current page')).toBeDefined();
    expect(screen.getByText('Toggle keyboard help')).toBeDefined();
  });

  it('renders the correct number of kbd elements for all shortcuts', () => {
    renderSettings();
    const kbdElements = document.querySelectorAll('kbd');
    // ALL_SHORTCUTS has 12 entries, each with 1 key = 12 kbd elements
    expect(kbdElements.length).toBe(12);
  });

  it('renders specific shortcut key labels', () => {
    renderSettings();
    const kbdElements = Array.from(document.querySelectorAll('kbd'));
    const keyTexts = kbdElements.map((el) => el.textContent);
    expect(keyTexts).toContain('1');
    expect(keyTexts).toContain('r');
    expect(keyTexts).toContain('?');
    expect(keyTexts).toContain('Esc');
  });

  // =========================================================================
  // Connection Section — dependency error display
  // =========================================================================

  it('shows Error for unhealthy dependencies', async () => {
    mockHealthQuery.mockReturnValue({
      queryKey: ['health'],
      queryFn: vi.fn().mockResolvedValue({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        dependencies: {
          postgres: { status: 'ok', latencyMs: 10 },
          redis: { status: 'error', latencyMs: null },
        },
      }),
    });

    renderSettings();
    await waitFor(() => {
      expect(screen.getByText('Error')).toBeDefined();
      expect(screen.getByText('10ms')).toBeDefined();
    });
  });

  // =========================================================================
  // Router Link — status indicator
  // =========================================================================

  it('renders router link description text', () => {
    renderSettings();
    expect(screen.getByText('Multi-provider failover routing via LiteLLM.')).toBeDefined();
  });

  it('renders Configure link text', () => {
    renderSettings();
    // The link contains "Configure →" (HTML entity &rarr; renders as →)
    const link = screen.getByTestId('link-/settings/router');
    expect(link.textContent).toContain('Configure');
  });
});
