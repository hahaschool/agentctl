import { render, screen } from '@testing-library/react';

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { EmptyState } from './EmptyState';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EmptyState', () => {
  describe('title rendering', () => {
    it('renders the title text', () => {
      render(<EmptyState title="No agents found" />);
      expect(screen.getByText('No agents found')).toBeDefined();
    });
  });

  describe('description', () => {
    it('renders description when provided', () => {
      render(<EmptyState title="No sessions" description="Start a new session to get going." />);
      expect(screen.getByText('Start a new session to get going.')).toBeDefined();
    });

    it('does not render description when omitted', () => {
      render(<EmptyState title="Empty" />);
      expect(screen.queryByText(/Start a new/)).toBeNull();
    });
  });

  describe('action slot', () => {
    it('renders the action ReactNode when provided', () => {
      render(<EmptyState title="No data" action={<button type="button">Create one</button>} />);
      expect(screen.getByRole('button', { name: 'Create one' })).toBeDefined();
    });

    it('does not render action wrapper when action is omitted', () => {
      render(<EmptyState title="Nothing here" />);
      expect(screen.queryByRole('button')).toBeNull();
    });
  });

  describe('icon rendering', () => {
    it('renders a string icon (emoji)', () => {
      render(<EmptyState title="Empty" icon="📭" />);
      expect(screen.getByText('📭')).toBeDefined();
    });

    it('renders a component icon', () => {
      const MockIcon = (_props: { size?: number; className?: string }) => (
        <svg data-testid="mock-icon" />
      );
      render(<EmptyState title="Empty" icon={MockIcon} />);
      expect(screen.getByTestId('mock-icon')).toBeDefined();
    });

    it('does not render any icon area when icon is omitted', () => {
      const { container } = render(<EmptyState title="No icon" />);
      // No svg or emoji container
      expect(container.querySelector('svg')).toBeNull();
    });
  });

  describe('variant prop', () => {
    it('defaults to "default" variant with larger padding', () => {
      const { container } = render(<EmptyState title="Default" />);
      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper.className).toContain('py-16');
    });

    it('applies compact variant with smaller padding', () => {
      const { container } = render(<EmptyState title="Compact" variant="compact" />);
      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper.className).toContain('py-6');
    });

    it('renders a smaller component icon in compact mode', () => {
      const MockIcon = ({ size }: { size?: number; className?: string }) => (
        <svg data-testid="sized-icon" data-size={size} />
      );
      render(<EmptyState title="Compact" icon={MockIcon} variant="compact" />);
      const icon = screen.getByTestId('sized-icon');
      expect(icon.getAttribute('data-size')).toBe('20');
    });

    it('renders a larger component icon in default mode', () => {
      const MockIcon = ({ size }: { size?: number; className?: string }) => (
        <svg data-testid="sized-icon" data-size={size} />
      );
      render(<EmptyState title="Default" icon={MockIcon} />);
      const icon = screen.getByTestId('sized-icon');
      expect(icon.getAttribute('data-size')).toBe('28');
    });
  });

  describe('combined rendering', () => {
    it('renders all elements together: icon, title, description, action', () => {
      const MockIcon = (_props: { size?: number; className?: string }) => (
        <svg data-testid="combo-icon" />
      );
      render(
        <EmptyState
          icon={MockIcon}
          title="All Together"
          description="Everything rendered"
          action={<a href="/go">Go</a>}
        />,
      );
      expect(screen.getByTestId('combo-icon')).toBeDefined();
      expect(screen.getByText('All Together')).toBeDefined();
      expect(screen.getByText('Everything rendered')).toBeDefined();
      expect(screen.getByText('Go')).toBeDefined();
    });
  });
});
