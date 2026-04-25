import type { EmbeddingProvider } from '@agentctl/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockUseQuery = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: unknown) => mockUseQuery(options),
  queryOptions: (options: unknown) => options,
}));

vi.mock('@/lib/queries', () => ({
  memoryProvidersQuery: () => ({ queryKey: ['memory', 'providers'] }),
}));

import { MissingEmbeddingAlert } from './MissingEmbeddingAlert';

const ACTIVE_PROVIDER: EmbeddingProvider = {
  id: 'provider-1',
  name: 'OpenAI memory',
  provider: 'openai',
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

describe('MissingEmbeddingAlert', () => {
  it('renders nothing while provider state is pending', () => {
    mockUseQuery.mockReturnValue({ data: undefined, isPending: true, isError: false });

    const { container } = render(<MissingEmbeddingAlert />);

    expect(container.firstChild).toBeNull();
  });

  it('renders an alert when no embedding providers are configured', () => {
    mockUseQuery.mockReturnValue({
      data: { providers: [] },
      isPending: false,
      isError: false,
    });

    render(<MissingEmbeddingAlert />);

    expect(screen.getByRole('alert')).toHaveTextContent(/no embedding provider configured/i);
    expect(screen.getByRole('link', { name: /go to settings/i })).toHaveAttribute(
      'href',
      '/settings#memory-embeddings',
    );
  });

  it('renders nothing when the active provider last tested successfully', () => {
    mockUseQuery.mockReturnValue({
      data: { providers: [ACTIVE_PROVIDER] },
      isPending: false,
      isError: false,
    });

    const { container } = render(<MissingEmbeddingAlert />);

    expect(container.firstChild).toBeNull();
  });

  it('renders provider failure copy without a settings link in peer-note mode', () => {
    mockUseQuery.mockReturnValue({
      data: {
        providers: [
          {
            ...ACTIVE_PROVIDER,
            metadata: {
              ...ACTIVE_PROVIDER.metadata,
              lastTestOk: false,
              lastTestError: '401 Unauthorized',
            },
          },
        ],
      },
      isPending: false,
      isError: false,
    });

    render(<MissingEmbeddingAlert showPeerNote />);

    expect(screen.getByRole('alert')).toHaveTextContent(/provider test failed/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/401 Unauthorized/i);
    expect(screen.queryByRole('link', { name: /go to settings/i })).toBeNull();
  });
});
