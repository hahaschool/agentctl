import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUseQuery, mockImportStatusQuery, mockStartMutate, mockCancelMutate, mockPreviewMutate } =
  vi.hoisted(() => ({
    mockUseQuery: vi.fn(),
    mockImportStatusQuery: vi.fn(),
    mockStartMutate: vi.fn(),
    mockCancelMutate: vi.fn(),
    mockPreviewMutate: vi.fn(),
  }));

vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (options: unknown) => mockUseQuery(options),
  };
});

vi.mock('@/lib/queries', () => ({
  importStatusQuery: (isRunning: boolean) => mockImportStatusQuery(isRunning),
  useStartImport: () => ({
    mutateAsync: mockStartMutate,
    isPending: false,
  }),
  useCancelImport: () => ({
    mutate: mockCancelMutate,
    isPending: false,
  }),
  usePreviewImport: () => ({
    mutateAsync: mockPreviewMutate,
    isPending: false,
  }),
}));

import { MemoryImportView } from './MemoryImportView';

const MOCK_PREVIEW = {
  ok: true,
  preview: {
    totalObservations: 100,
    byType: { decision: 40, bugfix: 30, feature: 30 },
    alreadyImported: 10,
    newToImport: 90,
    sampleTitles: ['Sample observation 1', 'Sample observation 2'],
  },
};

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryImportView />
    </QueryClientProvider>,
  );
}

