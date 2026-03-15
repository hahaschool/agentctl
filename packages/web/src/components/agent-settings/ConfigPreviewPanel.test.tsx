import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockUseQuery = vi.fn();

vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (...args: unknown[]) => mockUseQuery(...args),
  };
});

vi.mock('@/lib/api', () => ({
  api: {
    getAgentConfigPreview: vi.fn(),
  },
}));

vi.mock('./ConfigFileCard', () => ({
  ConfigFileCard: ({ path, status }: { path: string; status: string; defaultOpen?: boolean }) => (
    <div data-testid="config-file-card">
      {path}:{status}
    </div>
  ),
}));

import { ConfigPreviewPanel } from './ConfigPreviewPanel';

afterEach(() => {
  mockUseQuery.mockReset();
});

describe('ConfigPreviewPanel', () => {
  it('is hidden for unmanaged runtime', () => {
    const { container } = render(<ConfigPreviewPanel agentId="agent-1" runtime="nanoclaw" />);

    expect(container.innerHTML).toBe('');
    expect(mockUseQuery).not.toHaveBeenCalled();
  });

  it('renders loading skeletons while query is loading', () => {
    mockUseQuery.mockReturnValue({
      isLoading: true,
      error: null,
      data: undefined,
    });

    const { container } = render(<ConfigPreviewPanel agentId="agent-1" runtime="claude-code" />);

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3);
  });

  it('renders offline error message when query fails', () => {
    mockUseQuery.mockReturnValue({
      isLoading: false,
      error: new Error('worker offline'),
      data: undefined,
    });

    render(<ConfigPreviewPanel agentId="agent-1" runtime="codex" />);

    expect(screen.getByText('Preview unavailable — worker offline')).toBeDefined();
  });

  it('renders file cards from preview data', () => {
    mockUseQuery.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        files: [
          {
            path: '.claude/settings.json',
            scope: 'home',
            content: '{}',
            status: 'managed',
          },
          {
            path: '.mcp.json',
            scope: 'workspace',
            content: '{}',
            status: 'merged',
          },
        ],
      },
    });

    render(<ConfigPreviewPanel agentId="agent-1" runtime="claude-code" />);

    expect(screen.getByText('Config Preview (2 files)')).toBeDefined();
    expect(screen.getAllByTestId('config-file-card')).toHaveLength(2);
  });
});
