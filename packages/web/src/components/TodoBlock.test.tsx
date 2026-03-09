import { render, screen } from '@testing-library/react';

import { TodoBlock } from './TodoBlock';

describe('TodoBlock', () => {
  const makeTodos = (
    items: Array<{ content: string; status: string; priority?: string; id?: string }>,
  ): string => JSON.stringify(items.map((item, i) => ({ id: item.id ?? String(i), ...item })));

  describe('basic rendering', () => {
    it('renders todo items with correct text', () => {
      const content = makeTodos([
        { content: 'Done task', status: 'completed' },
        { content: 'Pending task', status: 'pending' },
      ]);
      render(<TodoBlock content={content} />);
      expect(screen.getByText('Done task')).toBeDefined();
      expect(screen.getByText('Pending task')).toBeDefined();
    });

    it('shows "Tasks" label', () => {
      const content = makeTodos([{ content: 'Task', status: 'pending' }]);
      render(<TodoBlock content={content} />);
      expect(screen.getByText('Tasks')).toBeDefined();
    });

    it('renders SVG icons for completed and pending items', () => {
      const content = makeTodos([
        { content: 'Done', status: 'completed' },
        { content: 'Pending', status: 'pending' },
      ]);
      const { container } = render(<TodoBlock content={content} />);
      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThanOrEqual(3);
    });

    it('renders a ListTodo icon in the header', () => {
      const content = makeTodos([{ content: 'Task', status: 'pending' }]);
      const { container } = render(<TodoBlock content={content} />);
      expect(container.querySelector('svg')).not.toBeNull();
    });
  });

  describe('completion count', () => {
    it('shows completion count (X/Y complete)', () => {
      const content = makeTodos([
        { content: 'Task A', status: 'completed' },
        { content: 'Task B', status: 'pending' },
        { content: 'Task C', status: 'completed' },
      ]);
      render(<TodoBlock content={content} />);
      expect(screen.getByText('2/3 complete')).toBeDefined();
    });

    it('shows 0/N when no tasks are completed', () => {
      const content = makeTodos([
        { content: 'Task A', status: 'pending' },
        { content: 'Task B', status: 'pending' },
      ]);
      render(<TodoBlock content={content} />);
      expect(screen.getByText('0/2 complete')).toBeDefined();
    });

    it('shows N/N when all tasks are completed', () => {
      const content = makeTodos([
        { content: 'Task A', status: 'completed' },
        { content: 'Task B', status: 'completed' },
        { content: 'Task C', status: 'completed' },
      ]);
      render(<TodoBlock content={content} />);
      expect(screen.getByText('3/3 complete')).toBeDefined();
    });

    it('shows 1/1 for a single completed task', () => {
      const content = makeTodos([{ content: 'Only task', status: 'completed' }]);
      render(<TodoBlock content={content} />);
      expect(screen.getByText('1/1 complete')).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('handles invalid JSON content gracefully', () => {
      render(<TodoBlock content="not-valid-json{{{" />);
      expect(screen.getByText('Unable to parse task list')).toBeDefined();
      expect(screen.getByText('Tasks')).toBeDefined();
    });

    it('handles empty array', () => {
      render(<TodoBlock content="[]" />);
      expect(screen.getByText('No tasks')).toBeDefined();
    });

    it('handles non-array JSON gracefully', () => {
      render(<TodoBlock content='{"foo": "bar"}' />);
      expect(screen.getByText('No tasks')).toBeDefined();
    });

    it('handles empty string content', () => {
      render(<TodoBlock content="" />);
      expect(screen.getByText('Unable to parse task list')).toBeDefined();
    });

    it('handles "null" JSON content', () => {
      render(<TodoBlock content="null" />);
      expect(screen.getByText('No tasks')).toBeDefined();
    });
  });

  describe('checkbox states (completed vs pending)', () => {
    it('applies strikethrough and muted style to completed items', () => {
      const content = makeTodos([{ content: 'Finished', status: 'completed' }]);
      const { container } = render(<TodoBlock content={content} />);
      const strikeEl = container.querySelector('.line-through');
      expect(strikeEl).not.toBeNull();
      expect(strikeEl?.textContent).toBe('Finished');
      expect(strikeEl?.className).toContain('text-muted-foreground');
    });

    it('applies normal foreground style to pending items', () => {
      const content = makeTodos([{ content: 'Not done', status: 'pending' }]);
      const { container } = render(<TodoBlock content={content} />);
      const strikeEls = container.querySelectorAll('.line-through');
      expect(strikeEls.length).toBe(0);
      const pendingSpan = screen.getByText('Not done');
      expect(pendingSpan.className).toContain('text-foreground/90');
    });

    it('renders green check icon for completed items', () => {
      const content = makeTodos([{ content: 'Done', status: 'completed' }]);
      const { container } = render(<TodoBlock content={content} />);
      const greenIcon = container.querySelector('.text-green-600');
      expect(greenIcon).not.toBeNull();
    });

    it('renders muted circle icon for pending items', () => {
      const content = makeTodos([{ content: 'Pending', status: 'pending' }]);
      const { container } = render(<TodoBlock content={content} />);
      const todoRows = container.querySelectorAll('.flex.items-start.gap-2');
      expect(todoRows.length).toBe(1);
      const svg = todoRows[0]?.querySelector('svg');
      expect(svg?.className.baseVal || svg?.getAttribute('class') || '').toContain(
        'text-muted-foreground',
      );
    });
  });

  describe('priority indicators', () => {
    it('shows priority badge for high priority', () => {
      const content = makeTodos([{ content: 'Urgent task', status: 'pending', priority: 'high' }]);
      render(<TodoBlock content={content} />);
      expect(screen.getByText('high')).toBeDefined();
    });

    it('shows priority badge for low priority', () => {
      const content = makeTodos([{ content: 'Low task', status: 'pending', priority: 'low' }]);
      render(<TodoBlock content={content} />);
      expect(screen.getByText('low')).toBeDefined();
    });

    it('does NOT show priority badge for medium priority', () => {
      const content = makeTodos([
        { content: 'Normal task', status: 'pending', priority: 'medium' },
      ]);
      render(<TodoBlock content={content} />);
      const badges = screen.queryAllByText('medium');
      expect(badges.length).toBe(0);
    });

    it('does not show priority badge when priority is not provided', () => {
      const content = makeTodos([{ content: 'Task', status: 'pending' }]);
      const { container } = render(<TodoBlock content={content} />);
      const badgeSpans = container.querySelectorAll('.text-\\[9px\\]');
      expect(badgeSpans.length).toBe(0);
    });

    it('applies red styling to high priority badge', () => {
      const content = makeTodos([{ content: 'Urgent', status: 'pending', priority: 'high' }]);
      render(<TodoBlock content={content} />);
      const badge = screen.getByText('high');
      expect(badge.className).toContain('text-red-600');
    });

    it('applies muted styling to low priority badge', () => {
      const content = makeTodos([{ content: 'Optional', status: 'pending', priority: 'low' }]);
      render(<TodoBlock content={content} />);
      const badge = screen.getByText('low');
      expect(badge.className).toContain('text-muted-foreground');
      expect(badge.className).toContain('bg-muted');
    });

    it('shows multiple priority badges for mixed items', () => {
      const content = makeTodos([
        { content: 'High task', status: 'pending', priority: 'high' },
        { content: 'Low task', status: 'pending', priority: 'low' },
        { content: 'Medium task', status: 'pending', priority: 'medium' },
      ]);
      render(<TodoBlock content={content} />);
      expect(screen.getByText('high')).toBeDefined();
      expect(screen.getByText('low')).toBeDefined();
      expect(screen.queryAllByText('medium').length).toBe(0);
    });
  });

  describe('timestamp', () => {
    it('shows timestamp when provided', () => {
      const content = makeTodos([{ content: 'Task', status: 'pending' }]);
      render(<TodoBlock content={content} timestamp="10:00:00" />);
      expect(screen.getByText('10:00:00')).toBeDefined();
    });

    it('does not show timestamp when not provided', () => {
      const content = makeTodos([{ content: 'Task', status: 'pending' }]);
      render(<TodoBlock content={content} />);
      expect(screen.queryByText(/\d{2}:\d{2}:\d{2}/)).toBeNull();
    });
  });

  describe('keying and item identity', () => {
    it('uses todo.id as key when available', () => {
      const content = JSON.stringify([
        { id: 'custom-1', content: 'Item with ID', status: 'pending' },
        { id: 'custom-2', content: 'Another item', status: 'completed' },
      ]);
      render(<TodoBlock content={content} />);
      expect(screen.getByText('Item with ID')).toBeDefined();
      expect(screen.getByText('Another item')).toBeDefined();
    });

    it('works when items have no id (falls back to index)', () => {
      const content = JSON.stringify([
        { content: 'No ID item 1', status: 'pending' },
        { content: 'No ID item 2', status: 'completed' },
      ]);
      render(<TodoBlock content={content} />);
      expect(screen.getByText('No ID item 1')).toBeDefined();
      expect(screen.getByText('No ID item 2')).toBeDefined();
      expect(screen.getByText('1/2 complete')).toBeDefined();
    });
  });
});
