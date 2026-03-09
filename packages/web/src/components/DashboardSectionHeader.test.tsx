import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { DashboardSectionHeader } from './DashboardSectionHeader';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DashboardSectionHeader', () => {
  describe('title rendering', () => {
    it('renders the title text', () => {
      render(<DashboardSectionHeader title="Recent Sessions" />);
      expect(screen.getByText('Recent Sessions')).toBeDefined();
    });

    it('renders title in an h2 element', () => {
      render(<DashboardSectionHeader title="Active Agents" />);
      const heading = screen.getByRole('heading', { level: 2 });
      expect(heading).toBeDefined();
      expect(heading.textContent).toBe('Active Agents');
    });

    it('renders different titles', () => {
      const { rerender } = render(<DashboardSectionHeader title="Title One" />);
      expect(screen.getByText('Title One')).toBeDefined();

      rerender(<DashboardSectionHeader title="Title Two" />);
      expect(screen.getByText('Title Two')).toBeDefined();
    });
  });

  describe('link rendering', () => {
    it('does not render a link when href is not provided', () => {
      render(<DashboardSectionHeader title="No Link" />);
      expect(screen.queryByRole('link')).toBeNull();
    });

    it('renders a "View All" link when href is provided', () => {
      render(<DashboardSectionHeader title="Sessions" href="/sessions" />);
      const link = screen.getByRole('link');
      expect(link).toBeDefined();
      expect(link.getAttribute('href')).toBe('/sessions');
    });

    it('link contains arrow text', () => {
      render(<DashboardSectionHeader title="Agents" href="/agents" />);
      const link = screen.getByRole('link');
      // The text includes "View All" and a right arrow entity
      expect(link.textContent).toContain('View All');
    });

    it('renders link to different hrefs', () => {
      const { rerender } = render(<DashboardSectionHeader title="Machines" href="/machines" />);
      let link = screen.getByRole('link');
      expect(link.getAttribute('href')).toBe('/machines');

      rerender(<DashboardSectionHeader title="Logs" href="/logs" />);
      link = screen.getByRole('link');
      expect(link.getAttribute('href')).toBe('/logs');
    });
  });

  describe('conditional link', () => {
    it('toggling href between defined and undefined', () => {
      const { rerender } = render(<DashboardSectionHeader title="Test" href="/test" />);
      expect(screen.getByRole('link')).toBeDefined();

      rerender(<DashboardSectionHeader title="Test" />);
      expect(screen.queryByRole('link')).toBeNull();
    });
  });
});
