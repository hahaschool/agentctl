import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockVersionCompatQuery } = vi.hoisted(() => ({
  mockVersionCompatQuery: vi.fn(),
}));

vi.mock('@/lib/queries', () => ({
  versionCompatQuery: () => mockVersionCompatQuery(),
}));

vi.mock('lucide-react', () => ({
  AlertTriangle: (props: Record<string, unknown>) => (
    <svg data-testid="icon-alert-triangle" {...props} />
  ),
  ArrowUpCircle: (props: Record<string, unknown>) => (
    <svg data-testid="icon-arrow-up-circle" {...props} />
  ),
}));

// ---------------------------------------------------------------------------
// Component import — AFTER mocks
// ---------------------------------------------------------------------------

import { VersionCompatBanner } from './VersionCompatBanner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderWithQueryClient(ui: React.ReactElement): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function buildPayload(
  overrides: Partial<{
    appVersion: string;
    gitSha: string;
    schemaVersion: number;
    minSupportedMobileBuild: number;
    minSupportedWebBuild: number;
  }> = {},
): {
  appVersion: string;
  gitSha: string;
  schemaVersion: number;
  minSupportedMobileBuild: number;
  minSupportedWebBuild: number;
} {
  return {
    appVersion: 'v0.4.0',
    gitSha: 'abc1234',
    schemaVersion: 26,
    minSupportedMobileBuild: 0,
    minSupportedWebBuild: 0,
    ...overrides,
  };
}

describe('VersionCompatBanner', () => {
  it('renders nothing when there is no query data yet', () => {
    mockVersionCompatQuery.mockReturnValue({
      queryKey: ['version-compat'],
      queryFn: () => new Promise(() => {}),
    });
    const { container } = renderWithQueryClient(<VersionCompatBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when client build + version match the server', () => {
    const payload = buildPayload({ appVersion: 'v0.4.0', minSupportedWebBuild: 10 });
    mockVersionCompatQuery.mockReturnValue({
      queryKey: ['version-compat'],
      queryFn: () => Promise.resolve(payload),
    });
    const { container } = renderWithQueryClient(
      <VersionCompatBanner clientBuild={10} clientVersion="v0.4.0" />,
    );
    // Wait for the resolved data. Because retry is disabled and the promise
    // resolves synchronously-ish, we poll the DOM for the absence of both
    // banner variants.
    // If no banner is rendered, the container is empty.
    return Promise.resolve().then(() => {
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(container.querySelector('[role="status"]')).toBeNull();
    });
  });

  it('renders a hard update alert when client build is below minSupportedWebBuild', async () => {
    const payload = buildPayload({ minSupportedWebBuild: 42 });
    mockVersionCompatQuery.mockReturnValue({
      queryKey: ['version-compat'],
      queryFn: () => Promise.resolve(payload),
    });
    renderWithQueryClient(<VersionCompatBanner clientBuild={10} clientVersion="v0.4.0" />);
    const banner = await screen.findByTestId('version-compat-banner-blocked');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain('build 42 expected');
    expect(banner.textContent).toContain('build 10 running');
  });

  it('renders a soft update hint when server appVersion is ahead of the client', async () => {
    const payload = buildPayload({
      appVersion: 'v0.5.0',
      minSupportedWebBuild: 0,
    });
    mockVersionCompatQuery.mockReturnValue({
      queryKey: ['version-compat'],
      queryFn: () => Promise.resolve(payload),
    });
    renderWithQueryClient(<VersionCompatBanner clientBuild={0} clientVersion="v0.4.0" />);
    const banner = await screen.findByTestId('version-compat-banner-hint');
    // `<output>` has an implicit role="status" per HTML spec — keep assertion
    // resilient to either the explicit attribute or the implicit one via
    // `getByRole`.
    expect(screen.getByRole('status')).toBe(banner);
    expect(banner.textContent).toContain('v0.5.0');
    expect(banner.textContent).toContain('v0.4.0');
  });

  it('does NOT render the hard alert when build floor is 0 (disabled)', async () => {
    const payload = buildPayload({
      appVersion: 'v0.4.0',
      minSupportedWebBuild: 0,
    });
    mockVersionCompatQuery.mockReturnValue({
      queryKey: ['version-compat'],
      queryFn: () => Promise.resolve(payload),
    });
    const { container } = renderWithQueryClient(
      <VersionCompatBanner clientBuild={0} clientVersion="v0.4.0" />,
    );
    // Flush the promise and re-check.
    await Promise.resolve();
    expect(container.querySelector('[data-testid="version-compat-banner-blocked"]')).toBeNull();
  });
});
