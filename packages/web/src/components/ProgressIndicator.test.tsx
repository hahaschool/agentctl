import { render, screen } from '@testing-library/react';

import { ProgressIndicator } from './ProgressIndicator';

describe('ProgressIndicator', () => {
  it('renders with bash icon ($) when toolName is "bash"', () => {
    render(<ProgressIndicator content="Running command" toolName="bash" />);
    expect(screen.getByText('$')).toBeDefined();
  });

  it('renders with task icon (...) when toolName is "task"', () => {
    render(<ProgressIndicator content="Executing task" toolName="task" />);
    expect(screen.getByText('...')).toBeDefined();
  });

  it('renders with default icon (>) when toolName is something else', () => {
    render(<ProgressIndicator content="Doing something" toolName="read" />);
    expect(screen.getByText('>')).toBeDefined();
  });

  it('renders with default icon (>) when no toolName is provided', () => {
    render(<ProgressIndicator content="Doing something" />);
    expect(screen.getByText('>')).toBeDefined();
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
    // Only the icon and content should be rendered (no tool name span with ml-auto)
    const spans = container.querySelectorAll('span');
    expect(spans.length).toBe(2); // icon + content
  });
});
