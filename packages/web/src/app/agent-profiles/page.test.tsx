import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentProfile } from '@/lib/api/agent-profiles';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockListAgentProfiles, mockCreateAgentProfile, mockDeleteAgentProfile } = vi.hoisted(
  () => ({
    mockListAgentProfiles: vi.fn(),
    mockCreateAgentProfile: vi.fn(),
    mockDeleteAgentProfile: vi.fn(),
  }),
);

// ---------------------------------------------------------------------------
// Module boundary mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ErrorBanner', () => ({
  ErrorBanner: ({ message }: { message: string }) => (
    <div data-testid="error-banner">{message}</div>
  ),
}));

vi.mock('@/components/FetchingBar', () => ({
  FetchingBar: () => <div data-testid="fetching-bar" />,
}));

vi.mock('@/components/RefreshButton', () => ({
  RefreshButton: ({ onClick }: { onClick: () => void }) => (
    <button type="button" data-testid="refresh-button" onClick={onClick}>
      Refresh
    </button>
  ),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/lib/api/agent-profiles', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/agent-profiles')>(
    '@/lib/api/agent-profiles',
  );
  return {
    ...actual,
    agentProfilesApi: {
      listAgentProfiles: mockListAgentProfiles,
      createAgentProfile: mockCreateAgentProfile,
      deleteAgentProfile: mockDeleteAgentProfile,
      getAgentProfile: vi.fn(),
      updateAgentProfile: vi.fn(),
    },
  };
});

// ---------------------------------------------------------------------------
// Component import — AFTER mocks
// ---------------------------------------------------------------------------

import Page from './page';

// ---------------------------------------------------------------------------
// Test data factory
// ---------------------------------------------------------------------------

function makeProfile(overrides?: Partial<AgentProfile>): AgentProfile {
  return {
    id: 'profile-1',
    name: 'code-reviewer',
    runtimeType: 'claude-code',
    modelId: 'claude-opus-4-5',
    providerId: 'anthropic',
    capabilities: ['code-review'],
    toolScopes: ['Read', 'Grep'],
    maxTokensPerTask: null,
    maxCostPerHour: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPage(): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Page />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentProfilesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAgentProfiles.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the page heading', async () => {
    renderPage();
    expect(screen.getByText('Agent Profiles')).toBeDefined();
  });

  it('shows the empty state when no profiles exist', async () => {
    mockListAgentProfiles.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('agent-profiles-empty')).toBeDefined();
    });
    expect(screen.getByText('No agent profiles yet.')).toBeDefined();
  });

  it('renders a row for each profile returned by the API', async () => {
    mockListAgentProfiles.mockResolvedValue([
      makeProfile({ id: 'p-alpha', name: 'alpha', modelId: 'claude-sonnet-4-6' }),
      makeProfile({ id: 'p-beta', name: 'beta', runtimeType: 'codex', providerId: 'openai' }),
    ]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('alpha')).toBeDefined();
      expect(screen.getByText('beta')).toBeDefined();
    });
    expect(screen.getByText('claude-sonnet-4-6')).toBeDefined();
    expect(screen.getByText('codex')).toBeDefined();
  });

  it('opens the create dialog when the "New profile" button is clicked', async () => {
    mockListAgentProfiles.mockResolvedValue([]);
    renderPage();

    await waitFor(() => expect(screen.getByTestId('new-agent-profile')).toBeDefined());
    fireEvent.click(screen.getByTestId('new-agent-profile'));

    expect(screen.getByTestId('agent-profile-form-dialog')).toBeDefined();
    expect(screen.getByLabelText('Name')).toBeDefined();
    expect(screen.getByLabelText('Model ID')).toBeDefined();
  });

  it('calls createAgentProfile with sanitized capability lists on submit', async () => {
    mockListAgentProfiles.mockResolvedValue([]);
    mockCreateAgentProfile.mockResolvedValue(makeProfile({ id: 'p-new', name: 'new-one' }));

    renderPage();
    await waitFor(() => expect(screen.getByTestId('new-agent-profile')).toBeDefined());
    fireEvent.click(screen.getByTestId('new-agent-profile'));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  new-one  ' } });
    fireEvent.change(screen.getByLabelText('Model ID'), { target: { value: 'claude-opus-4-5' } });
    fireEvent.change(screen.getByLabelText('Provider ID'), { target: { value: 'anthropic' } });
    fireEvent.change(screen.getByLabelText('Capabilities (comma-separated)'), {
      target: { value: 'code-review, planning, ' },
    });

    fireEvent.click(screen.getByTestId('agent-profile-submit'));

    await waitFor(() => {
      expect(mockCreateAgentProfile).toHaveBeenCalledTimes(1);
    });
    expect(mockCreateAgentProfile).toHaveBeenCalledWith({
      name: 'new-one',
      runtimeType: 'claude-code',
      modelId: 'claude-opus-4-5',
      providerId: 'anthropic',
      capabilities: ['code-review', 'planning'],
      toolScopes: [],
    });
  });
});
