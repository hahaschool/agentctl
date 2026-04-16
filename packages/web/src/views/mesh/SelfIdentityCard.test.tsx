import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SelfIdentityCard } from './SelfIdentityCard';

vi.mock('@/lib/queries', () => ({
  meshConfigQuery: () => ({
    queryKey: ['mesh-config'],
    queryFn: () => Promise.resolve(null),
  }),
}));

function renderWithConfig(config: Record<string, unknown> | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (config) {
    client.setQueryData(['mesh-config'], config);
  }
  return render(
    <QueryClientProvider client={client}>
      <SelfIdentityCard />
    </QueryClientProvider>,
  );
}

const FULL_CONFIG = {
  machineId: 'machine-1',
  hostname: 'test-host',
  tailscaleIp: '100.64.0.5',
  tailscaleIpSource: 'auto-detect',
  syncUrl: 'http://100.64.0.5:8080',
  syncUrlSource: 'derived',
  registrationTokenConfigured: true,
  registrationTokenSource: 'env',
  publicKey: 'abcdef1234567890abcdef1234567890',
};

describe('SelfIdentityCard', () => {
  it('renders config fields', () => {
    renderWithConfig(FULL_CONFIG);
    expect(screen.getByTestId('self-identity-card')).toBeInTheDocument();
    expect(screen.getByText('machine-1')).toBeInTheDocument();
    expect(screen.getByText('test-host')).toBeInTheDocument();
    expect(screen.getByText('100.64.0.5')).toBeInTheDocument();
    expect(screen.getByText('Configured')).toBeInTheDocument();
  });

  it('shows "Not set" when token is not configured', () => {
    renderWithConfig({
      ...FULL_CONFIG,
      registrationTokenConfigured: false,
      registrationTokenSource: null,
    });
    expect(screen.getByText('Not set')).toBeInTheDocument();
  });

  it('truncates long public keys', () => {
    renderWithConfig(FULL_CONFIG);
    // 32-char key should be truncated to "abcdef12…34567890"
    expect(screen.getByText('abcdef12…34567890')).toBeInTheDocument();
  });

  it('shows source badges', () => {
    renderWithConfig(FULL_CONFIG);
    expect(screen.getByText('auto-detect')).toBeInTheDocument();
    expect(screen.getByText('derived')).toBeInTheDocument();
    expect(screen.getByText('env')).toBeInTheDocument();
  });

  it('links to settings', () => {
    renderWithConfig(FULL_CONFIG);
    const link = screen.getByText('Settings').closest('a');
    expect(link).toHaveAttribute('href', '/settings#mesh-identity');
  });
});
