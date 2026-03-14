import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decodeProjectPath, detectSessionRuntime, discoverLocalSessions } from './session-discovery.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
  closeSync: vi.fn(),
  existsSync: vi.fn(),
  openSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  readSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/Users/testuser'),
}));

const mockCloseSync = vi.mocked(closeSync);
const mockExistsSync = vi.mocked(existsSync);
const mockOpenSync = vi.mocked(openSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockReadSync = vi.mocked(readSync);
const mockStatSync = vi.mocked(statSync);

beforeEach(() => {
  vi.clearAllMocks();
  mockCloseSync.mockImplementation(() => undefined);
  mockOpenSync.mockReturnValue(42);
  mockReadSync.mockImplementation(() => 0);
});

// ---------------------------------------------------------------------------
// detectSessionRuntime
// ---------------------------------------------------------------------------

describe('detectSessionRuntime', () => {
  it('returns codex when .codex dir exists', () => {
    mockExistsSync.mockImplementation((p) => String(p).endsWith('.codex'));
    expect(detectSessionRuntime('/project')).toBe('codex');
  });

  it('returns claude-code when .claude dir exists but .codex does not', () => {
    mockExistsSync.mockImplementation((p) => String(p).endsWith('.claude'));
    expect(detectSessionRuntime('/project')).toBe('claude-code');
  });

  it('returns undefined when neither marker exists', () => {
    mockExistsSync.mockReturnValue(false);
    expect(detectSessionRuntime('/project')).toBeUndefined();
  });

  it('prefers codex when both markers exist', () => {
    mockExistsSync.mockReturnValue(true);
    expect(detectSessionRuntime('/project')).toBe('codex');
  });
});

// ---------------------------------------------------------------------------
// decodeProjectPath
// ---------------------------------------------------------------------------

describe('decodeProjectPath', () => {
  it('decodes a simple path with leading dash', () => {
    // -Users-foo-project → /Users/foo/project (when dirs exist)
    mockExistsSync.mockReturnValue(false); // no ambiguity
    expect(decodeProjectPath('-Users-foo-project')).toBe('/Users/foo/project');
  });

  it('returns root for just a dash', () => {
    expect(decodeProjectPath('-')).toBe('/');
  });

  it('decodes path without leading dash', () => {
    mockExistsSync.mockReturnValue(false);
    expect(decodeProjectPath('some-path')).toBe('some/path');
  });

  it('prefers slash when slash candidate exists on disk', () => {
    mockExistsSync.mockImplementation((p) => {
      return p === '/Users/foo';
    });
    expect(decodeProjectPath('-Users-foo-project')).toBe('/Users/foo/project');
  });

  it('prefers hyphen when only hyphen candidate exists on disk', () => {
    mockExistsSync.mockImplementation((p) => {
      // Only /Users/my-project exists, not /Users/my and /Users/my/project
      if (p === '/Users/my') return false;
      if (p === '/Users/my-project') return true;
      return false;
    });
    expect(decodeProjectPath('-Users-my-project')).toBe('/Users/my-project');
  });

  it('handles multiple consecutive dashes (empty segments)', () => {
    mockExistsSync.mockReturnValue(false);
    // Leading dash stripped, then split on dash — double dash produces empty segment
    const result = decodeProjectPath('-Users--deep');
    // Empty segments are skipped
    expect(result).toBe('/Users/deep');
  });

  it('decodes deeply nested path', () => {
    mockExistsSync.mockReturnValue(false);
    expect(decodeProjectPath('-home-deploy-apps-myapp-src')).toBe('/home/deploy/apps/myapp/src');
  });
});

// ---------------------------------------------------------------------------
// discoverLocalSessions — v1 format
// ---------------------------------------------------------------------------

describe('discoverLocalSessions', () => {
  const claudeDir = '/Users/testuser/.claude/projects';

  it('returns empty array when claude dir does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(discoverLocalSessions()).toEqual([]);
  });

  it('discovers sessions from v1 sessions-index.json', () => {
    // Setup: claudeDir exists
    mockExistsSync.mockImplementation((p) => {
      if (p === claudeDir) return true;
      if (p === join(claudeDir, '-Users-testuser-project', 'sessions-index.json')) return true;
      return false;
    });

    // Top-level directories
    mockReaddirSync.mockImplementation(((p: string, _opts?: Record<string, unknown>) => {
      if (p === claudeDir) {
        return [{ name: '-Users-testuser-project', isDirectory: () => true, isFile: () => false }];
      }
      // Subdirectory scan
      if (p === join(claudeDir, '-Users-testuser-project')) {
        return [];
      }
      return [];
    }) as typeof readdirSync);

    // v1 sessions-index.json
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        version: 1,
        originalPath: '/Users/testuser/project',
        entries: [
          {
            sessionId: 'aaaa-bbbb-cccc',
            summary: 'Test session',
            messageCount: 5,
            modified: '2026-01-15T10:00:00Z',
            gitBranch: 'main',
          },
          {
            sessionId: 'dddd-eeee-ffff',
            firstPrompt: 'Fix the bug',
            messageCount: 3,
            created: '2026-01-14T09:00:00Z',
          },
        ],
      }),
    );

    const sessions = discoverLocalSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions[0].sessionId).toBe('aaaa-bbbb-cccc');
    expect(sessions[0].summary).toBe('Test session');
    expect(sessions[0].messageCount).toBe(5);
    expect(sessions[0].branch).toBe('main');
    expect(sessions[0].projectPath).toBe('/Users/testuser/project');

    expect(sessions[1].sessionId).toBe('dddd-eeee-ffff');
    expect(sessions[1].summary).toBe('Fix the bug');
    expect(sessions[1].branch).toBeNull();
  });

  it('discovers sessions from legacy format', () => {
    mockExistsSync.mockImplementation((p) => {
      if (p === claudeDir) return true;
      if (p === join(claudeDir, '-Users-testuser-myapp', 'sessions-index.json')) return true;
      return false;
    });

    mockReaddirSync.mockImplementation(((p: string) => {
      if (p === claudeDir) {
        return [{ name: '-Users-testuser-myapp', isDirectory: () => true, isFile: () => false }];
      }
      if (p === join(claudeDir, '-Users-testuser-myapp')) {
        return [];
      }
      return [];
    }) as typeof readdirSync);

    // Legacy format: Record<sessionId, entry>
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        'sess-001': {
          summary: 'Legacy session',
          messageCount: 10,
          lastActiveAt: '2026-02-01T12:00:00Z',
          gitBranch: 'feature/x',
        },
        'sess-002': {
          title: 'Another session',
          messageCount: 2,
          updatedAt: '2026-01-30T08:00:00Z',
        },
      }),
    );

    const sessions = discoverLocalSessions();
    expect(sessions).toHaveLength(2);

    // Sorted by lastActivity descending
    expect(sessions[0].sessionId).toBe('sess-001');
    expect(sessions[0].summary).toBe('Legacy session');
    expect(sessions[0].branch).toBe('feature/x');

    expect(sessions[1].sessionId).toBe('sess-002');
    expect(sessions[1].summary).toBe('Another session');
    expect(sessions[1].branch).toBeNull();
  });

  it('extracts metadata from JSONL files when no index exists', () => {
    mockExistsSync.mockImplementation((p) => {
      if (p === claudeDir) return true;
      // No sessions-index.json
      return false;
    });

    mockReaddirSync.mockImplementation(((p: string) => {
      if (p === claudeDir) {
        return [{ name: '-Users-testuser-app', isDirectory: () => true, isFile: () => false }];
      }
      if (p === join(claudeDir, '-Users-testuser-app')) {
        return [
          {
            name: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890.jsonl',
            isDirectory: () => false,
            isFile: () => true,
          },
          {
            name: 'not-a-uuid.jsonl',
            isDirectory: () => false,
            isFile: () => true,
          },
          {
            name: 'README.md',
            isDirectory: () => false,
            isFile: () => true,
          },
        ];
      }
      return [];
    }) as typeof readdirSync);

    mockStatSync.mockReturnValue({
      mtime: new Date('2026-03-01T15:00:00Z'),
    } as ReturnType<typeof statSync>);

    const jsonl = `{"type":"progress","gitBranch":"main","timestamp":"2026-03-01T14:59:00Z"}
{"type":"user","message":{"role":"user","content":"Ship discover fallback"},"timestamp":"2026-03-01T15:00:00Z"}
{"message":{"role":"assistant","content":[{"type":"text","text":"Working on it"}]},"timestamp":"2026-03-01T15:01:00Z"}
`;
    let offset = 0;
    mockReadSync.mockImplementation(((
      _fd: number,
      buffer: NodeJS.ArrayBufferView,
      _bufferOffset: number,
      length: number,
    ) => {
      const chunk = jsonl.slice(offset, offset + length);
      const target = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      target.fill(0);
      target.write(chunk, 0, 'utf8');
      const bytesRead = Buffer.byteLength(chunk);
      offset += bytesRead;
      return bytesRead;
    }) as typeof readSync);

    const sessions = discoverLocalSessions();
    // Only the valid UUID .jsonl file should be discovered
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(sessions[0].summary).toBe('Ship discover fallback');
    expect(sessions[0].messageCount).toBe(2);
    expect(sessions[0].branch).toBe('main');
    expect(sessions[0].lastActivity).toBe('2026-03-01T15:01:00Z');
  });

  it('filters by projectPath when provided', () => {
    mockExistsSync.mockImplementation((p) => {
      if (p === claudeDir) return true;
      if (String(p).endsWith('sessions-index.json')) return true;
      return false;
    });

    mockReaddirSync.mockImplementation(((p: string) => {
      if (p === claudeDir) {
        return [
          { name: '-Users-testuser-projecta', isDirectory: () => true, isFile: () => false },
          { name: '-Users-testuser-projectb', isDirectory: () => true, isFile: () => false },
        ];
      }
      return [];
    }) as typeof readdirSync);

    mockReadFileSync.mockImplementation(((p: string) => {
      if (String(p).includes('projecta')) {
        return JSON.stringify({
          version: 1,
          originalPath: '/Users/testuser/projecta',
          entries: [{ sessionId: 'a1', summary: 'A session' }],
        });
      }
      return JSON.stringify({
        version: 1,
        originalPath: '/Users/testuser/projectb',
        entries: [{ sessionId: 'b1', summary: 'B session' }],
      });
    }) as typeof readFileSync);

    const sessions = discoverLocalSessions('projecta');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('a1');
  });

  it('deduplicates sessions by sessionId', () => {
    mockExistsSync.mockImplementation((p) => {
      if (p === claudeDir) return true;
      if (String(p).endsWith('sessions-index.json')) return true;
      return false;
    });

    // Setup: same session appears at top level and in subdirectory
    mockReaddirSync.mockImplementation(((p: string) => {
      if (p === claudeDir) {
        return [{ name: '-Users-testuser-proj', isDirectory: () => true, isFile: () => false }];
      }
      if (p === join(claudeDir, '-Users-testuser-proj')) {
        return [{ name: 'nested', isDirectory: () => true, isFile: () => false }];
      }
      return [];
    }) as typeof readdirSync);

    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        version: 1,
        originalPath: '/Users/testuser/proj',
        entries: [{ sessionId: 'dup-id', summary: 'Duplicate' }],
      }),
    );

    const sessions = discoverLocalSessions();
    // Should deduplicate
    const ids = sessions.map((s) => s.sessionId);
    const unique = new Set(ids);
    expect(ids.length).toBe(unique.size);
  });

  it('handles corrupted sessions-index.json gracefully', () => {
    mockExistsSync.mockImplementation((p) => {
      if (p === claudeDir) return true;
      if (String(p).endsWith('sessions-index.json')) return true;
      return false;
    });

    mockReaddirSync.mockImplementation(((p: string) => {
      if (p === claudeDir) {
        return [{ name: '-Users-testuser-bad', isDirectory: () => true, isFile: () => false }];
      }
      return [];
    }) as typeof readdirSync);

    mockReadFileSync.mockReturnValue('{ invalid json !!!');

    // Should not throw
    const sessions = discoverLocalSessions();
    expect(sessions).toEqual([]);
  });

  it('handles unreadable directory gracefully', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    const sessions = discoverLocalSessions();
    expect(sessions).toEqual([]);
  });

  it('passes logger for debug messages', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockImplementation(() => {
      throw new Error('EACCES');
    });

    const logger = { debug: vi.fn() };
    discoverLocalSessions(undefined, logger);
    expect(logger.debug).toHaveBeenCalled();
  });

  it('sorts sessions by most recent activity', () => {
    mockExistsSync.mockImplementation((p) => {
      if (p === claudeDir) return true;
      if (String(p).endsWith('sessions-index.json')) return true;
      return false;
    });

    mockReaddirSync.mockImplementation(((p: string) => {
      if (p === claudeDir) {
        return [{ name: '-Users-testuser-proj', isDirectory: () => true, isFile: () => false }];
      }
      return [];
    }) as typeof readdirSync);

    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        version: 1,
        originalPath: '/Users/testuser/proj',
        entries: [
          { sessionId: 'old', summary: 'Old', modified: '2025-01-01T00:00:00Z' },
          { sessionId: 'new', summary: 'New', modified: '2026-06-01T00:00:00Z' },
          { sessionId: 'mid', summary: 'Mid', modified: '2026-03-01T00:00:00Z' },
        ],
      }),
    );

    const sessions = discoverLocalSessions();
    expect(sessions.map((s) => s.sessionId)).toEqual(['new', 'mid', 'old']);
  });

  it('detects claude-code runtime from .claude directory marker', () => {
    mockExistsSync.mockImplementation((p) => {
      if (p === claudeDir) return true;
      if (String(p).endsWith('sessions-index.json')) return true;
      // .claude exists, .codex does not
      if (String(p).endsWith('.codex')) return false;
      if (String(p).endsWith('.claude')) return true;
      return false;
    });

    mockReaddirSync.mockImplementation(((p: string) => {
      if (p === claudeDir) {
        return [{ name: '-Users-testuser-proj', isDirectory: () => true, isFile: () => false }];
      }
      return [];
    }) as typeof readdirSync);

    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        version: 1,
        originalPath: '/Users/testuser/proj',
        entries: [{ sessionId: 'rt-1', summary: 'Claude session' }],
      }),
    );

    const sessions = discoverLocalSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].runtime).toBe('claude-code');
  });

  it('detects codex runtime from .codex directory marker', () => {
    mockExistsSync.mockImplementation((p) => {
      if (p === claudeDir) return true;
      if (String(p).endsWith('sessions-index.json')) return true;
      // .codex exists
      if (String(p).endsWith('.codex')) return true;
      return false;
    });

    mockReaddirSync.mockImplementation(((p: string) => {
      if (p === claudeDir) {
        return [{ name: '-Users-testuser-proj', isDirectory: () => true, isFile: () => false }];
      }
      return [];
    }) as typeof readdirSync);

    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        version: 1,
        originalPath: '/Users/testuser/proj',
        entries: [{ sessionId: 'rt-2', summary: 'Codex session' }],
      }),
    );

    const sessions = discoverLocalSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].runtime).toBe('codex');
  });

  it('returns undefined runtime when no markers exist', () => {
    mockExistsSync.mockImplementation((p) => {
      if (p === claudeDir) return true;
      if (String(p).endsWith('sessions-index.json')) return true;
      // Neither .codex nor .claude exist
      if (String(p).endsWith('.codex')) return false;
      if (String(p).endsWith('.claude')) return false;
      return false;
    });

    mockReaddirSync.mockImplementation(((p: string) => {
      if (p === claudeDir) {
        return [{ name: '-Users-testuser-proj', isDirectory: () => true, isFile: () => false }];
      }
      return [];
    }) as typeof readdirSync);

    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        version: 1,
        originalPath: '/Users/testuser/proj',
        entries: [{ sessionId: 'rt-3', summary: 'Unknown session' }],
      }),
    );

    const sessions = discoverLocalSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].runtime).toBeUndefined();
  });

  it('skips entries with missing sessionId in v1 format', () => {
    mockExistsSync.mockImplementation((p) => {
      if (p === claudeDir) return true;
      if (String(p).endsWith('sessions-index.json')) return true;
      return false;
    });

    mockReaddirSync.mockImplementation(((p: string) => {
      if (p === claudeDir) {
        return [{ name: '-Users-testuser-proj', isDirectory: () => true, isFile: () => false }];
      }
      return [];
    }) as typeof readdirSync);

    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        version: 1,
        originalPath: '/Users/testuser/proj',
        entries: [
          { sessionId: 'valid', summary: 'Good' },
          { noSessionId: true, summary: 'Bad entry' },
          { sessionId: 123, summary: 'Wrong type' },
        ],
      }),
    );

    const sessions = discoverLocalSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('valid');
  });
});
