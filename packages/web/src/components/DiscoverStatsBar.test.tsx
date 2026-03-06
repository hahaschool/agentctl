import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('../lib/format-utils', () => ({
  formatNumber: (n: number) => String(n),
}));

import { DiscoverStatsBar } from './DiscoverStatsBar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultProps(overrides: Partial<Parameters<typeof DiscoverStatsBar>[0]> = {}) {
  return {
    filteredCount: 25,
    totalCount: 100,
    projectCount: 5,
    machineCount: 2,
    importedInFilterCount: 3,
    hasImported: false,
    selectedCount: 0,
    notImportedFilteredCount: 22,
    onSelectAll: vi.fn(),
    onBulkImport: vi.fn(),
    bulkImporting: false,
    importProgress: null,
    ...overrides,
  };
}

// ===========================================================================
// DiscoverStatsBar
// ===========================================================================
describe('DiscoverStatsBar', () => {
  // -------------------------------------------------------------------------
  // Summary text rendering
  // -------------------------------------------------------------------------
  it('renders filtered and total session counts', () => {
    render(<DiscoverStatsBar {...defaultProps()} />);
    expect(screen.getByText(/Showing 25 of 100 sessions/)).toBeDefined();
  });

  it('renders project count with correct pluralization', () => {
    render(<DiscoverStatsBar {...defaultProps({ projectCount: 1 })} />);
    expect(screen.getByText(/1 project /)).toBeDefined();
  });

  it('renders plural projects', () => {
    render(<DiscoverStatsBar {...defaultProps({ projectCount: 5 })} />);
    expect(screen.getByText(/5 projects/)).toBeDefined();
  });

  it('renders machine count with correct pluralization', () => {
    render(<DiscoverStatsBar {...defaultProps({ machineCount: 1 })} />);
    expect(screen.getByText(/1 machine/)).toBeDefined();
  });

  it('renders plural machines', () => {
    render(<DiscoverStatsBar {...defaultProps({ machineCount: 3 })} />);
    expect(screen.getByText(/3 machines/)).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Imported count
  // -------------------------------------------------------------------------
  it('does not show imported count when hasImported is false', () => {
    render(<DiscoverStatsBar {...defaultProps({ hasImported: false })} />);
    expect(screen.queryByText(/already imported/)).toBeNull();
  });

  it('shows imported count when hasImported is true', () => {
    render(<DiscoverStatsBar {...defaultProps({ hasImported: true, importedInFilterCount: 7 })} />);
    expect(screen.getByText(/7 already imported/)).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Select All / Deselect All button
  // -------------------------------------------------------------------------
  it('renders "Select All" button when no items are selected', () => {
    render(<DiscoverStatsBar {...defaultProps({ selectedCount: 0 })} />);
    expect(screen.getByText('Select All')).toBeDefined();
  });

  it('renders "Select All" when selected < notImportedFilteredCount', () => {
    render(
      <DiscoverStatsBar {...defaultProps({ selectedCount: 5, notImportedFilteredCount: 22 })} />,
    );
    expect(screen.getByText('Select All')).toBeDefined();
  });

  it('renders "Deselect All" when selectedCount === notImportedFilteredCount', () => {
    render(
      <DiscoverStatsBar {...defaultProps({ selectedCount: 22, notImportedFilteredCount: 22 })} />,
    );
    expect(screen.getByText('Deselect All')).toBeDefined();
  });

  it('calls onSelectAll when Select All button is clicked', () => {
    const onSelectAll = vi.fn();
    render(<DiscoverStatsBar {...defaultProps({ onSelectAll })} />);
    fireEvent.click(screen.getByText('Select All'));
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Bulk import button
  // -------------------------------------------------------------------------
  it('does not render bulk import button when selectedCount is 0', () => {
    render(<DiscoverStatsBar {...defaultProps({ selectedCount: 0 })} />);
    expect(screen.queryByText(/Import.*Selected/)).toBeNull();
  });

  it('renders bulk import button when selectedCount > 0', () => {
    render(<DiscoverStatsBar {...defaultProps({ selectedCount: 3 })} />);
    expect(screen.getByText('Import 3 Selected')).toBeDefined();
  });

  it('shows "Importing..." when bulkImporting is true', () => {
    render(<DiscoverStatsBar {...defaultProps({ selectedCount: 3, bulkImporting: true })} />);
    expect(screen.getByText('Importing...')).toBeDefined();
  });

  it('disables bulk import button when bulkImporting is true', () => {
    render(<DiscoverStatsBar {...defaultProps({ selectedCount: 3, bulkImporting: true })} />);
    const button = screen.getByText('Importing...');
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('calls onBulkImport when bulk import button is clicked', () => {
    const onBulkImport = vi.fn();
    render(<DiscoverStatsBar {...defaultProps({ selectedCount: 5, onBulkImport })} />);
    fireEvent.click(screen.getByText('Import 5 Selected'));
    expect(onBulkImport).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Import progress
  // -------------------------------------------------------------------------
  it('does not render progress bar when importProgress is null', () => {
    render(<DiscoverStatsBar {...defaultProps({ selectedCount: 3 })} />);
    expect(screen.queryByText(/\d+\/\d+/)).toBeNull();
  });

  it('renders progress bar and count when importProgress is provided', () => {
    render(
      <DiscoverStatsBar
        {...defaultProps({
          selectedCount: 5,
          importProgress: { current: 2, total: 5 },
        })}
      />,
    );
    expect(screen.getByText('2/5')).toBeDefined();
  });

  it('renders progress bar with correct width style', () => {
    const { container } = render(
      <DiscoverStatsBar
        {...defaultProps({
          selectedCount: 4,
          importProgress: { current: 1, total: 4 },
        })}
      />,
    );
    // The inner progress bar div has an inline width style
    const progressBar = container.querySelector('[style]') as HTMLElement | null;
    expect(progressBar).not.toBeNull();
    expect(progressBar?.style.width).toBe('25%');
  });

  it('does not show progress when selectedCount is 0 even if importProgress exists', () => {
    render(
      <DiscoverStatsBar
        {...defaultProps({
          selectedCount: 0,
          importProgress: { current: 1, total: 5 },
        })}
      />,
    );
    // The entire import section is conditionally rendered based on selectedCount > 0
    expect(screen.queryByText('1/5')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Formatting
  // -------------------------------------------------------------------------
  it('uses formatNumber for filteredCount and totalCount', () => {
    render(<DiscoverStatsBar {...defaultProps({ filteredCount: 1234, totalCount: 5678 })} />);
    expect(screen.getByText(/1234/)).toBeDefined();
    expect(screen.getByText(/5678/)).toBeDefined();
  });
});
