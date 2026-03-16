import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Agent } from '@/lib/api';

const mockMutate = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock('@/lib/queries', () => ({
  useUpdateAgent: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

vi.mock('../Toast', () => ({
  useToast: () => ({
    success: mockToastSuccess,
    error: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    toast: vi.fn(),
  }),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

let selectIdCounter = 0;
const selectCallbacks = new Map<string, (value: string) => void>();

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange,
    disabled,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (value: string) => void;
    disabled?: boolean;
  }) => {
    const id = `mock-select-${selectIdCounter++}`;
    if (onValueChange) {
      selectCallbacks.set(id, onValueChange);
    }

    return (
      <div
        data-testid="mock-select"
        data-select-id={id}
        data-value={value}
        data-disabled={String(!!disabled)}
      >
        {children}
      </div>
    );
  },
  SelectTrigger: ({
    children,
    id,
  }: {
    children: React.ReactNode;
    id?: string;
    className?: string;
  }) => <div data-testid={id ? `select-trigger-${id}` : 'select-trigger'}>{children}</div>,
  SelectValue: ({
    children,
    placeholder,
  }: {
    children?: React.ReactNode;
    placeholder?: string;
  }) => <span>{children ?? placeholder}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <button
      type="button"
      data-testid={`select-item-${value}`}
      onClick={(event) => {
        let element = event.currentTarget.parentElement;
        while (element) {
          const selectId = element.getAttribute('data-select-id');
          if (selectId) {
            selectCallbacks.get(selectId)?.(value);
            break;
          }
          element = element.parentElement;
        }
      }}
    >
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children }: { children: React.ReactNode; htmlFor?: string }) => <span>{children}</span>,
}));

import { ModelPromptsTab } from './ModelPromptsTab';

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    machineId: 'machine-1',
    name: 'test-agent',
    type: 'adhoc',
    runtime: 'claude-code',
    status: 'registered',
    schedule: null,
    projectPath: '/home/user/project',
    worktreeBranch: null,
    currentSessionId: null,
    config: {},
    lastRunAt: null,
    lastCostUsd: null,
    totalCostUsd: 0,
    accountId: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('ModelPromptsTab', () => {
  afterEach(() => {
    mockMutate.mockReset();
    mockToastSuccess.mockReset();
    selectCallbacks.clear();
    selectIdCounter = 0;
  });

  it('saves a non-default instructions strategy in agent config', () => {
    render(<ModelPromptsTab agent={makeAgent()} />);

    fireEvent.click(screen.getByTestId('select-item-managed'));
    fireEvent.click(screen.getByText('Save'));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0][0]).toEqual({
      id: 'agent-1',
      config: {
        instructionsStrategy: 'managed',
      },
    });
  });

  it('removes instructionsStrategy when switched back to the project default', () => {
    render(
      <ModelPromptsTab
        agent={makeAgent({
          config: {
            instructionsStrategy: 'managed',
          },
        })}
      />,
    );

    fireEvent.click(screen.getByTestId('select-item-project'));
    fireEvent.click(screen.getByText('Save'));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0][0]).toEqual({
      id: 'agent-1',
      config: {},
    });
  });
});
