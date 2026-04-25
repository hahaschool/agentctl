import { render, screen } from '@testing-library/react';

vi.mock('@/views/MemoryOperationsPage', () => ({
  MemoryOperationsPage: () => <div data-testid="memory-operations-view" />,
}));

import Page from './page';

describe('memory operations route', () => {
  it('renders the memory operations view', () => {
    render(<Page />);

    expect(screen.getByTestId('memory-operations-view')).toBeDefined();
  });
});
