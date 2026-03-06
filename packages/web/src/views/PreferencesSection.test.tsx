import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies — BEFORE component import
// ---------------------------------------------------------------------------

vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value }: { children: React.ReactNode; value?: string; onValueChange?: (v: string) => void }) => (
    <div data-testid="select" data-value={value}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children, ...props }: Record<string, unknown>) => <button {...props}>{children as React.ReactNode}</button>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => <option value={value}>{children}</option>,
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

  it('renders the "Defaults" heading', () => {
    render(<PreferencesSection />);
    expect(screen.getByText('Defaults')).toBeDefined();
  });

  it('renders heading as h3 element', () => {
    render(<PreferencesSection />);
    const heading = screen.getByText('Defaults');
    expect(heading.tagName).toBe('H3');
  });

  // -- Labels --------------------------------------------------------------

  it('renders "Default Model" label', () => {
    render(<PreferencesSection />);
    expect(screen.getByText('Default Model')).toBeDefined();
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

  it('shows model description text', () => {
    render(<PreferencesSection />);
    expect(screen.getByText('Model used when creating new sessions or agents.')).toBeDefined();
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

  // -- Model options -------------------------------------------------------

  it('renders model options', () => {
    render(<PreferencesSection />);
    expect(screen.getByText('Claude Sonnet 4.6')).toBeDefined();
    expect(screen.getByText('Claude Opus 4.6')).toBeDefined();
    expect(screen.getByText('Claude Haiku 4.5')).toBeDefined();
    expect(screen.getByText('Claude Sonnet 4.5')).toBeDefined();
    expect(screen.getByText('Claude Opus 4')).toBeDefined();
    expect(screen.getByText('Claude Sonnet 4')).toBeDefined();
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

  it('uses claude-sonnet-4-6 as default model value', () => {
    render(<PreferencesSection />);
    const selects = screen.getAllByTestId('select');
    // First select is the model select
    expect(selects[0]!.getAttribute('data-value')).toBe('claude-sonnet-4-6');
  });
});
