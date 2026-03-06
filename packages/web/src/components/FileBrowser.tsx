'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useToast } from '@/components/Toast';
import { Skeleton } from '@/components/ui/skeleton';
import { formatFileSize } from '@/lib/format-utils';
import { cn } from '@/lib/utils';
import type { FileContentResponse, FileEntry, FileListResponse } from '../lib/api';
import { ApiError, api } from '../lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FileBrowserProps = {
  machineId: string;
  initialPath?: string;
};

function formatModified(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getFileExtension(path: string): string {
  const name = path.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Basic syntax-highlighted line rendering for common file types */
function highlightLine(line: string, ext: string): React.JSX.Element {
  // Comment lines
  if (/^\s*(\/\/|#|--|;)/.test(line)) {
    return <span className="text-green-500/70">{line}</span>;
  }

  // For markdown: headers
  if ((ext === 'md' || ext === 'mdx') && /^#{1,6}\s/.test(line)) {
    return <span className="text-blue-600 dark:text-blue-400 font-semibold">{line}</span>;
  }

  // For code files: apply keyword + string highlighting
  const codeExts = new Set([
    'ts',
    'tsx',
    'js',
    'jsx',
    'py',
    'go',
    'rs',
    'java',
    'c',
    'cpp',
    'sh',
    'bash',
    'zsh',
  ]);
  if (codeExts.has(ext)) {
    // Highlight strings, keywords, and numbers
    const parts = line.split(/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g);
    return (
      <>
        {parts.map((part, i) => {
          // String literals
          if (/^['"`]/.test(part)) {
            return (
              <span key={i} className="text-amber-600 dark:text-amber-400">
                {part}
              </span>
            );
          }
          // Keywords
          const highlighted = part.replace(
            /\b(const|let|var|function|async|await|return|if|else|for|while|import|export|from|class|interface|type|enum|extends|implements|new|throw|try|catch|finally|switch|case|break|continue|default|yield|of|in|as|def|self|None|True|False|fn|pub|mod|use|struct|impl|trait|match|mut|ref|super|this|null|undefined|true|false|void|number|string|boolean|readonly)\b/g,
            '\x00KW\x01$1\x00KW\x02',
          );
          if (!highlighted.includes('\x00KW')) {
            return <span key={i}>{part}</span>;
          }
          // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control char delimiters for syntax highlighting
          const kParts = highlighted.split(/\x00KW[\x01\x02]/g);
          return (
            <span key={i}>
              {kParts.map((kp, ki) =>
                ki % 2 === 1 ? (
                  <span key={ki} className="text-purple-600 dark:text-purple-400">
                    {kp}
                  </span>
                ) : (
                  <span key={ki}>{kp}</span>
                ),
              )}
            </span>
          );
        })}
      </>
    );
  }

  // JSON: highlight keys and values
  if (ext === 'json' || ext === 'jsonl') {
    const keyMatch = line.match(/^(\s*)"([^"]+)"(\s*:\s*)/);
    if (keyMatch) {
      const [full, indent, key, colon] = keyMatch;
      const rest = line.slice(full.length);
      return (
        <>
          {indent}
          <span className="text-blue-600 dark:text-blue-400">&quot;{key}&quot;</span>
          {colon}
          <span className="text-amber-600 dark:text-amber-400">{rest}</span>
        </>
      );
    }
  }

  return <>{line}</>;
}

function pathSegments(path: string): { label: string; path: string }[] {
  const parts = path.split('/').filter(Boolean);
  const segments: { label: string; path: string }[] = [{ label: '/', path: '/' }];
  let current = '';
  for (const part of parts) {
    current += `/${part}`;
    segments.push({ label: part, path: current });
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const FileBrowser = React.memo(function FileBrowser({ machineId, initialPath }: FileBrowserProps): React.JSX.Element {
  const toast = useToast();

  // Navigation state
  const [currentPath, setCurrentPath] = useState(initialPath ?? '/');
  const [pathInput, setPathInput] = useState(initialPath ?? '/');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [dirLoading, setDirLoading] = useState(false);
  const [dirError, setDirError] = useState<string | null>(null);

  // File viewer state
  const [openFile, setOpenFile] = useState<FileContentResponse | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // -------------------------------------------------------------------------
  // Load directory
  // -------------------------------------------------------------------------

  const loadDirectory = useCallback(
    async (path: string) => {
      setDirLoading(true);
      setDirError(null);
      setOpenFile(null);
      setEditing(false);

      try {
        const data: FileListResponse = await api.listFiles(machineId, path);
        setEntries(data.entries);
        setCurrentPath(data.path);
        setPathInput(data.path);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        setDirError(msg);
        setEntries([]);
      } finally {
        setDirLoading(false);
      }
    },
    [machineId],
  );

  // Load initial directory — intentionally only runs on machineId change (not on currentPath/loadDirectory changes)
  // biome-ignore lint/correctness/useExhaustiveDependencies: initial load only
  useEffect(() => {
    void loadDirectory(currentPath);
  }, [machineId]);

  // -------------------------------------------------------------------------
  // Open file
  // -------------------------------------------------------------------------

  const handleOpenFile = useCallback(
    async (filePath: string) => {
      setFileLoading(true);
      setFileError(null);
      setEditing(false);

      try {
        const data: FileContentResponse = await api.readFile(machineId, filePath);
        setOpenFile(data);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        setFileError(msg);
        setOpenFile(null);
      } finally {
        setFileLoading(false);
      }
    },
    [machineId],
  );

  // -------------------------------------------------------------------------
  // Save file
  // -------------------------------------------------------------------------

  const handleSave = useCallback(async () => {
    if (!openFile) return;
    setSaving(true);

    try {
      await api.writeFile(machineId, openFile.path, editContent);
      toast.success('File saved');
      // Update the openFile with new content
      setOpenFile({ ...openFile, content: editContent, size: new Blob([editContent]).size });
      setEditing(false);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      toast.error(`Failed to save: ${msg}`);
    } finally {
      setSaving(false);
    }
  }, [machineId, openFile, editContent, toast]);

  // -------------------------------------------------------------------------
  // Entry click handler
  // -------------------------------------------------------------------------

  const handleEntryClick = useCallback(
    (entry: FileEntry) => {
      if (entry.type === 'directory') {
        const newPath = currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`;
        void loadDirectory(newPath);
      } else {
        const filePath = currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`;
        void handleOpenFile(filePath);
      }
    },
    [currentPath, loadDirectory, handleOpenFile],
  );

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  const handlePathSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (pathInput.trim()) {
        void loadDirectory(pathInput.trim());
      }
    },
    [pathInput, loadDirectory],
  );

  const handleGoUp = useCallback(() => {
    const parent = currentPath.replace(/\/[^/]+\/?$/, '') || '/';
    void loadDirectory(parent);
  }, [currentPath, loadDirectory]);

  const startEditing = useCallback(() => {
    if (!openFile) return;
    setEditContent(openFile.content);
    setEditing(true);
    // Focus textarea after render
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [openFile]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setEditContent('');
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full border-l border-border bg-card">
      {/* Path bar */}
      <div className="px-3 py-2 border-b border-border shrink-0">
        <form onSubmit={handlePathSubmit} className="flex gap-2">
          <input
            type="text"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            className="flex-1 px-2 py-1 bg-muted text-foreground border border-border rounded-md text-xs font-mono outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
            placeholder="Absolute path..."
          />
          <button
            type="submit"
            aria-label="Navigate to path"
            className="px-2 py-1 bg-primary text-primary-foreground rounded-md text-xs cursor-pointer hover:opacity-90"
          >
            Go
          </button>
        </form>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 mt-1.5 text-[11px] text-muted-foreground overflow-x-auto">
          {pathSegments(currentPath).map((seg, i, arr) => (
            <span key={seg.path} className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => void loadDirectory(seg.path)}
                className={cn(
                  'hover:text-foreground cursor-pointer bg-transparent border-none p-0',
                  i === arr.length - 1 ? 'text-foreground font-medium' : 'text-muted-foreground',
                )}
              >
                {seg.label}
              </button>
              {i < arr.length - 1 && <span className="text-muted-foreground/50">/</span>}
            </span>
          ))}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {/* File viewer / editor */}
        {(openFile || fileLoading || fileError) && (
          <div className="flex-1 flex flex-col overflow-hidden border-b border-border">
            {/* File header */}
            <div className="px-3 py-1.5 border-b border-border flex items-center gap-2 shrink-0 bg-muted/50">
              <span className="text-xs font-mono text-foreground truncate flex-1" title={openFile?.path ?? undefined}>
                {openFile?.path?.split('/').pop() ?? 'Loading...'}
              </span>
              {openFile && !editing && (
                <button
                  type="button"
                  onClick={startEditing}
                  className="px-2 py-0.5 bg-primary text-primary-foreground rounded-md text-[11px] cursor-pointer hover:opacity-90"
                >
                  Edit
                </button>
              )}
              {editing && (
                <>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="px-2 py-0.5 bg-green-700 text-white rounded-md text-[11px] cursor-pointer hover:bg-green-600 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEditing}
                    className="px-2 py-0.5 bg-muted text-muted-foreground border border-border rounded-md text-[11px] cursor-pointer hover:bg-accent"
                  >
                    Cancel
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  setOpenFile(null);
                  setFileError(null);
                  setEditing(false);
                }}
                className="px-1.5 py-0.5 text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-none text-sm"
                title="Close file"
                aria-label="Close file"
              >
                x
              </button>
            </div>

            {/* File content */}
            <div className="flex-1 overflow-auto min-h-0">
              {fileLoading && (
                <div className="p-4 text-xs text-muted-foreground animate-pulse">
                  Loading file...
                </div>
              )}
              {fileError && (
                <div className="p-4 text-xs text-red-600 dark:text-red-400">{fileError}</div>
              )}
              {openFile &&
                !editing &&
                (() => {
                  const ext = getFileExtension(openFile.path);
                  const lines = openFile.content.split('\n');
                  const gutterWidth = String(lines.length).length;
                  return (
                    <div className="flex text-[12px] font-mono leading-5 m-0">
                      {/* Line numbers gutter */}
                      <div className="shrink-0 select-none text-right pr-3 pl-2 py-3 text-muted-foreground/40 border-r border-border/50 bg-muted/20">
                        {lines.map((_, i) => (
                          <div key={i} style={{ minWidth: `${gutterWidth}ch` }}>
                            {i + 1}
                          </div>
                        ))}
                      </div>
                      {/* Code content */}
                      <div className="flex-1 py-3 pl-3 pr-3 overflow-x-auto">
                        {lines.map((line, i) => (
                          <div key={i} className="whitespace-pre hover:bg-accent/30">
                            {highlightLine(line, ext)}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              {editing &&
                (() => {
                  const lines = editContent.split('\n');
                  const gutterWidth = String(lines.length).length;
                  return (
                    <div className="flex h-full text-[12px] font-mono leading-5">
                      {/* Line numbers gutter */}
                      <div className="shrink-0 select-none text-right pr-3 pl-2 py-3 text-muted-foreground/40 border-r border-border/50 bg-muted/20">
                        {lines.map((_, i) => (
                          <div key={i} style={{ minWidth: `${gutterWidth}ch` }}>
                            {i + 1}
                          </div>
                        ))}
                      </div>
                      {/* Editor textarea */}
                      <textarea
                        ref={textareaRef}
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="flex-1 py-3 pl-3 pr-3 font-mono text-[12px] whitespace-pre bg-transparent text-foreground border-none outline-none resize-none leading-5"
                        spellCheck={false}
                      />
                    </div>
                  );
                })()}
            </div>

            {/* File info */}
            {openFile && (
              <div className="px-3 py-1 border-t border-border text-[10px] text-muted-foreground shrink-0 bg-muted/30">
                {formatFileSize(openFile.size)} | {openFile.path}
              </div>
            )}
          </div>
        )}

        {/* Directory listing */}
        <div
          className={cn(
            'overflow-auto',
            openFile || fileLoading || fileError ? 'max-h-[200px]' : 'flex-1',
          )}
        >
          {dirLoading && (
            <div aria-busy="true">
              <span className="sr-only">Loading directory...</span>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-[10px] text-muted-foreground">
                    <th className="text-left px-3 py-1.5 font-medium">Name</th>
                    <th className="text-right px-3 py-1.5 font-medium w-20">Size</th>
                    <th className="text-right px-3 py-1.5 font-medium w-32">Modified</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 5 }, (_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <Skeleton className="h-4 w-4 rounded shrink-0" />
                          <Skeleton className="h-3 w-32" />
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <Skeleton className="h-3 w-12 ml-auto" />
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <Skeleton className="h-3 w-20 ml-auto" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {dirError && <div className="p-4 text-xs text-red-600 dark:text-red-400">{dirError}</div>}
          {!dirLoading && !dirError && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] text-muted-foreground">
                  <th className="text-left px-3 py-1.5 font-medium">Name</th>
                  <th className="text-right px-3 py-1.5 font-medium w-20">Size</th>
                  <th className="text-right px-3 py-1.5 font-medium w-32">Modified</th>
                </tr>
              </thead>
              <tbody>
                {/* Go up entry */}
                {currentPath !== '/' && (
                  <tr
                    onClick={handleGoUp}
                    className="border-b border-border/50 hover:bg-accent/50 cursor-pointer"
                  >
                    <td className="px-3 py-1.5 text-muted-foreground" colSpan={3}>
                      <span className="mr-1.5">&#128193;</span> ..
                    </td>
                  </tr>
                )}
                {entries.map((entry) => (
                  <tr
                    key={entry.name}
                    onClick={() => handleEntryClick(entry)}
                    className={cn(
                      'border-b border-border/50 hover:bg-accent/50 cursor-pointer',
                      openFile?.path.endsWith(`/${entry.name}`) && 'bg-accent',
                    )}
                  >
                    <td className="px-3 py-1.5">
                      <span className="mr-1.5">
                        {entry.type === 'directory' ? '\u{1F4C1}' : '\u{1F4C4}'}
                      </span>
                      <span
                        className={
                          entry.type === 'directory'
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-foreground'
                        }
                      >
                        {entry.name}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground tabular-nums">
                      {entry.type === 'file' ? formatFileSize(entry.size) : ''}
                    </td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">
                      {formatModified(entry.modified)}
                    </td>
                  </tr>
                ))}
                {entries.length === 0 && !dirLoading && (
                  <tr>
                    <td className="px-3 py-4 text-muted-foreground text-center italic" colSpan={3}>
                      Empty directory
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
});
