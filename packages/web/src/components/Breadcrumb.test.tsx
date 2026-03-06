import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before component imports
// ---------------------------------------------------------------------------

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [k: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { Breadcrumb } from './Breadcrumb';

describe('Breadcrumb', () => {
  describe('rendering items', () => {
    it('renders all breadcrumb item labels', () => {
      render(
        <Breadcrumb
          items={[
            { label: 'Home', href: '/' },
            { label: 'Agents', href: '/agents' },
            { label: 'Agent-1' },
          ]}
        />,
      );
      expect(screen.getByText('Home')).toBeDefined();
      expect(screen.getByText('Agents')).toBeDefined();
      expect(screen.getByText('Agent-1')).toBeDefined();
    });

    it('renders a nav element with aria-label "Breadcrumb"', () => {
      render(<Breadcrumb items={[{ label: 'Home' }]} />);
      const nav = screen.getByLabelText('Breadcrumb');
      expect(nav.tagName).toBe('NAV');
    });
  });

  describe('links vs text', () => {
    it('renders intermediate items with href as links', () => {
      render(
        <Breadcrumb
          items={[
            { label: 'Home', href: '/' },
            { label: 'Agents', href: '/agents' },
            { label: 'Detail' },
          ]}
        />,
      );
      const homeLink = screen.getByText('Home').closest('a');
      expect(homeLink).not.toBeNull();
      expect(homeLink?.getAttribute('href')).toBe('/');

      const agentsLink = screen.getByText('Agents').closest('a');
      expect(agentsLink).not.toBeNull();
      expect(agentsLink?.getAttribute('href')).toBe('/agents');
    });

    it('renders the last item as plain text even if it has an href', () => {
      render(
        <Breadcrumb
          items={[
            { label: 'Home', href: '/' },
            { label: 'Current', href: '/current' },
          ]}
        />,
      );
      // "Current" is the last item, should not be a link
      const currentEl = screen.getByText('Current');
      expect(currentEl.closest('a')).toBeNull();
    });

    it('renders the last item with aria-current="page"', () => {
      render(<Breadcrumb items={[{ label: 'Home', href: '/' }, { label: 'Detail' }]} />);
      const detail = screen.getByText('Detail');
      expect(detail.getAttribute('aria-current')).toBe('page');
    });

    it('does not set aria-current on non-last items', () => {
      render(
        <Breadcrumb
          items={[
            { label: 'Home', href: '/' },
            { label: 'Middle', href: '/mid' },
            { label: 'End' },
          ]}
        />,
      );
      const homeLink = screen.getByText('Home');
      expect(homeLink.getAttribute('aria-current')).toBeNull();
    });

    it('renders an item without href as plain text (not a link)', () => {
      render(<Breadcrumb items={[{ label: 'No Link' }, { label: 'Also No Link' }]} />);
      expect(screen.getByText('No Link').closest('a')).toBeNull();
    });
  });

  describe('separator rendering', () => {
    it('renders "/" separator between items', () => {
      const { container } = render(
        <Breadcrumb
          items={[{ label: 'A', href: '/a' }, { label: 'B', href: '/b' }, { label: 'C' }]}
        />,
      );
      const separators = container.querySelectorAll('[aria-hidden="true"]');
      // Separators appear before items at index 1 and 2 → 2 separators
      expect(separators.length).toBe(2);
      expect(separators[0]?.textContent).toBe('/');
      expect(separators[1]?.textContent).toBe('/');
    });

    it('does not render a separator before the first item', () => {
      const { container } = render(<Breadcrumb items={[{ label: 'Only' }]} />);
      const separators = container.querySelectorAll('[aria-hidden="true"]');
      expect(separators.length).toBe(0);
    });
  });

  describe('styling', () => {
    it('applies font-medium class to the last item', () => {
      render(<Breadcrumb items={[{ label: 'Home', href: '/' }, { label: 'Last' }]} />);
      const lastItem = screen.getByText('Last');
      expect(lastItem.className).toContain('font-medium');
    });
  });

  describe('edge cases', () => {
    it('renders single-item breadcrumb without separators', () => {
      const { container } = render(<Breadcrumb items={[{ label: 'Dashboard' }]} />);
      expect(screen.getByText('Dashboard')).toBeDefined();
      expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(0);
    });

    it('renders empty items array without crashing', () => {
      const { container } = render(<Breadcrumb items={[]} />);
      const nav = container.querySelector('nav');
      expect(nav).not.toBeNull();
      // No children rendered
      expect(nav?.children.length).toBe(0);
    });
  });
});