describe('MemoryImportView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockImportStatusQuery.mockReturnValue({ queryKey: ['memory', 'import', 'status'] });
    mockUseQuery.mockReturnValue({ data: { job: null }, isLoading: false, isError: false });
    mockStartMutate.mockResolvedValue({ job: { id: 'job-1', status: 'running' } });
    mockPreviewMutate.mockResolvedValue(MOCK_PREVIEW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Step 1
  // ---------------------------------------------------------------------------

  describe('Step 1 — Source Detection', () => {
    it('renders the page title', () => {
      renderView();
      expect(screen.getByText('Memory Import')).toBeDefined();
    });

    it('renders the source selector buttons', () => {
      renderView();
      expect(screen.getByTestId('source-claude-mem')).toBeDefined();
      expect(screen.getByTestId('source-jsonl-history')).toBeDefined();
    });

    it('renders the db path input with default path', () => {
      renderView();
      const input = screen.getByTestId('db-path-input') as HTMLInputElement;
      expect(input).toBeDefined();
      expect(input.value).toBe('~/.claude-mem/claude-mem.db');
    });

    it('next button is disabled when path is cleared', () => {
      renderView();
      const input = screen.getByTestId('db-path-input');
      fireEvent.change(input, { target: { value: '' } });
      const next = screen.getByTestId('step1-next') as HTMLButtonElement;
      expect(next.disabled).toBe(true);
    });

    it('next button is enabled when path is filled', () => {
      renderView();
      const next = screen.getByTestId('step1-next') as HTMLButtonElement;
      // Default path is populated, so button should be enabled
      expect(next.disabled).toBe(false);
    });

    it('switches source on button click', () => {
      renderView();
      const jsonlBtn = screen.getByTestId('source-jsonl-history');
      fireEvent.click(jsonlBtn);
      expect(jsonlBtn.className).toContain('border-blue-500');
    });

    it('advances to step 2 when preview succeeds', async () => {
      renderView();
      const input = screen.getByTestId('db-path-input');
      fireEvent.change(input, { target: { value: '/tmp/x.db' } });
      fireEvent.click(screen.getByTestId('step1-next'));
      await waitFor(() => {
        expect(screen.getByTestId('step2-start')).toBeDefined();
      });
    });

    it('shows error when preview fails', async () => {
      mockPreviewMutate.mockResolvedValue({ ok: false, error: 'File not found' });
      renderView();
      fireEvent.click(screen.getByTestId('step1-next'));
      await waitFor(() => {
        expect(screen.getByTestId('preview-error')).toBeDefined();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Step 2
  // ---------------------------------------------------------------------------

  describe('Step 2 — Preview Mapping', () => {
    async function goToStep2() {
      renderView();
      const input = screen.getByTestId('db-path-input');
      fireEvent.change(input, { target: { value: '/tmp/x.db' } });
      fireEvent.click(screen.getByTestId('step1-next'));
      await waitFor(() => {
        expect(screen.getByTestId('step2-back')).toBeDefined();
      });
    }

    it('renders the type mapping table', async () => {
      await goToStep2();
      expect(screen.getByText('Source type')).toBeDefined();
      expect(screen.getByText('Maps to')).toBeDefined();
    });

    it('renders preview stats', async () => {
      await goToStep2();
      expect(screen.getByText('Total observations')).toBeDefined();
      expect(screen.getByText('New to import')).toBeDefined();
    });

    it('renders back button', async () => {
      await goToStep2();
      expect(screen.getByTestId('step2-back')).toBeDefined();
    });

    it('goes back to step 1 on back click', async () => {
      await goToStep2();
      fireEvent.click(screen.getByTestId('step2-back'));
      expect(screen.getByTestId('step1-next')).toBeDefined();
    });

    it('calls startImport when start is clicked', async () => {
      await goToStep2();
      fireEvent.click(screen.getByTestId('step2-start'));
      await waitFor(() => {
        expect(mockStartMutate).toHaveBeenCalledWith({ source: 'claude-mem', dbPath: '/tmp/x.db' });
      });
    });

    it('advances to step 3 after start succeeds', async () => {
      await goToStep2();
      fireEvent.click(screen.getByTestId('step2-start'));
      await waitFor(() => {
        expect(screen.getByTestId('progress-bar')).toBeDefined();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Step 3
  // ---------------------------------------------------------------------------

  describe('Step 3 — Progress', () => {
    async function goToStep3() {
      renderView();
      const input = screen.getByTestId('db-path-input');
      fireEvent.change(input, { target: { value: '/tmp/x.db' } });
      fireEvent.click(screen.getByTestId('step1-next'));
      await waitFor(() => screen.getByTestId('step2-start'));
      fireEvent.click(screen.getByTestId('step2-start'));
      await waitFor(() => screen.getByTestId('progress-bar'));
    }

    it('renders a progress bar', async () => {
      await goToStep3();
      expect(screen.getByTestId('progress-bar')).toBeDefined();
    });

    it('renders a cancel button while running', async () => {
      mockUseQuery.mockReturnValue({
        data: {
          job: {
            id: 'job-1',
            status: 'running',
            progress: { current: 50, total: 100 },
            imported: 30,
            skipped: 0,
            errors: 0,
          },
        },
        isLoading: false,
      });
      await goToStep3();
      await waitFor(() => {
        expect(screen.getByTestId('cancel-import')).toBeDefined();
      });
    });

    it('calls cancelImport when cancel is clicked', async () => {
      mockUseQuery.mockReturnValue({
        data: {
          job: {
            id: 'job-1',
            status: 'running',
            progress: { current: 50, total: 100 },
            imported: 30,
            skipped: 0,
            errors: 0,
          },
        },
        isLoading: false,
      });
      await goToStep3();
      await waitFor(() => screen.getByTestId('cancel-import'));
      fireEvent.click(screen.getByTestId('cancel-import'));
      expect(mockCancelMutate).toHaveBeenCalledWith('job-1');
    });
  });

  // ---------------------------------------------------------------------------
  // Step 4
  // ---------------------------------------------------------------------------

  describe('Step 4 — Summary', () => {
    it('renders the summary after completion', async () => {
      mockUseQuery.mockReturnValue({
        data: {
          job: {
            id: 'job-1',
            status: 'completed',
            progress: { current: 100, total: 100 },
            imported: 42,
            skipped: 3,
            errors: 0,
          },
        },
        isLoading: false,
      });

      renderView();
      const input = screen.getByTestId('db-path-input');
      fireEvent.change(input, { target: { value: '/tmp/x.db' } });
      fireEvent.click(screen.getByTestId('step1-next'));
      await waitFor(() => screen.getByTestId('step2-start'));
      fireEvent.click(screen.getByTestId('step2-start'));

      await waitFor(() => {
        expect(screen.getByTestId('import-summary')).toBeDefined();
      });
    });

    it('renders the start-over button', async () => {
      mockUseQuery.mockReturnValue({
        data: {
          job: {
            id: 'job-1',
            status: 'completed',
            progress: { current: 100, total: 100 },
            imported: 10,
            skipped: 0,
            errors: 0,
          },
        },
        isLoading: false,
      });

      renderView();
      const input = screen.getByTestId('db-path-input');
      fireEvent.change(input, { target: { value: '/tmp/x.db' } });
      fireEvent.click(screen.getByTestId('step1-next'));
      await waitFor(() => screen.getByTestId('step2-start'));
      fireEvent.click(screen.getByTestId('step2-start'));

      await waitFor(() => screen.getByTestId('import-summary'));
      expect(screen.getByTestId('start-over')).toBeDefined();
    });

    it('clicking start-over returns to step 1', async () => {
      mockUseQuery.mockReturnValue({
        data: {
          job: {
            id: 'job-1',
            status: 'completed',
            progress: { current: 100, total: 100 },
            imported: 5,
            skipped: 0,
            errors: 0,
          },
        },
        isLoading: false,
      });

      renderView();
      const input = screen.getByTestId('db-path-input');
      fireEvent.change(input, { target: { value: '/tmp/x.db' } });
      fireEvent.click(screen.getByTestId('step1-next'));
      await waitFor(() => screen.getByTestId('step2-start'));
      fireEvent.click(screen.getByTestId('step2-start'));

      await waitFor(() => screen.getByTestId('import-summary'));
      fireEvent.click(screen.getByTestId('start-over'));
      expect(screen.getByTestId('step1-next')).toBeDefined();
    });
  });
});
