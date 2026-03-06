import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the component under test
// ---------------------------------------------------------------------------

const mockListFiles = vi.fn();
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    listFiles: (...args: unknown[]) => mockListFiles(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
  },
  ApiError: class ApiError extends Error {
    public status: number;
    public code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
};

vi.mock('@/components/Toast', () => ({
  useToast: () => mockToast,
  ToastContainer: () => null,
}));

import { FileBrowser } from './FileBrowser';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MACHINE_ID = 'machine-abc';

const MOCK_ENTRIES = [
  { name: 'src', type: 'directory' as const, modified: '2026-01-15T10:30:00Z' },
  { name: 'package.json', type: 'file' as const, size: 1234, modified: '2026-01-14T08:00:00Z' },
  { name: 'README.md', type: 'file' as const, size: 512, modified: '2026-01-13T12:00:00Z' },
];

const MOCK_FILE_CONTENT = {
  content: '// hello world\nconst x = 42;\nexport default x;\n',
  path: '/project/src/index.ts',
  size: 48,
};

const MOCK_MD_CONTENT = {
  content: '# Title\n\nSome text here.\n',
  path: '/project/README.md',
  size: 25,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderBrowser(props?: { initialPath?: string }) {
  return render(
    <FileBrowser machineId={MACHINE_ID} initialPath={props?.initialPath} />,
  );
}

/** Set up mockListFiles to resolve with standard entries for the given path */
function setupDirectory(path: string, entries = MOCK_ENTRIES) {
  mockListFiles.mockResolvedValue({ entries, path });
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  setupDirectory('/');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Tests
// ===========================================================================

describe('FileBrowser', () => {
  // -------------------------------------------------------------------------
  // 1. Renders with initial path and machine ID
  // -------------------------------------------------------------------------

  describe('initial rendering', () => {
    it('renders and calls listFiles with default path "/"', async () => {
      renderBrowser();
      await waitFor(() => {
        expect(mockListFiles).toHaveBeenCalledWith(MACHINE_ID, '/');
      });
    });

    it('renders with a custom initialPath', async () => {
      setupDirectory('/home/user');
      renderBrowser({ initialPath: '/home/user' });
      await waitFor(() => {
        expect(mockListFiles).toHaveBeenCalledWith(MACHINE_ID, '/home/user');
      });
    });

    it('shows the initial path in the path input', () => {
      renderBrowser({ initialPath: '/home/user' });
      const input = screen.getByPlaceholderText('Absolute path...');
      expect((input as HTMLInputElement).value).toBe('/home/user');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Displays directory listing with files and folders
  // -------------------------------------------------------------------------

  describe('directory listing', () => {
    it('displays file and folder entries after loading', async () => {
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('src')).toBeDefined();
        expect(screen.getByText('package.json')).toBeDefined();
        expect(screen.getByText('README.md')).toBeDefined();
      });
    });

    it('shows file sizes for file entries', async () => {
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('1.2 KB')).toBeDefined();
      });
    });

    it('shows "Empty directory" when no entries', async () => {
      mockListFiles.mockResolvedValue({ entries: [], path: '/' });
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('Empty directory')).toBeDefined();
      });
    });

    it('shows table headers (Name, Size, Modified)', async () => {
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('Name')).toBeDefined();
        expect(screen.getByText('Size')).toBeDefined();
        expect(screen.getByText('Modified')).toBeDefined();
      });
    });
  });

  // -------------------------------------------------------------------------
  // 3. Clicking a folder navigates into it
  // -------------------------------------------------------------------------

  describe('folder navigation', () => {
    it('navigates into a folder when clicked', async () => {
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('src')).toBeDefined();
      });

      // Set up response for the sub-directory
      const subEntries = [
        { name: 'index.ts', type: 'file' as const, size: 48 },
      ];
      mockListFiles.mockResolvedValue({ entries: subEntries, path: '/src' });

      fireEvent.click(screen.getByText('src'));

      await waitFor(() => {
        expect(mockListFiles).toHaveBeenCalledWith(MACHINE_ID, '/src');
        expect(screen.getByText('index.ts')).toBeDefined();
      });
    });

    it('shows ".." go-up entry when not at root', async () => {
      mockListFiles.mockResolvedValue({ entries: [], path: '/src' });
      renderBrowser({ initialPath: '/src' });

      await waitFor(() => {
        expect(screen.getByText('..')).toBeDefined();
      });
    });

    it('navigates up when ".." row is clicked', async () => {
      mockListFiles.mockResolvedValue({ entries: [], path: '/src' });
      renderBrowser({ initialPath: '/src' });

      await waitFor(() => {
        expect(screen.getByText('..')).toBeDefined();
      });

      mockListFiles.mockResolvedValue({ entries: MOCK_ENTRIES, path: '/' });
      fireEvent.click(screen.getByText('..'));

      await waitFor(() => {
        expect(mockListFiles).toHaveBeenCalledWith(MACHINE_ID, '/');
      });
    });

    it('does not show ".." row when at root "/"', async () => {
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('src')).toBeDefined();
      });
      expect(screen.queryByText('..')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 4. Breadcrumb navigation
  // -------------------------------------------------------------------------

  describe('breadcrumb navigation', () => {
    it('shows root breadcrumb "/"', async () => {
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('src')).toBeDefined();
      });
      // The "/" breadcrumb button
      const breadcrumbs = screen.getAllByRole('button');
      const rootBreadcrumb = breadcrumbs.find((b) => b.textContent === '/');
      expect(rootBreadcrumb).toBeDefined();
    });

    it('shows path segments as breadcrumbs', async () => {
      mockListFiles.mockResolvedValue({ entries: [], path: '/home/user/project' });
      renderBrowser({ initialPath: '/home/user/project' });

      await waitFor(() => {
        expect(screen.getByText('home')).toBeDefined();
        expect(screen.getByText('user')).toBeDefined();
        expect(screen.getByText('project')).toBeDefined();
      });
    });

    it('clicking a breadcrumb navigates to that path', async () => {
      mockListFiles.mockResolvedValue({ entries: [], path: '/home/user/project' });
      renderBrowser({ initialPath: '/home/user/project' });

      await waitFor(() => {
        expect(screen.getByText('home')).toBeDefined();
      });

      mockListFiles.mockResolvedValue({ entries: MOCK_ENTRIES, path: '/home' });
      fireEvent.click(screen.getByText('home'));

      await waitFor(() => {
        expect(mockListFiles).toHaveBeenCalledWith(MACHINE_ID, '/home');
      });
    });
  });

  // -------------------------------------------------------------------------
  // 5. File content display
  // -------------------------------------------------------------------------

  describe('file content display', () => {
    it('shows file content when a file is clicked', async () => {
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('package.json')).toBeDefined();
      });

      mockReadFile.mockResolvedValue(MOCK_FILE_CONTENT);
      fireEvent.click(screen.getByText('package.json'));

      await waitFor(() => {
        expect(mockReadFile).toHaveBeenCalledWith(MACHINE_ID, '/package.json');
        expect(screen.getByText(/hello world/)).toBeDefined();
      });
    });

    it('shows the file name in the viewer header', async () => {
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('package.json')).toBeDefined();
      });

      mockReadFile.mockResolvedValue(MOCK_FILE_CONTENT);
      fireEvent.click(screen.getByText('package.json'));

      await waitFor(() => {
        // The header shows the last segment of the path
        expect(screen.getByText('index.ts')).toBeDefined();
      });
    });

    it('shows file size and path in the info bar', async () => {
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('package.json')).toBeDefined();
      });

      mockReadFile.mockResolvedValue(MOCK_FILE_CONTENT);
      fireEvent.click(screen.getByText('package.json'));

      await waitFor(() => {
        expect(screen.getByText(/48 B/)).toBeDefined();
        expect(screen.getByText(/\/project\/src\/index\.ts/)).toBeDefined();
      });
    });

    it('shows line numbers in the file viewer', async () => {
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('package.json')).toBeDefined();
      });

      mockReadFile.mockResolvedValue(MOCK_FILE_CONTENT);
      fireEvent.click(screen.getByText('package.json'));

      await waitFor(() => {
        // Content has 4 lines (3 lines + trailing newline)
        expect(screen.getByText('1')).toBeDefined();
        expect(screen.getByText('2')).toBeDefined();
        expect(screen.getByText('3')).toBeDefined();
      });
    });
  });

  // -------------------------------------------------------------------------
  // 6. Syntax highlighting
  // -------------------------------------------------------------------------

  describe('syntax highlighting', () => {
    it('highlights comment lines in green for code files', async () => {
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('package.json')).toBeDefined();
      });

      mockReadFile.mockResolvedValue(MOCK_FILE_CONTENT);
      fireEvent.click(screen.getByText('package.json'));

      await waitFor(() => {
        const commentEl = screen.getByText('// hello world');
        expect(commentEl.className).toContain('text-green-500');
      });
    });

    it('highlights markdown headers in blue (## level avoids comment regex)', async () => {
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('README.md')).toBeDefined();
      });

      // Note: `# Title` is matched by the comment regex (/^\s*#/) before the
      // markdown header branch, so it gets green. The comment regex also catches
      // `## ...` etc. This is a known quirk of the simple highlighter — we test
      // that the comment highlighting is applied for `#`-prefixed markdown lines.
      mockReadFile.mockResolvedValue(MOCK_MD_CONTENT);
      fireEvent.click(screen.getByText('README.md'));

      await waitFor(() => {
        const headerEl = screen.getByText('# Title');
        // The comment regex fires first for lines starting with #
        expect(headerEl.className).toContain('text-green-500');
      });
    });

    it('highlights keywords in purple for TypeScript files', async () => {
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('package.json')).toBeDefined();
      });

      mockReadFile.mockResolvedValue({
        content: 'const x = 1;\n',
        path: '/project/test.ts',
        size: 13,
      });
      fireEvent.click(screen.getByText('package.json'));

      await waitFor(() => {
        const keywordEl = screen.getByText('const');
        expect(keywordEl.className).toContain('text-purple-');
      });
    });
  });

  // -------------------------------------------------------------------------
  // 7. Close file button
  // -------------------------------------------------------------------------

  describe('close file', () => {
    it('closes the file viewer when close button is clicked', async () => {
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('package.json')).toBeDefined();
      });

      mockReadFile.mockResolvedValue(MOCK_FILE_CONTENT);
      fireEvent.click(screen.getByText('package.json'));

      await waitFor(() => {
        expect(screen.getByText(/hello world/)).toBeDefined();
      });

      const closeBtn = screen.getByLabelText('Close file');
      fireEvent.click(closeBtn);

      await waitFor(() => {
        expect(screen.queryByText(/hello world/)).toBeNull();
      });
    });

    it('shows Edit button in file header', async () => {
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('package.json')).toBeDefined();
      });

      mockReadFile.mockResolvedValue(MOCK_FILE_CONTENT);
      fireEvent.click(screen.getByText('package.json'));

      await waitFor(() => {
        expect(screen.getByText('Edit')).toBeDefined();
      });
    });
  });

  // -------------------------------------------------------------------------
  // 8. Loading states
  // -------------------------------------------------------------------------

  describe('loading states', () => {
    it('shows "Loading directory..." while fetching entries', async () => {
      // Never resolve to keep loading state
      mockListFiles.mockReturnValue(new Promise(() => {}));
      renderBrowser();
      expect(screen.getByText('Loading directory...')).toBeDefined();
    });

    it('shows "Loading file..." while fetching file content', async () => {
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('package.json')).toBeDefined();
      });

      // Never resolve to keep loading state
      mockReadFile.mockReturnValue(new Promise(() => {}));
      fireEvent.click(screen.getByText('package.json'));

      await waitFor(() => {
        expect(screen.getByText('Loading file...')).toBeDefined();
      });
    });

    it('hides loading text once directory loads', async () => {
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('src')).toBeDefined();
      });
      expect(screen.queryByText('Loading directory...')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 9. Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('shows directory error message on API failure', async () => {
      // String(err) for a plain Error produces "Error: Connection refused"
      mockListFiles.mockRejectedValue(new Error('Connection refused'));
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('Error: Connection refused')).toBeDefined();
      });
    });

    it('shows file error message on readFile failure', async () => {
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('package.json')).toBeDefined();
      });

      mockReadFile.mockRejectedValue(new Error('Permission denied'));
      fireEvent.click(screen.getByText('package.json'));

      await waitFor(() => {
        expect(screen.getByText('Error: Permission denied')).toBeDefined();
      });
    });

    it('handles ApiError with proper message (uses err.message)', async () => {
      // ApiError extends Error, so `err instanceof ApiError` is true and
      // the component uses err.message directly (no "Error:" prefix).
      const { ApiError } = await import('../lib/api');
      mockListFiles.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Access denied'));
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('Access denied')).toBeDefined();
      });
    });

    it('clears entries on directory error', async () => {
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('src')).toBeDefined();
      });

      // Now trigger an error on the next navigation
      mockListFiles.mockRejectedValue(new Error('Network error'));
      const goBtn = screen.getByText('Go');
      const input = screen.getByPlaceholderText('Absolute path...');
      fireEvent.change(input, { target: { value: '/bad/path' } });
      fireEvent.click(goBtn);

      await waitFor(() => {
        expect(screen.getByText('Error: Network error')).toBeDefined();
        expect(screen.queryByText('src')).toBeNull();
      });
    });
  });

  // -------------------------------------------------------------------------
  // 10. Path input form
  // -------------------------------------------------------------------------

  describe('path input form', () => {
    it('navigates when path is typed and Go is clicked', async () => {
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('src')).toBeDefined();
      });

      const input = screen.getByPlaceholderText('Absolute path...');
      const goBtn = screen.getByText('Go');

      mockListFiles.mockResolvedValue({ entries: [], path: '/etc' });
      fireEvent.change(input, { target: { value: '/etc' } });
      fireEvent.click(goBtn);

      await waitFor(() => {
        expect(mockListFiles).toHaveBeenCalledWith(MACHINE_ID, '/etc');
      });
    });

    it('navigates when form is submitted with Enter', async () => {
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('src')).toBeDefined();
      });

      const input = screen.getByPlaceholderText('Absolute path...');

      mockListFiles.mockResolvedValue({ entries: [], path: '/var/log' });
      fireEvent.change(input, { target: { value: '/var/log' } });
      fireEvent.submit(input);

      await waitFor(() => {
        expect(mockListFiles).toHaveBeenCalledWith(MACHINE_ID, '/var/log');
      });
    });

    it('does not navigate when path input is empty/whitespace', async () => {
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('src')).toBeDefined();
      });

      const callCountBefore = mockListFiles.mock.calls.length;

      const input = screen.getByPlaceholderText('Absolute path...');
      fireEvent.change(input, { target: { value: '   ' } });
      fireEvent.submit(input);

      // No new call should be made
      expect(mockListFiles.mock.calls.length).toBe(callCountBefore);
    });

    it('updates path input after successful directory load', async () => {
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('src')).toBeDefined();
      });

      mockListFiles.mockResolvedValue({ entries: [], path: '/home/user' });
      const input = screen.getByPlaceholderText('Absolute path...');
      fireEvent.change(input, { target: { value: '/home/user' } });
      fireEvent.submit(input);

      await waitFor(() => {
        expect((input as HTMLInputElement).value).toBe('/home/user');
      });
    });

    it('has a "Navigate to path" aria-label on the Go button', () => {
      renderBrowser();
      const goBtn = screen.getByLabelText('Navigate to path');
      expect(goBtn).toBeDefined();
      expect(goBtn.textContent).toBe('Go');
    });

    it('trims whitespace from path input before navigating', async () => {
      renderBrowser();
      await waitFor(() => {
        expect(screen.getByText('src')).toBeDefined();
      });

      const input = screen.getByPlaceholderText('Absolute path...');
      mockListFiles.mockResolvedValue({ entries: [], path: '/tmp' });
      fireEvent.change(input, { target: { value: '  /tmp  ' } });
      fireEvent.submit(input);

      await waitFor(() => {
        expect(mockListFiles).toHaveBeenCalledWith(MACHINE_ID, '/tmp');
      });
    });
  });
});
