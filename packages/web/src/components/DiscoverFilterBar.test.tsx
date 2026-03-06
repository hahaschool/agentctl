import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { GroupMode, MinMessages, SortOption } from './DiscoverFilterBar';
import { DiscoverFilterBar } from './DiscoverFilterBar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultProps(overrides: Partial<Parameters<typeof DiscoverFilterBar>[0]> = {}) {
  return {
    searchRef: createRef<HTMLInputElement>(),
    search: '',
    onSearchChange: vi.fn(),
    minMessages: 0 as MinMessages,
    onMinMessagesChange: vi.fn(),
    sort: 'recent' as SortOption,
    onSortChange: vi.fn(),
    hostnames: [] as string[],
    machineFilter: 'all',
    onMachineFilterChange: vi.fn(),
    groupMode: 'project' as GroupMode,
    onGroupModeChange: vi.fn(),
    allExpanded: true,
    onToggleAll: vi.fn(),
    ...overrides,
  };
}

// ===========================================================================
// DiscoverFilterBar
// ===========================================================================
describe('DiscoverFilterBar', () => {
  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------
  it('renders the search input', () => {
    render(<DiscoverFilterBar {...defaultProps()} />);
    expect(screen.getByPlaceholderText('Search sessions...')).toBeDefined();
  });

  it('renders the search input with aria-label', () => {
    render(<DiscoverFilterBar {...defaultProps()} />);
    expect(screen.getByLabelText('Search sessions')).toBeDefined();
  });

  it('renders the minimum messages select', () => {
    render(<DiscoverFilterBar {...defaultProps()} />);
    expect(screen.getByLabelText('Minimum message count')).toBeDefined();
  });

  it('renders all min message options', () => {
    render(<DiscoverFilterBar {...defaultProps()} />);
    const select = screen.getByLabelText('Minimum message count');
    const options = select.querySelectorAll('option');
    expect(options.length).toBe(5);
    expect(options[0]?.textContent).toBe('All');
    expect(options[1]?.textContent).toBe('1+');
    expect(options[2]?.textContent).toBe('5+');
    expect(options[3]?.textContent).toBe('10+');
    expect(options[4]?.textContent).toBe('50+');
  });

  it('renders the sort select', () => {
    render(<DiscoverFilterBar {...defaultProps()} />);
    expect(screen.getByLabelText('Sort order')).toBeDefined();
  });

  it('renders all sort options', () => {
    render(<DiscoverFilterBar {...defaultProps()} />);
    const select = screen.getByLabelText('Sort order');
    const options = select.querySelectorAll('option');
    expect(options.length).toBe(3);
  });

  it('renders the group-by select', () => {
    render(<DiscoverFilterBar {...defaultProps()} />);
    expect(screen.getByLabelText('Group by')).toBeDefined();
  });

  it('renders group-by options (project, machine, flat)', () => {
    render(<DiscoverFilterBar {...defaultProps()} />);
    const select = screen.getByLabelText('Group by');
    const options = select.querySelectorAll('option');
    expect(options.length).toBe(3);
    expect(options[0]?.textContent).toBe('By Project');
    expect(options[1]?.textContent).toBe('By Machine');
    expect(options[2]?.textContent).toBe('Flat List');
  });

  // -------------------------------------------------------------------------
  // Keyboard shortcut hint
  // -------------------------------------------------------------------------
  it('shows "/" keyboard hint when search is empty', () => {
    const { container } = render(<DiscoverFilterBar {...defaultProps({ search: '' })} />);
    const kbd = container.querySelector('kbd');
    expect(kbd).not.toBeNull();
    expect(kbd?.textContent).toBe('/');
  });

  it('hides "/" keyboard hint when search has value', () => {
    const { container } = render(<DiscoverFilterBar {...defaultProps({ search: 'test' })} />);
    const kbd = container.querySelector('kbd');
    expect(kbd).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Machine filter
  // -------------------------------------------------------------------------
  it('does not render machine filter when only one hostname', () => {
    render(<DiscoverFilterBar {...defaultProps({ hostnames: ['host1'] })} />);
    expect(screen.queryByText('Machine:')).toBeNull();
  });

  it('renders machine filter when multiple hostnames', () => {
    render(<DiscoverFilterBar {...defaultProps({ hostnames: ['host1', 'host2'] })} />);
    expect(screen.getByText('Machine:')).toBeDefined();
  });

  it('renders "All" option with hostname count', () => {
    render(<DiscoverFilterBar {...defaultProps({ hostnames: ['host1', 'host2', 'host3'] })} />);
    expect(screen.getByText('All (3)')).toBeDefined();
  });

  it('renders each hostname as an option', () => {
    const hostnames = ['alpha', 'beta'];
    render(<DiscoverFilterBar {...defaultProps({ hostnames })} />);
    expect(screen.getByText('alpha')).toBeDefined();
    expect(screen.getByText('beta')).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Collapse/Expand button
  // -------------------------------------------------------------------------
  it('renders "Collapse All" button when allExpanded is true and groupMode is not flat', () => {
    render(<DiscoverFilterBar {...defaultProps({ allExpanded: true, groupMode: 'project' })} />);
    expect(screen.getByText('Collapse All')).toBeDefined();
  });

  it('renders "Expand All" button when allExpanded is false and groupMode is not flat', () => {
    render(<DiscoverFilterBar {...defaultProps({ allExpanded: false, groupMode: 'project' })} />);
    expect(screen.getByText('Expand All')).toBeDefined();
  });

  it('does not render toggle-all button when groupMode is flat', () => {
    render(<DiscoverFilterBar {...defaultProps({ groupMode: 'flat' })} />);
    expect(screen.queryByText('Collapse All')).toBeNull();
    expect(screen.queryByText('Expand All')).toBeNull();
  });

  it('sets correct aria-label on the toggle-all button', () => {
    render(<DiscoverFilterBar {...defaultProps({ allExpanded: true, groupMode: 'machine' })} />);
    expect(screen.getByLabelText('Collapse all groups')).toBeDefined();
  });

  it('sets correct aria-label for expand state', () => {
    render(<DiscoverFilterBar {...defaultProps({ allExpanded: false, groupMode: 'machine' })} />);
    expect(screen.getByLabelText('Expand all groups')).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // User interactions — callbacks
  // -------------------------------------------------------------------------
  it('calls onSearchChange when typing in search input', () => {
    const onSearchChange = vi.fn();
    render(<DiscoverFilterBar {...defaultProps({ onSearchChange })} />);
    fireEvent.change(screen.getByLabelText('Search sessions'), {
      target: { value: 'hello' },
    });
    expect(onSearchChange).toHaveBeenCalledWith('hello');
  });

  it('calls onMinMessagesChange with numeric value when selecting min messages', () => {
    const onMinMessagesChange = vi.fn();
    render(<DiscoverFilterBar {...defaultProps({ onMinMessagesChange })} />);
    fireEvent.change(screen.getByLabelText('Minimum message count'), {
      target: { value: '10' },
    });
    expect(onMinMessagesChange).toHaveBeenCalledWith(10);
  });

  it('calls onSortChange when selecting a sort option', () => {
    const onSortChange = vi.fn();
    render(<DiscoverFilterBar {...defaultProps({ onSortChange })} />);
    fireEvent.change(screen.getByLabelText('Sort order'), {
      target: { value: 'messages' },
    });
    expect(onSortChange).toHaveBeenCalledWith('messages');
  });

  it('calls onMachineFilterChange when selecting a machine', () => {
    const onMachineFilterChange = vi.fn();
    render(
      <DiscoverFilterBar {...defaultProps({ hostnames: ['a', 'b'], onMachineFilterChange })} />,
    );
    const machineSelect = screen.getByText('Machine:').parentElement?.querySelector('select');
    expect(machineSelect).not.toBeNull();
    fireEvent.change(machineSelect!, { target: { value: 'a' } });
    expect(onMachineFilterChange).toHaveBeenCalledWith('a');
  });

  it('calls onGroupModeChange when selecting a group mode', () => {
    const onGroupModeChange = vi.fn();
    render(<DiscoverFilterBar {...defaultProps({ onGroupModeChange })} />);
    fireEvent.change(screen.getByLabelText('Group by'), {
      target: { value: 'machine' },
    });
    expect(onGroupModeChange).toHaveBeenCalledWith('machine');
  });

  it('calls onToggleAll when clicking the collapse/expand button', () => {
    const onToggleAll = vi.fn();
    render(
      <DiscoverFilterBar
        {...defaultProps({ allExpanded: true, groupMode: 'project', onToggleAll })}
      />,
    );
    fireEvent.click(screen.getByText('Collapse All'));
    expect(onToggleAll).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Controlled values
  // -------------------------------------------------------------------------
  it('reflects the current search value', () => {
    render(<DiscoverFilterBar {...defaultProps({ search: 'my-query' })} />);
    const input = screen.getByLabelText('Search sessions') as HTMLInputElement;
    expect(input.value).toBe('my-query');
  });

  it('reflects the current minMessages value', () => {
    render(<DiscoverFilterBar {...defaultProps({ minMessages: 5 })} />);
    const select = screen.getByLabelText('Minimum message count') as HTMLSelectElement;
    expect(select.value).toBe('5');
  });

  it('reflects the current sort value', () => {
    render(<DiscoverFilterBar {...defaultProps({ sort: 'messages' })} />);
    const select = screen.getByLabelText('Sort order') as HTMLSelectElement;
    expect(select.value).toBe('messages');
  });

  it('reflects the current groupMode value', () => {
    render(<DiscoverFilterBar {...defaultProps({ groupMode: 'flat' })} />);
    const select = screen.getByLabelText('Group by') as HTMLSelectElement;
    expect(select.value).toBe('flat');
  });
});
