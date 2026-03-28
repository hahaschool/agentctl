import type React from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SessionConfigTab } from './SessionConfigTab';

// Mock the query module — return a queryOptions-shaped object whose queryFn we control
const mockQueryFn = vi.fn();
vi.mock('@/lib/queries', () => ({
  sessionDispatchConfigQuery: (_id: string) => ({
    queryKey: ['sessions', _id, 'dispatch-config'],
    queryFn: () => mockQueryFn(),
    enabled: true,
    staleTime: 60_000,
  }),
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('SessionConfigTab', () => {
  it('shows empty state when no runs exist', async () => {
    mockQueryFn.mockResolvedValue({ runId: null, runCount: 0, config: null });
    renderWithClient(<SessionConfigTab sessionId="test-session" />);
    await waitFor(() => {
      expect(screen.getByText(/no associated agent run/i)).toBeDefined();
    });
  });

  it('shows pre-feature message when config is null but run exists', async () => {
    mockQueryFn.mockResolvedValue({ runId: 'run-1', runCount: 1, config: null });
    renderWithClient(<SessionConfigTab sessionId="test-session" />);
    await waitFor(() => {
      expect(screen.getByText(/pre-feature data/i)).toBeDefined();
    });
  });

  it('renders config sections when data is present', async () => {
    mockQueryFn.mockResolvedValue({
      runId: 'run-1',
      runCount: 1,
      config: {
        model: 'claude-opus-4-6',
        permissionMode: 'bypassPermissions',
        allowedTools: null,
        mcpServers: {
          slack: { command: 'slack-mcp-server', args: ['--transport', 'stdio'], envKeys: ['SLACK_TOKEN'] },
        },
        systemPrompt: null,
        defaultPrompt: 'start processing',
        instructionsStrategy: null,
        mcpServerCount: 1,
        accountProvider: 'claude_team',
      },
    });
    renderWithClient(<SessionConfigTab sessionId="test-session" />);
    await waitFor(() => {
      expect(screen.getByText('claude-opus-4-6')).toBeDefined();
      expect(screen.getByText('bypassPermissions')).toBeDefined();
      expect(screen.getByText('slack')).toBeDefined();
      expect(screen.getByText(/SLACK_TOKEN/)).toBeDefined();
      expect(screen.getByText('start processing')).toBeDefined();
    });
  });

  it('shows multi-run indicator when runCount > 1', async () => {
    mockQueryFn.mockResolvedValue({
      runId: 'run-2',
      runCount: 3,
      config: {
        model: 'sonnet',
        permissionMode: null,
        allowedTools: null,
        mcpServers: null,
        systemPrompt: null,
        defaultPrompt: null,
        instructionsStrategy: null,
        mcpServerCount: 0,
        accountProvider: null,
      },
    });
    renderWithClient(<SessionConfigTab sessionId="test-session" />);
    await waitFor(() => {
      expect(screen.getByText(/1 of 3 runs/)).toBeDefined();
    });
  });
});
