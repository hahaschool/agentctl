import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardActionButton } from './DashboardActionButton';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DashboardActionButton', () => {
  it('renders the label text', () => {
    render(<DashboardActionButton label="New Agent" onClick={vi.fn()} />);
    expect(screen.getByText('New Agent')).toBeDefined();
  });

  it('renders as a button element', () => {
    render(<DashboardActionButton label="Create" onClick={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Create' });
    expect(button).toBeDefined();
    expect(button.getAttribute('type')).toBe('button');
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<DashboardActionButton label="Start" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('calls onClick each time the button is clicked', () => {
    const onClick = vi.fn();
    render(<DashboardActionButton label="Refresh" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Refresh' });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it('renders different labels correctly', () => {
    const { rerender } = render(<DashboardActionButton label="View All" onClick={vi.fn()} />);
    expect(screen.getByText('View All')).toBeDefined();

    rerender(<DashboardActionButton label="Settings" onClick={vi.fn()} />);
    expect(screen.getByText('Settings')).toBeDefined();
    expect(screen.queryByText('View All')).toBeNull();
  });
});
