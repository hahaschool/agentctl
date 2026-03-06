import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockAccountsQuery, mockMappingsQuery, mockUpsert, mockRemove, mockToast } = vi.hoisted(
  () => ({
    mockAccountsQuery: vi.fn(),
    mockMappingsQuery: vi.fn(),
    mockUpsert: vi.fn(),
    mockRemove: vi.fn(),
    mockToast: { success: vi.fn(), error: vi.fn() },
  }),
);

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
  Input: (props: any) => {
    const { ref: _ref, ...rest } = props;
    return <input {...rest} />;
  },
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
  }) => (
    <div data-testid="select" data-value={value} onClick={() => onValueChange?.('')}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children, ...props }: any) => (
    <div data-testid="select-trigger" {...(props.id ? { id: props.id } : {})}>
      {children}
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

// ---------------------------------------------------------------------------
// Component import (after mocks)
// ---------------------------------------------------------------------------

import { ProjectAccountsSection } from './ProjectAccountsSection';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_ACCOUNTS = [
  {
    id: 'acc-1',
    name: 'Primary Key',
    provider: 'anthropic_api',
    isActive: true,
    priority: 0,
    credentialMasked: '****',
  },
  {
    id: 'acc-2',
    name: 'Backup Key',
    provider: 'bedrock',
    isActive: true,
    priority: 1,
    credentialMasked: '****',
  },
];

const MOCK_MAPPINGS = [
  { id: 'map-1', projectPath: '/home/user/project-a', accountId: 'acc-1' },
  { id: 'map-2', projectPath: '/home/user/project-b', accountId: 'acc-2' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProjectAccountsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockAccountsQuery.mockReturnValue({
      queryKey: ['accounts'],
      queryFn: vi.fn().mockResolvedValue(MOCK_ACCOUNTS),
    });

    mockMappingsQuery.mockReturnValue({
      queryKey: ['project-accounts'],
      queryFn: vi.fn().mockResolvedValue(MOCK_MAPPINGS),
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

  // -------------------------------------------------------------------------
  // Heading
  // -------------------------------------------------------------------------

  it('renders "Project Account Overrides" heading', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText('Project Account Overrides')).toBeDefined();
    });
    const heading = screen.getByText('Project Account Overrides');
    expect(heading.tagName).toBe('H3');
  });

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  it('shows loading skeletons when data is loading', () => {
    mockAccountsQuery.mockReturnValue({
      queryKey: ['accounts'],
      queryFn: () => new Promise(() => {}), // never resolves
    });
    mockMappingsQuery.mockReturnValue({
      queryKey: ['project-accounts'],
      queryFn: () => new Promise(() => {}),
    });

    renderComponent();
    const skeletons = screen.getAllByTestId('skeleton');
    expect(skeletons.length).toBeGreaterThanOrEqual(2);
  });

  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------

  it('shows empty state when no mappings exist', async () => {
    mockMappingsQuery.mockReturnValue({
      queryKey: ['project-accounts'],
      queryFn: vi.fn().mockResolvedValue([]),
    });

    renderComponent();
    await waitFor(() => {
      expect(screen.getByText('No project-specific account mappings configured.')).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Table rendering
  // -------------------------------------------------------------------------

  it('renders mapping table with "Project Path" and "Account" column headers', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText('Project Path')).toBeDefined();
    });
    // "Account" appears both as table header and form label
    const accountElements = screen.getAllByText('Account');
    expect(accountElements.length).toBeGreaterThanOrEqual(1);
    // The first one is the table header (th)
    expect(accountElements[0].tagName).toBe('TH');
  });

  it('shows project paths in table rows', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText('/home/user/project-a')).toBeDefined();
    });
    expect(screen.getByText('/home/user/project-b')).toBeDefined();
  });

  it('shows resolved account names with provider in parentheses', async () => {
    renderComponent();
    // Wait for mappings to load first (table appears)
    await waitFor(() => {
      expect(screen.getByText('/home/user/project-a')).toBeDefined();
    });
    // accountName() resolves acc-1 → "Primary Key (anthropic_api)"
    // The text is in a <td> as a single text node
    const cells = document.querySelectorAll('td');
    const cellTexts = Array.from(cells).map((c) => c.textContent);
    expect(cellTexts).toContain('Primary Key (anthropic_api)');
    expect(cellTexts).toContain('Backup Key (bedrock)');
  });

  it('shows delete button for each mapping with aria-label', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByLabelText('Remove mapping for /home/user/project-a')).toBeDefined();
    });
    expect(screen.getByLabelText('Remove mapping for /home/user/project-b')).toBeDefined();
  });

  it('renders trash icons for delete buttons', async () => {
    renderComponent();
    await waitFor(() => {
      const icons = screen.getAllByTestId('trash-icon');
      expect(icons.length).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Add form
  // -------------------------------------------------------------------------

  it('renders the Add form section', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText('Add')).toBeDefined();
    });
  });

  it('shows "Project path" label', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText('Project path')).toBeDefined();
    });
  });

  it('shows "Account" label in the add form', async () => {
    renderComponent();
    await waitFor(() => {
      const accountElements = screen.getAllByText('Account');
      // The second "Account" text is the form label
      const formLabel = accountElements.find((el) => el.tagName === 'LABEL');
      expect(formLabel).toBeDefined();
    });
  });

  it('has project path input with placeholder "my-project"', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByPlaceholderText('my-project')).toBeDefined();
    });
  });

  it('has "Add" button', async () => {
    renderComponent();
    await waitFor(() => {
      const addButton = screen.getByText('Add');
      expect(addButton.tagName).toBe('BUTTON');
    });
  });

  it('Add button is disabled when path is empty', async () => {
    renderComponent();
    await waitFor(() => {
      const addButton = screen.getByText('Add');
      expect(addButton).toBeDefined();
    });
    const addButton = screen.getByText('Add') as HTMLButtonElement;
    expect(addButton.disabled).toBe(true);
  });

  it('Add button is disabled when no account is selected', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByPlaceholderText('my-project')).toBeDefined();
    });

    // Type something in the input
    fireEvent.change(screen.getByPlaceholderText('my-project'), {
      target: { value: '/some/path' },
    });

    // No account selected → still disabled
    const addButton = screen.getByText('Add') as HTMLButtonElement;
    expect(addButton.disabled).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Deleted account display
  // -------------------------------------------------------------------------

  it('shows "Deleted (acc-xxx...)" for mappings referencing deleted accounts', async () => {
    mockMappingsQuery.mockReturnValue({
      queryKey: ['project-accounts'],
      queryFn: vi
        .fn()
        .mockResolvedValue([
          { id: 'map-3', projectPath: '/home/user/orphan', accountId: 'acc-deleted-99' },
        ]),
    });

    renderComponent();
    await waitFor(() => {
      expect(screen.getByText('Deleted (acc-dele...)')).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Error states
  // -------------------------------------------------------------------------

  it('shows upsert error message when upsert fails', async () => {
    mockUpsert.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: { message: 'Network error' },
    });

    renderComponent();
    await waitFor(() => {
      expect(screen.getByText('Failed to save mapping: Network error')).toBeDefined();
    });
  });

  it('shows remove error message when delete fails', async () => {
    mockRemove.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: { message: 'Server error' },
    });

    renderComponent();
    await waitFor(() => {
      expect(screen.getByText('Failed to remove mapping: Server error')).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Pending state
  // -------------------------------------------------------------------------

  it('shows "Saving..." text when upsert is pending', async () => {
    mockUpsert.mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
      isError: false,
      error: null,
    });

    renderComponent();
    await waitFor(() => {
      expect(screen.getByText('Saving...')).toBeDefined();
    });
  });

  it('disables delete buttons when remove is pending', async () => {
    mockRemove.mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
      isError: false,
      error: null,
    });

    renderComponent();
    await waitFor(() => {
      const deleteBtn = screen.getByLabelText(
        'Remove mapping for /home/user/project-a',
      ) as HTMLButtonElement;
      expect(deleteBtn.disabled).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Select account dropdown items
  // -------------------------------------------------------------------------

  it('renders account options in the select dropdown', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByTestId('select-item-acc-1')).toBeDefined();
      expect(screen.getByTestId('select-item-acc-2')).toBeDefined();
    });
  });
});
