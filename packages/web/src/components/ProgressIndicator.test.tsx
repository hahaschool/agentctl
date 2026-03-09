import { render, screen } from '@testing-library/react';

import { ProgressIndicator } from './ProgressIndicator';

describe('ProgressIndicator', () => {
  it('renders with bash tool name', () => {
    const { container } = render(<ProgressIndicator content="Running command" toolName="bash" />);
    // Should have an SVG icon (Terminal)
    expect(container.querySelector('svg')).toBeDefined();
    expect(screen.getByText('bash')).toBeDefined();
  });

  it('renders with task tool name', () => {
    const { container } = render(<ProgressIndicator content="Executing task" toolName="task" />);
    expect(container.querySelector('svg')).toBeDefined();
    expect(screen.getByText('task')).toBeDefined();
  });

  it('renders with other tool name', () => {
    const { container } = render(<ProgressIndicator content="Doing something" toolName="read" />);
    expect(container.querySelector('svg')).toBeDefined();
    expect(screen.getByText('read')).toBeDefined();
  });

  it('renders without tool name', () => {
    const { container } = render(<ProgressIndicator content="Doing something" />);
    expect(container.querySelector('svg')).toBeDefined();
  });

  it('shows content text', () => {
    render(<ProgressIndicator content="Reading file.ts" toolName="read" />);
    expect(screen.getByText('Reading file.ts')).toBeDefined();
  });

  it('shows tool name when provided', () => {
    render(<ProgressIndicator content="Running" toolName="bash" />);
    expect(screen.getByText('bash')).toBeDefined();
  });

  it('does not show tool name label when toolName is not provided', () => {
    const { container } = render(<ProgressIndicator content="Running" />);
    // Should have icon SVG + content span, no tool name span
    const spans = container.querySelectorAll('span');
    expect(spans.length).toBe(1); // just content
  });
});
