import { fireEvent, render, screen } from '@testing-library/react';

import { ScopeSelector } from './ScopeSelector';

describe('ScopeSelector', () => {
  it('renders the provided scope options', () => {
    render(
      <ScopeSelector
        value="global"
        options={['global', 'project:agentctl', 'agent:worker-1']}
        onValueChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('option', { name: 'global' })).toBeDefined();
    expect(screen.getByRole('option', { name: 'project:agentctl' })).toBeDefined();
  });

  it('calls onValueChange when the value changes', () => {
    const onValueChange = vi.fn();
    render(
      <ScopeSelector
        value="global"
        options={['global', 'project:agentctl']}
        onValueChange={onValueChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Scope'), {
      target: { value: 'project:agentctl' },
    });

    expect(onValueChange).toHaveBeenCalledWith('project:agentctl');
  });
});
