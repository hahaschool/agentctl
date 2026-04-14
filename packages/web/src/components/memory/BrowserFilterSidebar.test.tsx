import { fireEvent, render, screen } from '@testing-library/react';

import { BrowserFilterSidebar, type BrowserFilters, INITIAL_FILTERS } from './BrowserFilterSidebar';

describe('BrowserFilterSidebar', () => {
  const onFiltersChange = vi.fn();

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders search input, scope select, entity type chips, and confidence slider', () => {
    render(<BrowserFilterSidebar filters={INITIAL_FILTERS} onFiltersChange={onFiltersChange} />);

    expect(screen.getByLabelText('Search facts')).toBeDefined();
    expect(screen.getByLabelText('Scope filter')).toBeDefined();
    expect(screen.getByLabelText('Minimum confidence')).toBeDefined();
    expect(screen.getByLabelText('Session ID filter')).toBeDefined();
    expect(screen.getByLabelText('Agent ID filter')).toBeDefined();
    expect(screen.getByLabelText('Machine ID filter')).toBeDefined();
    expect(screen.getByRole('button', { name: /toggle entity type: decision/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /toggle entity type: pattern/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /toggle entity type: error/i })).toBeDefined();
    expect(screen.getByText('0%')).toBeDefined();
  });

  it('calls onFiltersChange when search input changes', () => {
    render(<BrowserFilterSidebar filters={INITIAL_FILTERS} onFiltersChange={onFiltersChange} />);

    fireEvent.change(screen.getByLabelText('Search facts'), { target: { value: 'memory' } });

    expect(onFiltersChange).toHaveBeenCalledWith({
      ...INITIAL_FILTERS,
      q: 'memory',
    });
  });

  it('calls onFiltersChange when scope changes', () => {
    render(<BrowserFilterSidebar filters={INITIAL_FILTERS} onFiltersChange={onFiltersChange} />);

    fireEvent.change(screen.getByLabelText('Scope filter'), { target: { value: 'global' } });

    expect(onFiltersChange).toHaveBeenCalledWith({
      ...INITIAL_FILTERS,
      scope: 'global',
    });
  });

  it('toggles entity type chip', () => {
    render(<BrowserFilterSidebar filters={INITIAL_FILTERS} onFiltersChange={onFiltersChange} />);

    fireEvent.click(screen.getByRole('button', { name: /toggle entity type: decision/i }));

    expect(onFiltersChange).toHaveBeenCalledWith({
      ...INITIAL_FILTERS,
      entityTypes: ['decision'],
    });
  });

  it('removes entity type when already selected', () => {
    const filters: BrowserFilters = { ...INITIAL_FILTERS, entityTypes: ['decision', 'pattern'] };
    render(<BrowserFilterSidebar filters={filters} onFiltersChange={onFiltersChange} />);

    fireEvent.click(screen.getByRole('button', { name: /toggle entity type: decision/i }));

    expect(onFiltersChange).toHaveBeenCalledWith({
      ...filters,
      entityTypes: ['pattern'],
    });
  });

  it('shows current confidence percentage next to the slider label', () => {
    const filters: BrowserFilters = { ...INITIAL_FILTERS, minConfidence: 0.65 };
    render(<BrowserFilterSidebar filters={filters} onFiltersChange={onFiltersChange} />);

    expect(screen.getByText('65%')).toBeDefined();
  });

  it('calls onFiltersChange when provenance filters change', () => {
    render(<BrowserFilterSidebar filters={INITIAL_FILTERS} onFiltersChange={onFiltersChange} />);

    fireEvent.change(screen.getByLabelText('Session ID filter'), {
      target: { value: 'session-1' },
    });
    fireEvent.change(screen.getByLabelText('Agent ID filter'), { target: { value: 'agent-1' } });
    fireEvent.change(screen.getByLabelText('Machine ID filter'), {
      target: { value: 'machine-1' },
    });

    expect(onFiltersChange).toHaveBeenNthCalledWith(1, {
      ...INITIAL_FILTERS,
      sessionId: 'session-1',
    });
    expect(onFiltersChange).toHaveBeenNthCalledWith(2, {
      ...INITIAL_FILTERS,
      agentId: 'agent-1',
    });
    expect(onFiltersChange).toHaveBeenNthCalledWith(3, {
      ...INITIAL_FILTERS,
      machineId: 'machine-1',
    });
  });

  it('shows clear filters button when filters are active', () => {
    const filters: BrowserFilters = { ...INITIAL_FILTERS, scope: 'global' };
    render(<BrowserFilterSidebar filters={filters} onFiltersChange={onFiltersChange} />);

    expect(screen.getByText('Clear filters')).toBeDefined();
  });

  it('does not show clear button when no filters are active', () => {
    render(<BrowserFilterSidebar filters={INITIAL_FILTERS} onFiltersChange={onFiltersChange} />);

    expect(screen.queryByText('Clear filters')).toBeNull();
  });

  it('resets all filters when clear is clicked', () => {
    const filters: BrowserFilters = {
      q: 'test',
      scope: 'global',
      entityTypes: ['decision'],
      minConfidence: 0.5,
      sessionId: 'session-1',
      agentId: 'agent-1',
      machineId: 'machine-1',
    };
    render(<BrowserFilterSidebar filters={filters} onFiltersChange={onFiltersChange} />);

    fireEvent.click(screen.getByText('Clear filters'));

    expect(onFiltersChange).toHaveBeenCalledWith(INITIAL_FILTERS);
  });
});
