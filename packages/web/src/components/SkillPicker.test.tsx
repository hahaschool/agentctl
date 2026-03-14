import type { AgentSkillOverride } from '@agentctl/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockSyncCapabilities } = vi.hoisted(() => ({
  mockSyncCapabilities: vi.fn().mockResolvedValue({
    machineId: 'machine-1',
    runtime: 'claude-code',
    mcpDiscovered: 0,
    skillsDiscovered: 0,
    warnings: [],
  }),
}));

vi.mock('../lib/api', () => ({
  api: { syncCapabilities: (...args: unknown[]) => mockSyncCapabilities(...args) },
}));

const mockDiscoveredSkills = [
  {
    id: 'systematic-debugging',
    name: 'Systematic Debugging',
    description: 'Use when encountering any bug or test failure',
    path: '/home/user/.claude/skills/systematic-debugging/SKILL.md',
    source: 'global' as const,
    runtime: 'claude-code' as const,
  },
  {
    id: 'tdd',
    name: 'Test-Driven Development',
    description: 'Use when implementing features',
    path: '/project/.claude/skills/tdd/SKILL.md',
    source: 'project' as const,
    runtime: 'claude-code' as const,
    userInvokable: true,
  },
];

vi.mock('../lib/queries', () => ({
  skillDiscoverQuery: vi.fn(() => ({
    queryKey: ['skills', 'discover', 'machine-1', 'claude-code'],
    queryFn: () =>
      Promise.resolve({
        ok: true,
        discovered: mockDiscoveredSkills,
        cached: false,
      }),
    enabled: true,
    staleTime: 30_000,
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

import { SkillPicker } from './SkillPicker';

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

function renderPicker(overrideProps: Partial<React.ComponentProps<typeof SkillPicker>> = {}) {
  const onChange = overrideProps.onChange ?? vi.fn();
  const props = {
    machineId: 'machine-1',
    runtime: 'claude-code' as const,
    currentOverrides: { excluded: [], custom: [] } as AgentSkillOverride,
    onChange,
    ...overrideProps,
  };

  const qc = createQueryClient();
  const result = render(
    <QueryClientProvider client={qc}>
      <SkillPicker {...props} />
    </QueryClientProvider>,
  );

  return { ...result, onChange };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SkillPicker', () => {
  it('renders collapsed by default with Skills label', () => {
    renderPicker();
    expect(screen.getByText('Skills')).toBeDefined();
  });

  it('renders discovered skills with metadata', async () => {
    renderPicker();
    fireEvent.click(screen.getByText('Skills'));

    await vi.waitFor(() => {
      expect(screen.getByText('Systematic Debugging')).toBeDefined();
      expect(screen.getByText('Test-Driven Development')).toBeDefined();
    });

    // Check descriptions are shown
    expect(screen.getByText('Use when encountering any bug or test failure')).toBeDefined();
    expect(screen.getByText('Use when implementing features')).toBeDefined();
  });

  it('all skills are checked by default (opt-out model)', async () => {
    const { container } = renderPicker();
    fireEvent.click(screen.getByText('Skills'));

    await vi.waitFor(() => {
      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    });

    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    for (const cb of checkboxes) {
      expect((cb as HTMLInputElement).checked).toBe(true);
    }
  });

  it('toggles skill exclusion', async () => {
    const onChange = vi.fn();
    const { container } = renderPicker({ onChange });

    fireEvent.click(screen.getByText('Skills'));

    await vi.waitFor(() => {
      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    });

    // Uncheck the first skill
    const firstCheckbox = container.querySelectorAll(
      'input[type="checkbox"]',
    )[0] as HTMLInputElement;
    fireEvent.click(firstCheckbox);

    expect(onChange).toHaveBeenCalledWith({
      excluded: ['systematic-debugging'],
      custom: [],
    });
  });

  it('shows source badges', async () => {
    renderPicker();
    fireEvent.click(screen.getByText('Skills'));

    await vi.waitFor(() => {
      expect(screen.getByText('Systematic Debugging')).toBeDefined();
    });

    const badges = screen.getAllByTestId('badge');
    const badgeTexts = badges.map((b) => b.textContent);

    expect(badgeTexts.some((t) => t === 'global')).toBe(true);
    expect(badgeTexts.some((t) => t === 'project')).toBe(true);
  });

  it('shows invokable badge for user-invokable skills', async () => {
    renderPicker();
    fireEvent.click(screen.getByText('Skills'));

    await vi.waitFor(() => {
      expect(screen.getByText('Test-Driven Development')).toBeDefined();
    });

    const badges = screen.getAllByTestId('badge');
    const badgeTexts = badges.map((b) => b.textContent);
    expect(badgeTexts.some((t) => t === 'invokable')).toBe(true);
  });

  it('shows group headers (Global / Project)', async () => {
    renderPicker();
    fireEvent.click(screen.getByText('Skills'));

    await vi.waitFor(() => {
      expect(screen.getByText('Global')).toBeDefined();
      expect(screen.getByText('Project')).toBeDefined();
    });
  });

  it('adds custom skill via form', async () => {
    const onChange = vi.fn();
    renderPicker({ onChange });

    fireEvent.click(screen.getByText('Skills'));
    fireEvent.click(screen.getByText('+ Custom Skill'));

    const idInput = screen.getByPlaceholderText('e.g. my-skill');
    const pathInput = screen.getByPlaceholderText('e.g. /path/to/SKILL.md');

    fireEvent.change(idInput, { target: { value: 'my-custom' } });
    fireEvent.change(pathInput, { target: { value: '/skills/my-custom/SKILL.md' } });
    fireEvent.click(screen.getByText('Add'));

    expect(onChange).toHaveBeenCalledWith({
      excluded: [],
      custom: [
        {
          id: 'my-custom',
          path: '/skills/my-custom/SKILL.md',
          enabled: true,
          name: 'my-custom',
        },
      ],
    });
  });

  it('removes custom skill when remove button clicked', async () => {
    const onChange = vi.fn();
    renderPicker({
      onChange,
      currentOverrides: {
        excluded: [],
        custom: [{ id: 'removable', path: '/skills/removable', enabled: true, name: 'removable' }],
      },
    });

    fireEvent.click(screen.getByText('Skills'));

    await vi.waitFor(() => {
      expect(screen.getByText('removable')).toBeDefined();
    });

    const removeBtn = screen.getByText('x');
    fireEvent.click(removeBtn);

    expect(onChange).toHaveBeenCalledWith({
      excluded: [],
      custom: [],
    });
  });

  it('Refresh button triggers sync-capabilities then refetches discovery', async () => {
    mockSyncCapabilities.mockClear();
    const { container } = renderPicker();

    // Expand the picker
    fireEvent.click(screen.getByText('Skills'));

    // Wait for discovery data to load
    await vi.waitFor(() => {
      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    });

    // Find and click the Refresh button
    const allButtons = screen.getAllByRole('button');
    const refreshBtn = allButtons.find((b) => b.textContent === 'Refresh');
    expect(refreshBtn).toBeDefined();
    if (refreshBtn) fireEvent.click(refreshBtn);

    // Wait for sync to be called
    await vi.waitFor(() => {
      expect(mockSyncCapabilities).toHaveBeenCalledWith('machine-1', 'claude-code', undefined);
    });
  });
});
