import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies — BEFORE component import
// ---------------------------------------------------------------------------

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
  }) => (
    <div data-testid="select" data-value={value}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children, ...props }: Record<string, unknown>) => (
    <button {...props}>{children as React.ReactNode}</button>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: Record<string, unknown>) => <input {...props} />,
}));

// ---------------------------------------------------------------------------
// Component import (after mocks)
// ---------------------------------------------------------------------------

import { PreferencesSection } from './PreferencesSection';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PreferencesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear localStorage before each test
    localStorage.clear();
  });

  // -- Heading -------------------------------------------------------------

  it('renders the "Workspace preferences" heading', () => {
    render(<PreferencesSection />);
    expect(screen.getByText('Workspace preferences')).toBeDefined();
  });

  it('renders heading as h3 element', () => {
    render(<PreferencesSection />);
    const heading = screen.getByText('Workspace preferences');
    expect(heading.tagName).toBe('H3');
  });

  // -- Labels --------------------------------------------------------------

  it('does not render the old "Default Model" label', () => {
    render(<PreferencesSection />);
    expect(screen.queryByText('Default Model')).toBeNull();
  });

  it('renders "Auto-Refresh Interval" label', () => {
    render(<PreferencesSection />);
    expect(screen.getByText('Auto-Refresh Interval')).toBeDefined();
  });

  it('renders "Max Display Messages" label', () => {
    render(<PreferencesSection />);
    expect(screen.getByText('Max Display Messages')).toBeDefined();
  });

  // -- Description texts ---------------------------------------------------

  it('shows runtime profile note', () => {
    render(<PreferencesSection />);
    expect(screen.getByText(/Runtime models now live in Runtime Profiles/)).toBeDefined();
  });

  it('shows refresh description text', () => {
    render(<PreferencesSection />);
    expect(screen.getByText(/How often list views poll for updates/)).toBeDefined();
  });

  it('shows max messages description text', () => {
    render(<PreferencesSection />);
    expect(
      screen.getByText('Maximum number of messages shown in the session detail view.'),
    ).toBeDefined();
  });

  // -- Refresh options -----------------------------------------------------

  it('renders refresh interval options', () => {
    render(<PreferencesSection />);
    expect(screen.getByText('5s')).toBeDefined();
    expect(screen.getByText('10s')).toBeDefined();
    expect(screen.getByText('30s')).toBeDefined();
    expect(screen.getByText('1m')).toBeDefined();
    expect(screen.getByText('Off')).toBeDefined();
  });

  // -- Max messages input --------------------------------------------------

  it('renders max messages input with type="number"', () => {
    render(<PreferencesSection />);
    const input = screen.getByRole('spinbutton');
    expect(input).toBeDefined();
    expect(input.getAttribute('type')).toBe('number');
  });

  // -- Default values ------------------------------------------------------

  it('uses 10s as default auto refresh value', () => {
    render(<PreferencesSection />);
    const selects = screen.getAllByTestId('select');
    expect(selects[0]?.getAttribute('data-value')).toBe('10000');
  });
});
