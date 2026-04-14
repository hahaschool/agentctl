import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DecompositionPreviewResponse, DecompositionResponse } from '@/lib/api';

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted mocks — declared before the component is imported
// ─────────────────────────────────────────────────────────────────────────────

const { mockUseDecomposeTaskPreview, mockUseDecomposeTask, mockToast } = vi.hoisted(() => ({
  mockUseDecomposeTaskPreview: vi.fn(),
  mockUseDecomposeTask: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), toast: vi.fn() },
}));

vi.mock('@/lib/queries', () => ({
  useDecomposeTaskPreview: () => mockUseDecomposeTaskPreview(),
  useDecomposeTask: () => mockUseDecomposeTask(),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => mockToast,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// Mock Dialog primitives to just render children when open
vi.mock('@/components/ui/dialog', () => {
  const Wrap = ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
    open !== false ? <div data-testid="mock-dialog">{children}</div> : null;
  const Pass = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Wrap,
    DialogContent: ({
      children,
      'data-testid': testId,
    }: {
      children: React.ReactNode;
      'data-testid'?: string;
    }) => <div data-testid={testId}>{children}</div>,
    DialogHeader: Pass,
    DialogFooter: Pass,
    DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  };
});

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, ...rest }: React.ComponentProps<'button'>) => (
    <button type="button" onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}));

