import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockAccountsQuery, mockDefaultsQuery, mockUpdateDefaults, mockToast } = vi.hoisted(() => ({
  mockAccountsQuery: vi.fn(),
  mockDefaultsQuery: vi.fn(),
  mockUpdateDefaults: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn() },
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

vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange }: any) => (
    <div data-testid="select" data-value={value}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className: string }) => (
    <div className={className} data-testid="skeleton" />
  ),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => mockToast,
}));

vi.mock('../lib/queries', () => ({
  accountsQuery: () => mockAccountsQuery(),
  accountDefaultsQuery: () => mockDefaultsQuery(),
  useUpdateDefaults: () => mockUpdateDefaults(),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

// ---------------------------------------------------------------------------
// Component import (after mocks)
// ---------------------------------------------------------------------------

import { FailoverSection } from './FailoverSection';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_ACCOUNTS = [
  {
    id: 'acc-1',
    name: 'Primary',
    provider: 'anthropic_api',
    isActive: true,
    priority: 0,
    credentialMasked: '****',
  },
  {
    id: 'acc-2',
    name: 'Backup',
    provider: 'bedrock',
    isActive: true,
    priority: 1,
    credentialMasked: '****',
  },
];

const MOCK_DEFAULTS = { defaultAccountId: 'acc-1', failoverPolicy: 'priority' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderFailover() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <FailoverSection />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FailoverSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: loaded with data
    mockAccountsQuery.mockReturnValue({ queryKey: ['accounts'], queryFn: vi.fn() });
    mockDefaultsQuery.mockReturnValue({ queryKey: ['account-defaults'], queryFn: vi.fn() });
    mockUpdateDefaults.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    });
  });

  // -- Loading state -------------------------------------------------------

  it('shows loading skeletons when accounts are loading', () => {
    mockAccountsQuery.mockReturnValue({
      queryKey: ['accounts'],
      queryFn: () => new Promise(() => {}),
    });
    mockDefaultsQuery.mockReturnValue({
      queryKey: ['account-defaults'],
      queryFn: () => new Promise(() => {}),
    });

    renderFailover();
    const skeletons = screen.getAllByTestId('skeleton');
    expect(skeletons.length).toBeGreaterThanOrEqual(2);
  });

  // -- Heading -------------------------------------------------------------

  it('renders the "Default Account & Failover" heading', () => {
    renderFailover();
    expect(screen.getByText('Default Account & Failover')).toBeDefined();
  });

  it('renders heading as h3 element', () => {
    renderFailover();
    const heading = screen.getByText('Default Account & Failover');
    expect(heading.tagName).toBe('H3');
  });

  // -- Default Account label -----------------------------------------------

  it('renders "Default Account" label when loaded', async () => {
    // Return data immediately via initialData-style queryFn
    mockAccountsQuery.mockReturnValue({
      queryKey: ['accounts'],
      queryFn: () => Promise.resolve(MOCK_ACCOUNTS),
      initialData: MOCK_ACCOUNTS,
    });
    mockDefaultsQuery.mockReturnValue({
      queryKey: ['account-defaults'],
      queryFn: () => Promise.resolve(MOCK_DEFAULTS),
      initialData: MOCK_DEFAULTS,
    });

    renderFailover();
    expect(screen.getByText('Default Account')).toBeDefined();
  });

  // -- Account items in select ---------------------------------------------

  it('renders account options when data is loaded', () => {
    mockAccountsQuery.mockReturnValue({
      queryKey: ['accounts'],
      queryFn: () => Promise.resolve(MOCK_ACCOUNTS),
      initialData: MOCK_ACCOUNTS,
    });
    mockDefaultsQuery.mockReturnValue({
      queryKey: ['account-defaults'],
      queryFn: () => Promise.resolve(MOCK_DEFAULTS),
      initialData: MOCK_DEFAULTS,
    });

    renderFailover();
    expect(screen.getByText('Primary (anthropic_api)')).toBeDefined();
    expect(screen.getByText('Backup (bedrock)')).toBeDefined();
  });

  it('renders "No default" option', () => {
    mockAccountsQuery.mockReturnValue({
      queryKey: ['accounts'],
      queryFn: () => Promise.resolve(MOCK_ACCOUNTS),
      initialData: MOCK_ACCOUNTS,
    });
    mockDefaultsQuery.mockReturnValue({
      queryKey: ['account-defaults'],
      queryFn: () => Promise.resolve(MOCK_DEFAULTS),
      initialData: MOCK_DEFAULTS,
    });

    renderFailover();
    expect(screen.getByText('No default')).toBeDefined();
  });

  // -- Failover policy buttons ---------------------------------------------

  it('renders all three failover policy buttons', () => {
    mockAccountsQuery.mockReturnValue({
      queryKey: ['accounts'],
      queryFn: () => Promise.resolve(MOCK_ACCOUNTS),
      initialData: MOCK_ACCOUNTS,
    });
    mockDefaultsQuery.mockReturnValue({
      queryKey: ['account-defaults'],
      queryFn: () => Promise.resolve(MOCK_DEFAULTS),
      initialData: MOCK_DEFAULTS,
    });

    renderFailover();
    expect(screen.getByText('None')).toBeDefined();
    expect(screen.getByText('Priority')).toBeDefined();
    expect(screen.getByText('Round Robin')).toBeDefined();
  });

  it('shows "Use assigned account only" description for None policy', () => {
    mockAccountsQuery.mockReturnValue({
      queryKey: ['accounts'],
      queryFn: () => Promise.resolve(MOCK_ACCOUNTS),
      initialData: MOCK_ACCOUNTS,
    });
    mockDefaultsQuery.mockReturnValue({
      queryKey: ['account-defaults'],
      queryFn: () => Promise.resolve(MOCK_DEFAULTS),
      initialData: MOCK_DEFAULTS,
    });

    renderFailover();
    expect(screen.getByText('Use assigned account only')).toBeDefined();
  });

  it('shows "Try next active account by priority on rate limit" description for Priority policy', () => {
    mockAccountsQuery.mockReturnValue({
      queryKey: ['accounts'],
      queryFn: () => Promise.resolve(MOCK_ACCOUNTS),
      initialData: MOCK_ACCOUNTS,
    });
    mockDefaultsQuery.mockReturnValue({
      queryKey: ['account-defaults'],
      queryFn: () => Promise.resolve(MOCK_DEFAULTS),
      initialData: MOCK_DEFAULTS,
    });

    renderFailover();
    expect(screen.getByText('Try next active account by priority on rate limit')).toBeDefined();
  });

  it('shows "Distribute across all active accounts" description for Round Robin policy', () => {
    mockAccountsQuery.mockReturnValue({
      queryKey: ['accounts'],
      queryFn: () => Promise.resolve(MOCK_ACCOUNTS),
      initialData: MOCK_ACCOUNTS,
    });
    mockDefaultsQuery.mockReturnValue({
      queryKey: ['account-defaults'],
      queryFn: () => Promise.resolve(MOCK_DEFAULTS),
      initialData: MOCK_DEFAULTS,
    });

    renderFailover();
    expect(screen.getByText('Distribute across all active accounts')).toBeDefined();
  });

  // -- Active policy styling -----------------------------------------------

  it('applies active styling to the current failover policy button', () => {
    mockAccountsQuery.mockReturnValue({
      queryKey: ['accounts'],
      queryFn: () => Promise.resolve(MOCK_ACCOUNTS),
      initialData: MOCK_ACCOUNTS,
    });
    mockDefaultsQuery.mockReturnValue({
      queryKey: ['account-defaults'],
      queryFn: () => Promise.resolve(MOCK_DEFAULTS),
      initialData: MOCK_DEFAULTS,
    });

    renderFailover();
    // "Priority" is the active policy
    const priorityButton = screen.getByText('Priority').closest('button');
    expect(priorityButton?.className).toContain('bg-primary/90');
  });

  it('applies inactive styling to non-selected policy buttons', () => {
    mockAccountsQuery.mockReturnValue({
      queryKey: ['accounts'],
      queryFn: () => Promise.resolve(MOCK_ACCOUNTS),
      initialData: MOCK_ACCOUNTS,
    });
    mockDefaultsQuery.mockReturnValue({
      queryKey: ['account-defaults'],
      queryFn: () => Promise.resolve(MOCK_DEFAULTS),
      initialData: MOCK_DEFAULTS,
    });

    renderFailover();
    const noneButton = screen.getByText('None').closest('button');
    expect(noneButton?.className).toContain('bg-transparent');
  });

  // -- Failover Policy label -----------------------------------------------

  it('renders "Failover Policy" label', () => {
    mockAccountsQuery.mockReturnValue({
      queryKey: ['accounts'],
      queryFn: () => Promise.resolve(MOCK_ACCOUNTS),
      initialData: MOCK_ACCOUNTS,
    });
    mockDefaultsQuery.mockReturnValue({
      queryKey: ['account-defaults'],
      queryFn: () => Promise.resolve(MOCK_DEFAULTS),
      initialData: MOCK_DEFAULTS,
    });

    renderFailover();
    expect(screen.getByText('Failover Policy')).toBeDefined();
  });

  // -- Saving state --------------------------------------------------------

  it('shows "Saving..." text when mutation is pending', () => {
    mockAccountsQuery.mockReturnValue({
      queryKey: ['accounts'],
      queryFn: () => Promise.resolve(MOCK_ACCOUNTS),
      initialData: MOCK_ACCOUNTS,
    });
    mockDefaultsQuery.mockReturnValue({
      queryKey: ['account-defaults'],
      queryFn: () => Promise.resolve(MOCK_DEFAULTS),
      initialData: MOCK_DEFAULTS,
    });
    mockUpdateDefaults.mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
      isError: false,
      error: null,
    });

    renderFailover();
    expect(screen.getByText('Saving...')).toBeDefined();
  });

  // -- Error state ---------------------------------------------------------

  it('shows error message when mutation fails', () => {
    mockAccountsQuery.mockReturnValue({
      queryKey: ['accounts'],
      queryFn: () => Promise.resolve(MOCK_ACCOUNTS),
      initialData: MOCK_ACCOUNTS,
    });
    mockDefaultsQuery.mockReturnValue({
      queryKey: ['account-defaults'],
      queryFn: () => Promise.resolve(MOCK_DEFAULTS),
      initialData: MOCK_DEFAULTS,
    });
    mockUpdateDefaults.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: { message: 'Network error' },
    });

    renderFailover();
    expect(screen.getByText('Failed to save: Network error')).toBeDefined();
  });

  it('does not show "Saving..." when mutation is not pending', () => {
    mockAccountsQuery.mockReturnValue({
      queryKey: ['accounts'],
      queryFn: () => Promise.resolve(MOCK_ACCOUNTS),
      initialData: MOCK_ACCOUNTS,
    });
    mockDefaultsQuery.mockReturnValue({
      queryKey: ['account-defaults'],
      queryFn: () => Promise.resolve(MOCK_DEFAULTS),
      initialData: MOCK_DEFAULTS,
    });

    renderFailover();
    expect(screen.queryByText('Saving...')).toBeNull();
  });
});
