import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CollapsibleSection } from './CollapsibleSection';

// ===========================================================================
// Tests
// ===========================================================================

describe('CollapsibleSection', () => {
  // -----------------------------------------------------------------------
  // Basic rendering
  // -----------------------------------------------------------------------

  it('renders the title', () => {
    render(
      <CollapsibleSection title="Audit Trail" open={false} onToggle={vi.fn()}>
        <p>content</p>
      </CollapsibleSection>,
    );
    expect(screen.getByText('Audit Trail')).toBeDefined();
  });

  it('renders the badge when provided', () => {
    render(
      <CollapsibleSection title="Actions" badge="42" open={false} onToggle={vi.fn()}>
        <p>content</p>
      </CollapsibleSection>,
    );
    expect(screen.getByText('(42)')).toBeDefined();
  });

  it('does not render badge when not provided', () => {
    const { container } = render(
      <CollapsibleSection title="Actions" open={false} onToggle={vi.fn()}>
        <p>content</p>
      </CollapsibleSection>,
    );
    // Only the arrow span and title span should be in the button
    const button = container.querySelector('button') as HTMLElement;
    const spans = button.querySelectorAll('span');
    // arrow + title = 2 spans (no badge)
    expect(spans.length).toBe(2);
  });

  // -----------------------------------------------------------------------
  // Open / closed state
  // -----------------------------------------------------------------------

  it('renders children when open is true', () => {
    render(
      <CollapsibleSection title="Section" open={true} onToggle={vi.fn()}>
        <p data-testid="child-content">Hello</p>
      </CollapsibleSection>,
    );
    expect(screen.getByTestId('child-content')).toBeDefined();
    expect(screen.getByText('Hello')).toBeDefined();
  });

  it('does not render children when open is false', () => {
    render(
      <CollapsibleSection title="Section" open={false} onToggle={vi.fn()}>
        <p data-testid="child-content">Hello</p>
      </CollapsibleSection>,
    );
    expect(screen.queryByTestId('child-content')).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Arrow rotation
  // -----------------------------------------------------------------------

  it('shows arrow un-rotated when open', () => {
    const { container } = render(
      <CollapsibleSection title="Section" open={true} onToggle={vi.fn()}>
        <p>content</p>
      </CollapsibleSection>,
    );
    const button = container.querySelector('button') as HTMLElement;
    const arrow = button.querySelector('span') as HTMLElement;
    expect(arrow.className).toContain('rotate-0');
    expect(arrow.className).not.toContain('-rotate-90');
  });

  it('shows arrow rotated -90 when closed', () => {
    const { container } = render(
      <CollapsibleSection title="Section" open={false} onToggle={vi.fn()}>
        <p>content</p>
      </CollapsibleSection>,
    );
    const button = container.querySelector('button') as HTMLElement;
    const arrow = button.querySelector('span') as HTMLElement;
    expect(arrow.className).toContain('-rotate-90');
  });

  // -----------------------------------------------------------------------
  // Toggle callback
  // -----------------------------------------------------------------------

  it('calls onToggle when the button is clicked', () => {
    const onToggle = vi.fn();
    render(
      <CollapsibleSection title="Section" open={false} onToggle={onToggle}>
        <p>content</p>
      </CollapsibleSection>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('calls onToggle on each click', () => {
    const onToggle = vi.fn();
    render(
      <CollapsibleSection title="Section" open={true} onToggle={onToggle}>
        <p>content</p>
      </CollapsibleSection>,
    );
    const button = screen.getByRole('button');
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(3);
  });

  // -----------------------------------------------------------------------
  // Accessibility
  // -----------------------------------------------------------------------

  it('sets aria-expanded to true when open', () => {
    render(
      <CollapsibleSection title="Section" open={true} onToggle={vi.fn()}>
        <p>content</p>
      </CollapsibleSection>,
    );
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('sets aria-expanded to false when closed', () => {
    render(
      <CollapsibleSection title="Section" open={false} onToggle={vi.fn()}>
        <p>content</p>
      </CollapsibleSection>,
    );
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('has type="button" on the toggle', () => {
    render(
      <CollapsibleSection title="Section" open={false} onToggle={vi.fn()}>
        <p>content</p>
      </CollapsibleSection>,
    );
    const button = screen.getByRole('button');
    expect(button.getAttribute('type')).toBe('button');
  });

  // -----------------------------------------------------------------------
  // Complex children
  // -----------------------------------------------------------------------

  it('renders multiple children elements when open', () => {
    render(
      <CollapsibleSection title="Multi" open={true} onToggle={vi.fn()}>
        <p data-testid="child-1">First</p>
        <p data-testid="child-2">Second</p>
        <p data-testid="child-3">Third</p>
      </CollapsibleSection>,
    );
    expect(screen.getByTestId('child-1')).toBeDefined();
    expect(screen.getByTestId('child-2')).toBeDefined();
    expect(screen.getByTestId('child-3')).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Badge with empty string
  // -----------------------------------------------------------------------

  it('does not render badge parentheses when badge is empty string', () => {
    render(
      <CollapsibleSection title="Section" badge="" open={false} onToggle={vi.fn()}>
        <p>content</p>
      </CollapsibleSection>,
    );
    // badge is falsy (""), so it should not render
    expect(screen.queryByText('()')).toBeNull();
  });
});
