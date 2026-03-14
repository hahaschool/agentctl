import type { AgentMcpOverride } from '@agentctl/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDiscovered = [
  {
    name: 'filesystem',
    config: { command: 'npx', args: ['-y', '@mcp/filesystem'] },
    source: 'global' as const,
    configFile: '~/.claude.json',
  },
  {
    name: 'github',
    config: { command: 'npx', args: ['-y', '@mcp/github'] },
    source: 'project' as const,
    configFile: '/project/.mcp.json',
  },
];

vi.mock('../lib/queries', () => ({
  mcpDiscoverQuery: vi.fn(() => ({
    queryKey: ['mcp', 'discover', 'machine-1', 'claude-code'],
    queryFn: () =>
      Promise.resolve({
        discovered: mockDiscovered,
        sources: [],
      }),
    enabled: true,
    staleTime: 30_000,
  })),
  mcpTemplatesQuery: vi.fn(() => ({
    queryKey: ['mcp', 'templates'],
    queryFn: () => Promise.resolve({ ok: true, templates: [], count: 0 }),
    staleTime: 300_000,
  })),
}));

vi.mock('./ui/badge', () => ({
  Badge: ({ children, ...props }: { children: React.ReactNode; variant?: string }) => (
    <span data-testid="badge" {...props}>
      {children}
    </span>
  ),
}));

vi.mock('./ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    type?: string;
    variant?: string;
    size?: string;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock('./ui/input', () => ({
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { McpServerPicker } from './McpServerPicker';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function renderPicker(overrideProps: Partial<React.ComponentProps<typeof McpServerPicker>> = {}) {
  const onChange = overrideProps.onChange ?? vi.fn();
  const props = {
    machineId: 'machine-1',
    runtime: 'claude-code' as const,
    currentOverrides: { excluded: [], custom: [] } as AgentMcpOverride,
    onChange,
    ...overrideProps,
  };

  const qc = createQueryClient();
  const result = render(
    <QueryClientProvider client={qc}>
      <McpServerPicker {...props} />
    </QueryClientProvider>,
  );

  return { ...result, onChange };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('McpServerPicker', () => {
  it('renders collapsed by default with MCP Servers label', () => {
    renderPicker();
    expect(screen.getByText('MCP Servers')).toBeDefined();
  });

  it('expands on click and shows loading state', () => {
    renderPicker();
    fireEvent.click(screen.getByText('MCP Servers'));
    // After expand, the query should be enabled and show loading
    expect(screen.getByText('MCP Servers')).toBeDefined();
  });

  it('renders discovered servers as checked (inherited) when no exclusions', async () => {
    const { container } = renderPicker();
    // Expand the picker
    fireEvent.click(screen.getByText('MCP Servers'));

    // Wait for query to resolve
    await vi.waitFor(() => {
      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    });

    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    // All discovered servers should be checked
    for (const cb of checkboxes) {
      expect((cb as HTMLInputElement).checked).toBe(true);
    }
  });

  it('adds server to excluded when unchecked', async () => {
    const onChange = vi.fn();
    const { container } = renderPicker({ onChange });

    fireEvent.click(screen.getByText('MCP Servers'));

    await vi.waitFor(() => {
      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    });

    // Uncheck the first server (filesystem)
    const firstCheckbox = container.querySelectorAll(
      'input[type="checkbox"]',
    )[0] as HTMLInputElement;
    fireEvent.click(firstCheckbox);

    expect(onChange).toHaveBeenCalledWith({
      excluded: ['filesystem'],
      custom: [],
    });
  });

  it('removes server from excluded when re-checked', async () => {
    const onChange = vi.fn();
    const { container } = renderPicker({
      onChange,
      currentOverrides: { excluded: ['filesystem'], custom: [] },
    });

    fireEvent.click(screen.getByText('MCP Servers'));

    await vi.waitFor(() => {
      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    });

    // The first server should be unchecked (excluded)
    const firstCheckbox = container.querySelectorAll(
      'input[type="checkbox"]',
    )[0] as HTMLInputElement;
    expect(firstCheckbox.checked).toBe(false);

    // Re-check it
    fireEvent.click(firstCheckbox);

    expect(onChange).toHaveBeenCalledWith({
      excluded: [],
      custom: [],
    });
  });

  it('shows inherited/excluded/custom badges', async () => {
    renderPicker({
      currentOverrides: {
        excluded: ['filesystem'],
        custom: [{ name: 'my-custom', command: 'node', args: ['server.js'] }],
      },
    });

    fireEvent.click(screen.getByText('MCP Servers'));

    await vi.waitFor(() => {
      expect(screen.getByText('filesystem')).toBeDefined();
    });

    // Check that badges are present
    const badges = screen.getAllByTestId('badge');
    const badgeTexts = badges.map((b) => b.textContent);

    // Should have "machine default", "project", "excluded", "custom" badges
    expect(badgeTexts.some((t) => t === 'machine default')).toBe(true);
    expect(badgeTexts.some((t) => t === 'excluded')).toBe(true);
    expect(badgeTexts.some((t) => t === 'custom')).toBe(true);
  });

  it('renders custom servers from overrides', async () => {
    renderPicker({
      currentOverrides: {
        excluded: [],
        custom: [{ name: 'my-custom-server', command: 'node', args: ['custom.js'] }],
      },
    });

    fireEvent.click(screen.getByText('MCP Servers'));

    await vi.waitFor(() => {
      expect(screen.getByText('my-custom-server')).toBeDefined();
    });
  });

  it('adds custom server via form', async () => {
    const onChange = vi.fn();
    renderPicker({ onChange });

    fireEvent.click(screen.getByText('MCP Servers'));
    fireEvent.click(screen.getByText('+ Custom Server'));

    const nameInput = screen.getByPlaceholderText('e.g. my-server');
    const cmdInput = screen.getByPlaceholderText('e.g. npx');

    fireEvent.change(nameInput, { target: { value: 'new-server' } });
    fireEvent.change(cmdInput, { target: { value: 'node' } });
    fireEvent.click(screen.getByText('Add'));

    expect(onChange).toHaveBeenCalledWith({
      excluded: [],
      custom: [{ name: 'new-server', command: 'node' }],
    });
  });

  it('removes custom server when remove button clicked', async () => {
    const onChange = vi.fn();
    renderPicker({
      onChange,
      currentOverrides: {
        excluded: [],
        custom: [{ name: 'removable', command: 'echo' }],
      },
    });

    fireEvent.click(screen.getByText('MCP Servers'));

    await vi.waitFor(() => {
      expect(screen.getByText('removable')).toBeDefined();
    });

    // Click the "x" remove button
    const removeBtn = screen.getByText('x');
    fireEvent.click(removeBtn);

    expect(onChange).toHaveBeenCalledWith({
      excluded: [],
      custom: [],
    });
  });
});
