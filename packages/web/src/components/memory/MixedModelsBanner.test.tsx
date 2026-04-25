import { render, screen } from '@testing-library/react';

import { MixedModelsBanner } from './MixedModelsBanner';

describe('MixedModelsBanner', () => {
  it('renders nothing when there is only one model in play', () => {
    const { container } = render(
      <MixedModelsBanner
        activeModel="text-embedding-3-small"
        models={[{ table: 'memory_facts', model: 'text-embedding-3-small', count: 100 }]}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders the active model and mismatched model counts', () => {
    render(
      <MixedModelsBanner
        activeModel="text-embedding-3-small"
        models={[
          { table: 'memory_facts', model: 'text-embedding-3-small', count: 100 },
          { table: 'memory_drawers', model: 'gemini-embedding-001', count: 20 },
        ]}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/text-embedding-3-small/i);
    expect(screen.getByText(/gemini-embedding-001/i)).toBeDefined();
    expect(screen.getByText(/memory_drawers/i)).toBeDefined();
  });

  it('renders when the only returned model differs from the active provider', () => {
    render(
      <MixedModelsBanner
        activeModel="text-embedding-3-small"
        models={[{ table: 'memory_drawers', model: 'gemini-embedding-001', count: 20 }]}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/mixed embedding models detected/i);
    expect(screen.getByText(/gemini-embedding-001/i)).toBeDefined();
  });
});
