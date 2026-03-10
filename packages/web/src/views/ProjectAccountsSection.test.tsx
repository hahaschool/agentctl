import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAccountsQuery, mockMappingsQuery, mockUpsert, mockRemove, mockToast } = vi.hoisted(
  () => ({
    mockAccountsQuery: vi.fn(),
    mockMappingsQuery: vi.fn(),
    mockUpsert: vi.fn(),
    mockRemove: vi.fn(),
    mockToast: { success: vi.fn(), error: vi.fn() },
  }),
);

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...rest
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={rest['aria-label']}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: Record<string, unknown>) => {
    const { ref: _ref, ...rest } = props;
    return <input {...rest} />;
  },
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
  }) => (
    <div role="listbox" data-testid="select" data-value={value}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children, ...props }: Record<string, unknown>) => (
    <div data-testid="select-trigger" {...(props.id ? { id: props.id as string } : {})}>
      {children as React.ReactNode}
    </div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <div data-testid={`select-item-${value}`}>{children}</div>
  ),
  SelectValue: ({ placeholder }: { children?: React.ReactNode; placeholder?: string }) => (
    <span>{placeholder}</span>
  ),
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className: string }) => (
    <div className={className} data-testid="skeleton" />
  ),
}));

vi.mock('lucide-react', () => ({
  Trash2Icon: ({ className }: { className?: string }) => (
    <span data-testid="trash-icon" className={className} />
  ),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => mockToast,
}));

vi.mock('../lib/queries', () => ({
  accountsQuery: () => mockAccountsQuery(),
  projectAccountsQuery: () => mockMappingsQuery(),
  useUpsertProjectAccount: () => mockUpsert(),
  useDeleteProjectAccount: () => mockRemove(),
}));

import { ProjectAccountsSection } from './ProjectAccountsSection';

const MOCK_ACCOUNTS = [
  {
    id: 'acc-1',
    name: 'Claude Primary',
    provider: 'anthropic_api',
    isActive: true,
    priority: 0,
    credentialMasked: '****',
  },
];

const MOCK_MAPPINGS = [{ id: 'map-1', projectPath: '/home/user/project-a', accountId: 'acc-1' }];

function renderComponent() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectAccountsSection />
    </QueryClientProvider>,
  );
}

describe('ProjectAccountsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockAccountsQuery.mockReturnValue({
      queryKey: ['accounts'],
      queryFn: vi.fn().mockResolvedValue(MOCK_ACCOUNTS),
      initialData: MOCK_ACCOUNTS,
    });

    mockMappingsQuery.mockReturnValue({
      queryKey: ['project-accounts'],
      queryFn: vi.fn().mockResolvedValue(MOCK_MAPPINGS),
      initialData: MOCK_MAPPINGS,
    });

    mockUpsert.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    });

    mockRemove.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    });
  });

  it('renders the "Project access overrides" heading', () => {
    renderComponent();
    const heading = screen.getByText('Project access overrides');
    expect(heading).toBeDefined();
    expect(heading.tagName).toBe('H3');
  });

  it('renders the new explanatory copy', () => {
    renderComponent();
    expect(screen.getByText(/Override the default managed credential/)).toBeDefined();
  });

  it('renders "Managed credential" table header', () => {
    renderComponent();
    expect(screen.getByRole('columnheader', { name: 'Managed credential' })).toBeDefined();
  });

  it('shows the updated empty state copy', () => {
    mockMappingsQuery.mockReturnValue({
      queryKey: ['project-accounts'],
      queryFn: vi.fn().mockResolvedValue([]),
      initialData: [],
    });
    renderComponent();
    expect(screen.getByText('No project-specific access overrides configured.')).toBeDefined();
  });

  it('renders the "Add override" button', () => {
    renderComponent();
    expect(screen.getByText('Add override')).toBeDefined();
  });
});
