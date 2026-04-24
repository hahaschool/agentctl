import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockMemoryProvidersApi } = vi.hoisted(() => ({
  mockMemoryProvidersApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    setActive: vi.fn(),
    remove: vi.fn(),
    testSaved: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
  api: {
    memoryProviders: mockMemoryProvidersApi,
  },
  memoryProvidersApi: mockMemoryProvidersApi,
}));

vi.mock('@/components/memory/ProviderDialog', () => ({
  ProviderDialog: ({
    open,
    onOpenChange,
    onSave,
    initial,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (body: unknown) => Promise<void>;
    initial?: { name: string };
  }) =>
    open ? (
      <div data-testid="provider-dialog">
        <span>{initial ? `Editing ${initial.name}` : 'Adding provider'}</span>
        <button
          type="button"
          onClick={() =>
            void onSave({
              name: 'OpenAI memory',
              provider: 'openai',
              model: 'text-embedding-3-small',
              apiKey: 'test-api-key',
              active: true,
              recentTestResult: { signedToken: 'opaque-test-token', apiKey: 'test-api-key' },
            })
          }
        >
          Save mock provider
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close mock provider
        </button>
      </div>
    ) : null,
}));

import { MemoryEmbeddingsSection } from './MemoryEmbeddingsSection';

const ACTIVE_PROVIDER = {
  id: 'provider-1',
  name: 'OpenAI memory',
  provider: 'openai' as const,
  model: 'text-embedding-3-small',
  apiKeyLast4: '1234',
  isActive: true,
  metadata: {
    lastTestOk: true,
    lastTestError: null,
    lastTestedAt: '2026-04-24T00:00:00Z',
    dim: 1536,
    latencyMs: 85,
    costUsd: 0.000001,
  },
  createdAt: '2026-04-24T00:00:00Z',
  updatedAt: '2026-04-24T00:00:00Z',
};

const INACTIVE_PROVIDER = {
  ...ACTIVE_PROVIDER,
  id: 'provider-2',
  name: 'OpenAI backup',
  apiKeyLast4: '5678',
  isActive: false,
};

const STALE_FAILED_PROVIDER = {
  ...ACTIVE_PROVIDER,
  id: 'provider-3',
  name: 'OpenAI stale',
  apiKeyLast4: '9999',
  metadata: {
    ...ACTIVE_PROVIDER.metadata,
    lastTestOk: false,
    lastTestError: 'old failure',
    lastTestedAt: '2026-04-23T00:00:00Z',
  },
};

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryEmbeddingsSection />
    </QueryClientProvider>,
  );
}

describe('MemoryEmbeddingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMemoryProvidersApi.create.mockResolvedValue({ provider: ACTIVE_PROVIDER });
    mockMemoryProvidersApi.update.mockResolvedValue({ provider: ACTIVE_PROVIDER });
    mockMemoryProvidersApi.setActive.mockResolvedValue({ provider: ACTIVE_PROVIDER });
    mockMemoryProvidersApi.remove.mockResolvedValue({ ok: true });
    mockMemoryProvidersApi.testSaved.mockResolvedValue({
      ok: true,
      dim: 1536,
      model: 'text-embedding-3-small',
      latencyMs: 90,
      costUsd: 0.000001,
    });
  });

  it('shows the empty state when no providers are configured', async () => {
    mockMemoryProvidersApi.list.mockResolvedValue({ providers: [] });

    renderSection();

    await waitFor(() => {
      expect(screen.getByText(/No embedding providers configured/i)).toBeDefined();
    });
  });

  it('renders provider cards with active status and key tail', async () => {
    mockMemoryProvidersApi.list.mockResolvedValue({
      providers: [ACTIVE_PROVIDER, INACTIVE_PROVIDER],
    });

    renderSection();

    await waitFor(() => {
      expect(screen.getByText('OpenAI memory')).toBeDefined();
    });
    expect(screen.getByText('Active')).toBeDefined();
    expect(screen.getAllByText('text-embedding-3-small')).toHaveLength(2);
    expect(screen.getByText(/Key ending 1234/)).toBeDefined();
    expect(screen.getByRole('button', { name: /Set OpenAI backup active/i })).toBeDefined();
  });

  it('opens the add dialog and creates a provider', async () => {
    mockMemoryProvidersApi.list.mockResolvedValue({ providers: [] });

    renderSection();

    await waitFor(() => {
      expect(screen.getByText(/No embedding providers configured/i)).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));
    expect(screen.getByTestId('provider-dialog')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Save mock provider' }));

    await waitFor(() => {
      expect(mockMemoryProvidersApi.create).toHaveBeenCalled();
    });
    expect(mockMemoryProvidersApi.create.mock.calls[0]?.[0]).toMatchObject({
      name: 'OpenAI memory',
      recentTestResult: {
        signedToken: 'opaque-test-token',
        apiKey: 'test-api-key',
      },
    });
  });

  it('activates inactive providers', async () => {
    mockMemoryProvidersApi.list.mockResolvedValue({
      providers: [ACTIVE_PROVIDER, INACTIVE_PROVIDER],
    });

    renderSection();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Set OpenAI backup active/i })).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: /Set OpenAI backup active/i }));

    await waitFor(() => {
      expect(mockMemoryProvidersApi.setActive).toHaveBeenCalled();
    });
    expect(mockMemoryProvidersApi.setActive.mock.calls[0]?.[0]).toBe('provider-2');
  });

  it('shows saved-provider test results from the transient test response', async () => {
    mockMemoryProvidersApi.list.mockResolvedValue({
      providers: [STALE_FAILED_PROVIDER],
    });

    renderSection();

    await waitFor(() => {
      expect(screen.getByText(/Test failed: old failure/i)).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: /Test OpenAI stale/i }));

    await waitFor(() => {
      expect(mockMemoryProvidersApi.testSaved).toHaveBeenCalled();
    });
    expect(mockMemoryProvidersApi.testSaved.mock.calls[0]?.[0]).toBe('provider-3');
    expect(screen.getByText(/Test passed.*dim 1536.*90ms/i)).toBeDefined();
  });
});
