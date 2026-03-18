import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockHealthQuery, mockRouterModelsInfoQuery } = vi.hoisted(() => ({
  mockHealthQuery: vi.fn(),
  mockRouterModelsInfoQuery: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock dependencies — BEFORE component import
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/settings/router',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href} data-testid={`link-${href}`}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/ErrorBanner', () => ({
  ErrorBanner: ({ message, onRetry }: { message: string; onRetry: () => void }) => (
    <div data-testid="error-banner">
      {message}
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  ),
}));

vi.mock('@/components/FetchingBar', () => ({
  FetchingBar: ({ isFetching }: { isFetching: boolean }) => (
    <div data-testid="fetching-bar">{isFetching ? 'fetching' : 'idle'}</div>
  ),
}));

vi.mock('@/components/RefreshButton', () => ({
  RefreshButton: ({ onClick, isFetching }: { onClick: () => void; isFetching: boolean }) => (
    <button type="button" data-testid="refresh-button" disabled={isFetching} onClick={onClick}>
      Refresh
    </button>
  ),
}));

vi.mock('@/lib/queries', () => ({
  healthQuery: () => mockHealthQuery(),
  routerModelsInfoQuery: () => mockRouterModelsInfoQuery(),
}));

// ---------------------------------------------------------------------------
// Component import (after mocks)
// ---------------------------------------------------------------------------

import { RouterConfigView } from './RouterConfigView';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function createDeployment(overrides?: Record<string, unknown>) {
  return {
    modelName: 'claude-3-5-sonnet',
    litellmParams: { model: 'claude-3-5-sonnet-20241022' },
    modelInfo: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderView() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterConfigView />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RouterConfigView', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: healthy proxy, one deployment
    mockHealthQuery.mockReturnValue({
      queryKey: ['health'],
      queryFn: vi.fn().mockResolvedValue({
        status: 'ok',
        timestamp: new Date().toISOString(),
        dependencies: {
          litellm: { status: 'ok', latencyMs: 20 },
        },
      }),
    });

    mockRouterModelsInfoQuery.mockReturnValue({
      queryKey: ['router-models-info'],
      queryFn: vi.fn().mockResolvedValue({
        deployments: [createDeployment()],
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Heading & Breadcrumb
  // =========================================================================

  it('renders heading "LiteLLM Router"', () => {
    renderView();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('LiteLLM Router');
  });

  it('renders breadcrumb link back to settings', () => {
    renderView();
    const link = screen.getByTestId('link-/settings');
    expect(link).toBeDefined();
    expect(link.textContent).toContain('Settings');
  });

  // =========================================================================
  // Proxy Status — Connected
  // =========================================================================

  it('shows "Connected" when litellm status is ok', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Connected')).toBeDefined();
    });
  });

  it('shows latency when litellm is connected', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByText('20ms')).toBeDefined();
    });
  });

  // =========================================================================
  // Proxy Status — Disconnected / Error
  // =========================================================================

  it('shows "Not configured" when litellm dependency is absent', async () => {
    mockHealthQuery.mockReturnValue({
      queryKey: ['health'],
      queryFn: vi.fn().mockResolvedValue({
        status: 'ok',
        timestamp: new Date().toISOString(),
        dependencies: {},
      }),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Not configured')).toBeDefined();
    });
  });

  it('shows error text when litellm status is not ok', async () => {
    mockHealthQuery.mockReturnValue({
      queryKey: ['health'],
      queryFn: vi.fn().mockResolvedValue({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        dependencies: {
          litellm: { status: 'error', error: 'Connection refused', latencyMs: 0 },
        },
      }),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Error: Connection refused')).toBeDefined();
    });
  });

  it('shows "Checking..." while health is loading', () => {
    mockHealthQuery.mockReturnValue({
      queryKey: ['health'],
      queryFn: vi.fn().mockReturnValue(new Promise(() => {})), // never resolves
    });
    renderView();
    expect(screen.getByText('Checking...')).toBeDefined();
  });

  // =========================================================================
  // Model Cards with Deployment Info
  // =========================================================================

  it('renders model name in deployment card', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByText('claude-3-5-sonnet')).toBeDefined();
    });
  });

  it('shows underlying model when different from modelName', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByText('claude-3-5-sonnet-20241022')).toBeDefined();
    });
  });

  it('hides underlying model when same as modelName', async () => {
    mockRouterModelsInfoQuery.mockReturnValue({
      queryKey: ['router-models-info'],
      queryFn: vi.fn().mockResolvedValue({
        deployments: [
          createDeployment({
            modelName: 'claude-3-5-sonnet',
            litellmParams: { model: 'claude-3-5-sonnet' },
          }),
        ],
      }),
    });
    renderView();
    await waitFor(() => {
      // modelName appears once (as the display name), not twice
      const matches = screen.getAllByText('claude-3-5-sonnet');
      expect(matches.length).toBe(1);
    });
  });

  it('renders multiple model cards', async () => {
    mockRouterModelsInfoQuery.mockReturnValue({
      queryKey: ['router-models-info'],
      queryFn: vi.fn().mockResolvedValue({
        deployments: [
          createDeployment({ modelName: 'model-alpha' }),
          createDeployment({ modelName: 'model-beta' }),
          createDeployment({ modelName: 'model-gamma' }),
        ],
      }),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText('model-alpha')).toBeDefined();
      expect(screen.getByText('model-beta')).toBeDefined();
      expect(screen.getByText('model-gamma')).toBeDefined();
    });
  });

  // =========================================================================
  // Provider Extraction
  // =========================================================================

  it('extracts "AWS Bedrock" from bedrock/ prefix', async () => {
    mockRouterModelsInfoQuery.mockReturnValue({
      queryKey: ['router-models-info'],
      queryFn: vi.fn().mockResolvedValue({
        deployments: [
          createDeployment({
            modelName: 'sonnet-bedrock',
            litellmParams: { model: 'bedrock/anthropic.claude-3-5-sonnet' },
          }),
        ],
      }),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText('AWS Bedrock')).toBeDefined();
    });
  });

  it('extracts "Google Vertex AI" from vertex_ai/ prefix', async () => {
    mockRouterModelsInfoQuery.mockReturnValue({
      queryKey: ['router-models-info'],
      queryFn: vi.fn().mockResolvedValue({
        deployments: [
          createDeployment({
            modelName: 'sonnet-vertex',
            litellmParams: { model: 'vertex_ai/claude-3-5-sonnet' },
          }),
        ],
      }),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Google Vertex AI')).toBeDefined();
    });
  });

  it('extracts "Azure OpenAI" from azure/ prefix', async () => {
    mockRouterModelsInfoQuery.mockReturnValue({
      queryKey: ['router-models-info'],
      queryFn: vi.fn().mockResolvedValue({
        deployments: [
          createDeployment({
            modelName: 'gpt-azure',
            litellmParams: { model: 'azure/gpt-4' },
          }),
        ],
      }),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Azure OpenAI')).toBeDefined();
    });
  });

  it('extracts "OpenAI" from openai/ prefix', async () => {
    mockRouterModelsInfoQuery.mockReturnValue({
      queryKey: ['router-models-info'],
      queryFn: vi.fn().mockResolvedValue({
        deployments: [
          createDeployment({
            modelName: 'gpt-4-openai',
            litellmParams: { model: 'openai/gpt-4' },
          }),
        ],
      }),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText('OpenAI')).toBeDefined();
    });
  });

  it('uses custom_llm_provider when set', async () => {
    mockRouterModelsInfoQuery.mockReturnValue({
      queryKey: ['router-models-info'],
      queryFn: vi.fn().mockResolvedValue({
        deployments: [
          createDeployment({
            modelName: 'custom-model',
            litellmParams: { model: 'some-model', custom_llm_provider: 'MyProvider' },
          }),
        ],
      }),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText('MyProvider')).toBeDefined();
    });
  });

  it('defaults to "Anthropic" when no prefix matches', async () => {
    mockRouterModelsInfoQuery.mockReturnValue({
      queryKey: ['router-models-info'],
      queryFn: vi.fn().mockResolvedValue({
        deployments: [
          createDeployment({
            modelName: 'claude-direct',
            litellmParams: { model: 'claude-3-5-sonnet-20241022' },
          }),
        ],
      }),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Anthropic')).toBeDefined();
    });
  });

  // =========================================================================
  // Loading State
  // =========================================================================

  it('shows model loading skeletons while models query is loading', () => {
    mockRouterModelsInfoQuery.mockReturnValue({
      queryKey: ['router-models-info'],
      queryFn: vi.fn().mockReturnValue(new Promise(() => {})), // never resolves
    });
    renderView();
    expect(screen.getByTestId('router-models-loading-skeleton')).toBeDefined();
  });

  // =========================================================================
  // Error State
  // =========================================================================

  it('shows error banner when health query fails', async () => {
    mockHealthQuery.mockReturnValue({
      queryKey: ['health'],
      queryFn: vi.fn().mockRejectedValue(new Error('Network error')),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('error-banner')).toBeDefined();
      expect(screen.getByText('Network error')).toBeDefined();
    });
  });

  it('shows proxy-not-configured message when models error and litellm not ok', async () => {
    mockHealthQuery.mockReturnValue({
      queryKey: ['health'],
      queryFn: vi.fn().mockResolvedValue({
        status: 'ok',
        timestamp: new Date().toISOString(),
        dependencies: {
          litellm: { status: 'error', error: 'down' },
        },
      }),
    });
    mockRouterModelsInfoQuery.mockReturnValue({
      queryKey: ['router-models-info'],
      queryFn: vi.fn().mockRejectedValue(new Error('Failed')),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText(/LiteLLM proxy is not configured/)).toBeDefined();
    });
  });

  it('shows "Failed to load model info" when models error but litellm is ok', async () => {
    mockRouterModelsInfoQuery.mockReturnValue({
      queryKey: ['router-models-info'],
      queryFn: vi.fn().mockRejectedValue(new Error('Failed')),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Failed to load model info from LiteLLM.')).toBeDefined();
    });
  });

  it('shows Retry button when models error and litellm is ok', async () => {
    mockRouterModelsInfoQuery.mockReturnValue({
      queryKey: ['router-models-info'],
      queryFn: vi.fn().mockRejectedValue(new Error('Failed')),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeDefined();
    });
  });

  // =========================================================================
  // Empty Model List
  // =========================================================================

  it('shows "No models configured" when deployments array is empty', async () => {
    mockRouterModelsInfoQuery.mockReturnValue({
      queryKey: ['router-models-info'],
      queryFn: vi.fn().mockResolvedValue({ deployments: [] }),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText('No models configured in LiteLLM.')).toBeDefined();
    });
  });

  // =========================================================================
  // Cost Info Display
  // =========================================================================

  it('shows cost per token when both input and output cost present', async () => {
    mockRouterModelsInfoQuery.mockReturnValue({
      queryKey: ['router-models-info'],
      queryFn: vi.fn().mockResolvedValue({
        deployments: [
          createDeployment({
            modelName: 'cost-model',
            modelInfo: {
              input_cost_per_token: 0.000003,
              output_cost_per_token: 0.000015,
            },
          }),
        ],
      }),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText(/\$0\.000003\/tok in/)).toBeDefined();
      expect(screen.getByText(/\$0\.000015\/tok out/)).toBeDefined();
    });
  });

  it('hides cost line when cost info is missing', async () => {
    mockRouterModelsInfoQuery.mockReturnValue({
      queryKey: ['router-models-info'],
      queryFn: vi.fn().mockResolvedValue({
        deployments: [
          createDeployment({
            modelName: 'no-cost-model',
            modelInfo: {},
          }),
        ],
      }),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText('no-cost-model')).toBeDefined();
    });
    // Cost text should not appear
    expect(screen.queryByText(/\/tok in/)).toBeNull();
  });

  it('shows cost when values are strings', async () => {
    mockRouterModelsInfoQuery.mockReturnValue({
      queryKey: ['router-models-info'],
      queryFn: vi.fn().mockResolvedValue({
        deployments: [
          createDeployment({
            modelName: 'string-cost-model',
            modelInfo: {
              input_cost_per_token: '0.000010',
              output_cost_per_token: '0.000020',
            },
          }),
        ],
      }),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText(/\$0\.000010\/tok in/)).toBeDefined();
      expect(screen.getByText(/\$0\.000020\/tok out/)).toBeDefined();
    });
  });

  // =========================================================================
  // Failover Strategy Section
  // =========================================================================

  it('renders Failover Strategy section', () => {
    renderView();
    expect(screen.getByText('Failover Strategy')).toBeDefined();
  });

  it('shows failover order', () => {
    renderView();
    expect(screen.getByText('Anthropic Direct')).toBeDefined();
    expect(screen.getByText('AWS Bedrock')).toBeDefined();
    expect(screen.getByText('Google Vertex AI')).toBeDefined();
  });

  it('shows retry attempts count', () => {
    renderView();
    expect(screen.getByText('3 attempts')).toBeDefined();
  });

  // =========================================================================
  // Refresh Button
  // =========================================================================

  it('renders a refresh button', () => {
    renderView();
    expect(screen.getByTestId('refresh-button')).toBeDefined();
  });
});
