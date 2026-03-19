import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/views/MemoryDashboardView', () => ({
  MemoryDashboardView: () => <div data-testid="memory-dashboard-view">Memory dashboard view</div>,
}));

import Page from './page';

describe('memory dashboard route', () => {
  it('renders the real dashboard view instead of the placeholder shell', () => {
    render(<Page />);

    expect(screen.getByTestId('memory-dashboard-view')).toBeDefined();
  });
});
