import { render, screen } from '@testing-library/react';

const mockPathname = vi.fn(() => '/memory/browser');
const mockUseQuery = vi.fn(() => ({
  data: {
    stats: {
      totalFacts: 12,
      pendingConsolidation: 3,
    },
  },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

vi.mock('@/lib/queries', () => ({
  memoryStatsQuery: () => ({ queryKey: ['memory', 'stats'] }),
}));

import { MemorySidebar } from './MemorySidebar';

describe('MemorySidebar', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockPathname.mockReturnValue('/memory/browser');
  });

  it('renders memory route links', () => {
    render(<MemorySidebar />);

    expect(screen.getByRole('link', { name: /Browser/i }).getAttribute('href')).toBe(
      '/memory/browser',
    );
    expect(screen.getByRole('link', { name: /Graph/i }).getAttribute('href')).toBe(
      '/memory/graph',
    );
    expect(screen.getByRole('link', { name: /Scopes/i }).getAttribute('href')).toBe(
      '/memory/scopes',
    );
  });

  it('shows stats-derived count badges', () => {
    render(<MemorySidebar />);

    expect(screen.getByText('12')).toBeDefined();
    expect(screen.getByText('3')).toBeDefined();
  });
});
