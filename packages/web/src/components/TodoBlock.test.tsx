import { render, screen } from '@testing-library/react';

import { TodoBlock } from './TodoBlock';

describe('TodoBlock', () => {
  const makeTodos = (items: Array<{ content: string; status: string; priority?: string }>) =>
    JSON.stringify(items.map((item, i) => ({ id: String(i), ...item })));

  it('renders todo items with icons for completed and pending', () => {
    const content = makeTodos([
      { content: 'Done task', status: 'completed' },
      { content: 'Pending task', status: 'pending' },
    ]);
    const { container } = render(<TodoBlock content={content} />);
    expect(screen.getByText('Done task')).toBeDefined();
    expect(screen.getByText('Pending task')).toBeDefined();
    // Completed items get a CheckCircle2 SVG, pending get a Circle SVG
    const svgs = container.querySelectorAll('svg');
    // At least 3 SVGs: ListTodo header icon + CheckCircle2 + Circle
    expect(svgs.length).toBeGreaterThanOrEqual(3);
  });

  it('shows completion count (X/Y complete)', () => {
    const content = makeTodos([
      { content: 'Task A', status: 'completed' },
      { content: 'Task B', status: 'pending' },
      { content: 'Task C', status: 'completed' },
    ]);
    render(<TodoBlock content={content} />);
    expect(screen.getByText('2/3 complete')).toBeDefined();
  });

  it('handles invalid JSON content gracefully', () => {
    render(<TodoBlock content="not-valid-json{{{" />);
    expect(screen.getByText('Unable to parse task list')).toBeDefined();
  });

  it('handles empty array', () => {
    render(<TodoBlock content="[]" />);
    expect(screen.getByText('No tasks')).toBeDefined();
  });

  it('handles non-array JSON gracefully', () => {
    render(<TodoBlock content='{"foo": "bar"}' />);
    expect(screen.getByText('No tasks')).toBeDefined();
  });

  it('shows priority badges for non-medium priorities', () => {
    const content = makeTodos([
      { content: 'High priority task', status: 'pending', priority: 'high' },
      { content: 'Low priority task', status: 'pending', priority: 'low' },
      { content: 'Medium priority task', status: 'pending', priority: 'medium' },
    ]);
    render(<TodoBlock content={content} />);
    // high and low should show badges
    expect(screen.getByText('high')).toBeDefined();
    expect(screen.getByText('low')).toBeDefined();
    // medium should NOT show a badge (only the content text should appear)
    const mediumBadges = screen.queryAllByText('medium');
    expect(mediumBadges.length).toBe(0);
  });

  it('applies strikethrough class to completed items', () => {
    const content = makeTodos([{ content: 'Finished', status: 'completed' }]);
    const { container } = render(<TodoBlock content={content} />);
    const strikeEl = container.querySelector('.line-through');
    expect(strikeEl).toBeDefined();
    expect(strikeEl?.textContent).toBe('Finished');
  });

  it('shows timestamp when provided', () => {
    const content = makeTodos([{ content: 'Task', status: 'pending' }]);
    render(<TodoBlock content={content} timestamp="10:00:00" />);
    expect(screen.getByText('10:00:00')).toBeDefined();
  });

  it('shows "Tasks" label', () => {
    const content = makeTodos([{ content: 'Task', status: 'pending' }]);
    render(<TodoBlock content={content} />);
    expect(screen.getByText('Tasks')).toBeDefined();
  });
});
