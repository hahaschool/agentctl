import type { MemoryScopeRecord } from '@agentctl/shared';
import type React from 'react';

const mockUseQuery = vi.fn();
const mockUseCreateScope = vi.fn();
const mockUseRenameScope = vi.fn();
const mockUseDeleteScope = vi.fn();
const mockUsePromoteScope = vi.fn();
const mockUseMergeScopes = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  queryOptions: (opts: unknown) => opts,
  useMutation: vi.fn(),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));

vi.mock('@/lib/queries', () => ({
  memoryScopesQuery: () => ({ queryKey: ['memory', 'scopes'], queryFn: vi.fn() }),
  useCreateScope: () => mockUseCreateScope(),
  useRenameScope: () => mockUseRenameScope(),
  useDeleteScope: () => mockUseDeleteScope(),
  usePromoteScope: () => mockUsePromoteScope(),
  useMergeScopes: () => mockUseMergeScopes(),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// Minimal UI mocks
vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div data-testid="card">{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card-header">{children}</div>
  ),
  CardTitle: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card-title">{children}</div>
  ),
  CardContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card-content">{children}</div>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, type, ...props }: React.ComponentProps<'button'>) => (
    <button type={type ?? 'button'} onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <span data-testid="badge" className={className}>
      {children}
    </span>
  ),
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
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
    <div data-testid="select" data-value={value}>
      <button type="button" onClick={() => onValueChange?.('agent')}>
        {value ?? 'select'}
      </button>
      {children}
    </div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({
    children,
    value,
    onClick,
  }: {
    children: React.ReactNode;
    value: string;
    onClick?: () => void;
  }) => (
    <button type="button" data-value={value} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    children,
    open,
  }: {
    children: React.ReactNode;
    open?: boolean;
    onOpenChange?: (v: boolean) => void;
  }) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({
    children,
    open,
  }: {
    children: React.ReactNode;
    open?: boolean;
    onOpenChange?: (v: boolean) => void;
  }) => (open ? <div data-testid="alert-dialog">{children}</div> : null),
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="alert-dialog-content">{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-menu">{children}</div>
  ),
  DropdownMenuTrigger: ({
    children,
    asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => (
    <div data-testid="dropdown-trigger">
      {asChild ? children : <button type="button">{children}</button>}
    </div>
  ),
  DropdownMenuContent: ({ children, align }: { children: React.ReactNode; align?: string }) => (
    <div data-testid="dropdown-content" data-align={align}>
      {children}
    </div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

import { fireEvent, render, screen } from '@testing-library/react';

import { MemoryScopeManagerView } from './MemoryScopeManagerView';

function makeScope(overrides: Partial<MemoryScopeRecord> = {}): MemoryScopeRecord {
  return {
    id: 'global',
    name: 'global',
    type: 'global',
    parentId: null,
    factCount: 0,
    createdAt: '2026-03-11T10:00:00.000Z',
    ...overrides,
  };
}

function noopMutation() {
  return {
    mutate: vi.fn(),
    isPending: false,
    error: null,
  };
}

describe('MemoryScopeManagerView', () => {
  beforeEach(() => {
    mockUseCreateScope.mockReturnValue(noopMutation());
    mockUseRenameScope.mockReturnValue(noopMutation());
    mockUseDeleteScope.mockReturnValue(noopMutation());
    mockUsePromoteScope.mockReturnValue(noopMutation());
    mockUseMergeScopes.mockReturnValue(noopMutation());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  it('shows loading skeleton when data is loading', () => {
    mockUseQuery.mockReturnValue({ data: null, isLoading: true, error: null });

    render(<MemoryScopeManagerView />);

    expect(screen.getByTestId('scopes-loading')).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------

  it('shows empty state when no scopes are present', () => {
    mockUseQuery.mockReturnValue({ data: { ok: true, scopes: [] }, isLoading: false, error: null });

    render(<MemoryScopeManagerView />);

    expect(screen.getByTestId('scopes-empty')).toBeDefined();
    expect(screen.getByText('No memory scopes found.')).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Tree rendering
  // ---------------------------------------------------------------------------

  it('renders the scope tree with global and child scopes', () => {
    const scopes: MemoryScopeRecord[] = [
      makeScope({ id: 'global', name: 'global', type: 'global', parentId: null, factCount: 5 }),
      makeScope({
        id: 'project:agentctl',
        name: 'agentctl',
        type: 'project',
        parentId: 'global',
        factCount: 12,
      }),
      makeScope({
        id: 'agent:worker-1',
        name: 'worker-1',
        type: 'agent',
        parentId: 'global',
        factCount: 3,
      }),
    ];

    mockUseQuery.mockReturnValue({ data: { ok: true, scopes }, isLoading: false, error: null });

    render(<MemoryScopeManagerView />);

    expect(screen.getByTestId('scope-tree')).toBeDefined();
    // scope names are in font-mono spans; getAllByText returns all matching elements
    expect(screen.getAllByText('global').length).toBeGreaterThan(0);
    expect(screen.getByText('agentctl')).toBeDefined();
    expect(screen.getByText('worker-1')).toBeDefined();
  });

  it('renders fact counts for each scope', () => {
    const scopes: MemoryScopeRecord[] = [
      makeScope({ id: 'global', name: 'global', type: 'global', factCount: 5 }),
      makeScope({
        id: 'project:test',
        name: 'test',
        type: 'project',
        parentId: 'global',
        factCount: 1,
      }),
    ];
    mockUseQuery.mockReturnValue({ data: { ok: true, scopes }, isLoading: false, error: null });

    render(<MemoryScopeManagerView />);

    expect(screen.getByText('5 facts')).toBeDefined();
    expect(screen.getByText('1 fact')).toBeDefined();
  });

  it('renders type badges for scopes', () => {
    const scopes: MemoryScopeRecord[] = [
      makeScope({ id: 'global', name: 'global', type: 'global', factCount: 0 }),
      makeScope({
        id: 'project:demo',
        name: 'demo',
        type: 'project',
        parentId: 'global',
        factCount: 0,
      }),
    ];
    mockUseQuery.mockReturnValue({ data: { ok: true, scopes }, isLoading: false, error: null });

    render(<MemoryScopeManagerView />);

    const badges = screen.getAllByTestId('badge');
    const badgeTexts = badges.map((b) => b.textContent ?? '');
    expect(badgeTexts.some((t) => t.includes('global'))).toBe(true);
    expect(badgeTexts.some((t) => t.includes('project'))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Expand / collapse
  // ---------------------------------------------------------------------------

  it('collapses child scopes when toggle is clicked', () => {
    // Only provide global with one child so there's only one Collapse button
    const scopes: MemoryScopeRecord[] = [
      makeScope({ id: 'global', name: 'global', type: 'global', parentId: null, factCount: 0 }),
      makeScope({
        id: 'project:uniquechild',
        name: 'uniquechild',
        type: 'project',
        parentId: 'global',
        factCount: 0,
      }),
    ];
    mockUseQuery.mockReturnValue({ data: { ok: true, scopes }, isLoading: false, error: null });

    render(<MemoryScopeManagerView />);

    // child is visible initially
    expect(screen.getByText('uniquechild')).toBeDefined();

    // click the toggle on the global node — it's the only Collapse button
    const toggles = screen.getAllByRole('button', { name: 'Collapse' });
    fireEvent.click(toggles[0] as HTMLElement);

    // child should no longer be visible
    expect(screen.queryByText('uniquechild')).toBeNull();
  });

  it('expands child scopes when toggle is clicked again', () => {
    const scopes: MemoryScopeRecord[] = [
      makeScope({ id: 'global', name: 'global', type: 'global', parentId: null }),
      makeScope({
        id: 'project:expandchild',
        name: 'expandchild',
        type: 'project',
        parentId: 'global',
      }),
    ];
    mockUseQuery.mockReturnValue({ data: { ok: true, scopes }, isLoading: false, error: null });

    render(<MemoryScopeManagerView />);

    const toggles = screen.getAllByRole('button', { name: 'Collapse' });
    fireEvent.click(toggles[0] as HTMLElement); // collapse
    fireEvent.click(toggles[0] as HTMLElement); // expand
    expect(screen.getByText('expandchild')).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Create scope dialog
  // ---------------------------------------------------------------------------

  it('opens create scope dialog when New Scope button is clicked', () => {
    mockUseQuery.mockReturnValue({ data: { ok: true, scopes: [] }, isLoading: false, error: null });

    render(<MemoryScopeManagerView />);

    const newButton = screen.getByRole('button', { name: /new scope/i });
    fireEvent.click(newButton);

    expect(screen.getByTestId('dialog')).toBeDefined();
    expect(screen.getByText('Create Memory Scope')).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Delete confirmation
  // ---------------------------------------------------------------------------

  it('shows delete confirmation dialog when delete is triggered', () => {
    const scopes: MemoryScopeRecord[] = [
      makeScope({
        id: 'project:to-delete',
        name: 'to-delete',
        type: 'project',
        parentId: 'global',
        factCount: 2,
      }),
      makeScope({ id: 'global', name: 'global', type: 'global', parentId: null }),
    ];
    mockUseQuery.mockReturnValue({ data: { ok: true, scopes }, isLoading: false, error: null });

    render(<MemoryScopeManagerView />);

    // Find and click the delete menu item (visible in dropdown content)
    const deleteButton = screen.getByRole('button', { name: /delete scope/i });
    fireEvent.click(deleteButton);

    expect(screen.getByTestId('alert-dialog')).toBeDefined();
    expect(screen.getByText('Delete Scope')).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Error state
  // ---------------------------------------------------------------------------

  it('shows error message when query fails', () => {
    mockUseQuery.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('Network error'),
    });

    render(<MemoryScopeManagerView />);

    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText('Failed to load scopes. Please try again.')).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Header
  // ---------------------------------------------------------------------------

  it('renders the page heading', () => {
    mockUseQuery.mockReturnValue({ data: { ok: true, scopes: [] }, isLoading: false, error: null });

    render(<MemoryScopeManagerView />);

    expect(screen.getByText('Memory Scopes')).toBeDefined();
    expect(
      screen.getByText('Manage the scope hierarchy used to organise memory facts.'),
    ).toBeDefined();
  });
});