// Lightweight lucide stubs — the real icons use forwardRef + SVG attrs
vi.mock('lucide-react', () => ({
  AlertCircle: (props: Record<string, unknown>) => <svg data-testid="icon-alert" {...props} />,
  Loader2: (props: Record<string, unknown>) => <svg data-testid="icon-loader" {...props} />,
  Sparkles: (props: Record<string, unknown>) => <svg data-testid="icon-sparkles" {...props} />,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Component under test — import AFTER mocks
// ─────────────────────────────────────────────────────────────────────────────

import { AutoDecomposeDialog } from './AutoDecomposeDialog';

// ─────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────────────

function makePreview(
  overrides: Partial<DecompositionPreviewResponse> = {},
): DecompositionPreviewResponse {
  return {
    result: {
      tasks: [
        {
          tempId: 't1',
          type: 'task',
          name: 'Design schema',
          description: 'Draft the initial DB schema',
          requiredCapabilities: ['postgres'],
          estimatedTokens: 20_000,
          timeoutMs: 1_800_000,
        },
        {
          tempId: 't2',
          type: 'task',
          name: 'Build API',
          description: 'Implement CRUD endpoints',
          requiredCapabilities: ['typescript'],
          estimatedTokens: 40_000,
          timeoutMs: 3_600_000,
        },
      ],
      edges: [{ from: 't1', to: 't2', type: 'blocks' }],
      suggestedApprovalGates: [],
      reasoning: 'Schema must come before API.',
      estimatedTotalTokens: 60_000,
      estimatedTotalCostUsd: 0.18,
    },
    validationErrors: [],
    ...overrides,
  };
}

function makeMutationMock(
  overrides: Partial<{
    mutate: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
    isPending: boolean;
    data: unknown;
    error: Error | null;
  }> = {},
) {
  return {
    mutate: overrides.mutate ?? vi.fn(),
    reset: overrides.reset ?? vi.fn(),
    isPending: overrides.isPending ?? false,
    data: overrides.data ?? undefined,
    error: overrides.error ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('AutoDecomposeDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDecomposeTaskPreview.mockReturnValue(makeMutationMock());
    mockUseDecomposeTask.mockReturnValue(makeMutationMock());
  });

  it('renders the description input seeded with initialDescription', () => {
    render(
      <AutoDecomposeDialog
        open={true}
        onOpenChange={vi.fn()}
        initialDescription="Refactor the auth module"
      />,
    );

    const textarea = screen.getByTestId('auto-decompose-description-input') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Refactor the auth module');
  });

  it('fires preview mutation with the trimmed description when Preview clicked', () => {
    const previewMutate = vi.fn();
    mockUseDecomposeTaskPreview.mockReturnValue(makeMutationMock({ mutate: previewMutate }));

    render(
      <AutoDecomposeDialog
        open={true}
        onOpenChange={vi.fn()}
        initialDescription="  Build OAuth flow   "
      />,
    );

    fireEvent.click(screen.getByTestId('auto-decompose-preview-button'));

    expect(previewMutate).toHaveBeenCalledTimes(1);
    expect(previewMutate.mock.calls[0][0]).toEqual({ description: 'Build OAuth flow' });
  });

  it('disables the Preview button when the description is too short', () => {
    render(<AutoDecomposeDialog open={true} onOpenChange={vi.fn()} initialDescription="hi" />);

    const previewBtn = screen.getByTestId('auto-decompose-preview-button') as HTMLButtonElement;
    expect(previewBtn.disabled).toBe(true);
  });

  it('renders proposed subtasks after a successful preview', () => {
    mockUseDecomposeTaskPreview.mockReturnValue(makeMutationMock({ data: makePreview() }));

    render(
      <AutoDecomposeDialog
        open={true}
        onOpenChange={vi.fn()}
        initialDescription="Ship a feature"
      />,
    );

    expect(screen.getByTestId('proposed-task-t1')).toBeTruthy();
    expect(screen.getByTestId('proposed-task-t2')).toBeTruthy();
    // "Design schema" appears both as task name and in t2's dependency list
    expect(screen.getAllByText(/Design schema/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/depends on: Design schema/)).toBeTruthy();

    const applyBtn = screen.getByTestId('auto-decompose-apply-button') as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(false);
  });

  it('fires the apply mutation with description and spaceId when Apply clicked', () => {
    const applyMutate = vi.fn();
    mockUseDecomposeTaskPreview.mockReturnValue(makeMutationMock({ data: makePreview() }));
    mockUseDecomposeTask.mockReturnValue(makeMutationMock({ mutate: applyMutate }));

    render(
      <AutoDecomposeDialog
        open={true}
        onOpenChange={vi.fn()}
        initialDescription="Build billing integration"
        spaceId="space-42"
      />,
    );

    fireEvent.click(screen.getByTestId('auto-decompose-apply-button'));

    expect(applyMutate).toHaveBeenCalledTimes(1);
    expect(applyMutate.mock.calls[0][0]).toEqual({
      description: 'Build billing integration',
      spaceId: 'space-42',
    });
  });

  it('shows a preview error banner when preview fails', () => {
    mockUseDecomposeTaskPreview.mockReturnValue(
      makeMutationMock({ error: new Error('LLM provider timeout') }),
    );

    render(
      <AutoDecomposeDialog
        open={true}
        onOpenChange={vi.fn()}
        initialDescription="Reindex memories"
      />,
    );

    const err = screen.getByTestId('auto-decompose-preview-error');
    expect(err.textContent ?? '').toMatch(/LLM provider timeout/);

    const applyBtn = screen.getByTestId('auto-decompose-apply-button') as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
  });

  it('shows the empty-result message when the model returns zero tasks', () => {
    mockUseDecomposeTaskPreview.mockReturnValue(
      makeMutationMock({
        data: makePreview({
          result: {
            tasks: [],
            edges: [],
            suggestedApprovalGates: [],
            reasoning: 'Task is too vague.',
            estimatedTotalTokens: 0,
            estimatedTotalCostUsd: 0,
          },
        }),
      }),
    );

    render(
      <AutoDecomposeDialog open={true} onOpenChange={vi.fn()} initialDescription="Do the thing" />,
    );

    expect(screen.getByTestId('decompose-empty-result')).toBeTruthy();
    const applyBtn = screen.getByTestId('auto-decompose-apply-button') as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
  });

  it('calls onApplied and onOpenChange(false) on a successful apply', () => {
    const applyResponse: DecompositionResponse = {
      graphId: 'graph-new-1',
      definitionIdMap: { t1: 'def-1', t2: 'def-2' },
      result: makePreview().result,
      validationErrors: [],
    };

    const applyMutate = vi.fn(
      (_input, opts?: { onSuccess?: (d: DecompositionResponse) => void }) => {
        opts?.onSuccess?.(applyResponse);
      },
    );

    mockUseDecomposeTaskPreview.mockReturnValue(makeMutationMock({ data: makePreview() }));
    mockUseDecomposeTask.mockReturnValue(makeMutationMock({ mutate: applyMutate }));

    const onApplied = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <AutoDecomposeDialog
        open={true}
        onOpenChange={onOpenChange}
        onApplied={onApplied}
        initialDescription="Build the thing"
      />,
    );

    fireEvent.click(screen.getByTestId('auto-decompose-apply-button'));

    expect(onApplied).toHaveBeenCalledWith('graph-new-1');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockToast.success).toHaveBeenCalled();
  });
});
