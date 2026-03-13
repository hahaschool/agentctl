import { describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
  closeSync: vi.fn(),
  existsSync: vi.fn(),
  fstatSync: vi.fn(),
  mkdirSync: vi.fn(),
  openSync: vi.fn(),
  readFileSync: vi.fn(),
  readSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  writeFileSync: vi.fn(),
  constants: { O_RDONLY: 0, O_NOFOLLOW: 0x20000 },
}));

import { mkdirSync, readdirSync, statSync } from 'node:fs';

import { safeMkdirSync, safeReaddirSync, safeStatSync, sanitizePath } from './path-security.js';

describe('sanitizePath', () => {
  it('returns the resolved path when it stays within the allowed base', () => {
    expect(sanitizePath('/tmp/agentctl/sessions/../logs/run.jsonl', '/tmp/agentctl')).toBe(
      '/tmp/agentctl/logs/run.jsonl',
    );
  });

  it('throws when the resolved path escapes the allowed base', () => {
    expect(() => sanitizePath('/tmp/agentctl/../../etc/passwd', '/tmp/agentctl')).toThrow(
      /outside the allowed base path/i,
    );
  });
});

describe('safe fs wrappers', () => {
  it('safeStatSync resolves the path before calling statSync', () => {
    const expectedStat = { size: 123 };
    vi.mocked(statSync).mockReturnValue(expectedStat as never);

    const result = safeStatSync('/tmp/agentctl/project/../file.txt', '/tmp/agentctl');

    expect(result).toBe(expectedStat);
    expect(statSync).toHaveBeenCalledWith('/tmp/agentctl/file.txt');
  });

  it('safeReaddirSync resolves the path before calling readdirSync', () => {
    vi.mocked(readdirSync).mockReturnValue(['child'] as never);

    const result = safeReaddirSync('/tmp/agentctl/project/..', '/tmp/agentctl');

    expect(result).toEqual(['child']);
    expect(readdirSync).toHaveBeenCalledWith('/tmp/agentctl', undefined);
  });

  it('safeMkdirSync resolves the path before calling mkdirSync', () => {
    safeMkdirSync('/tmp/agentctl/project/../nested', '/tmp/agentctl', { recursive: true });

    expect(mkdirSync).toHaveBeenCalledWith('/tmp/agentctl/nested', { recursive: true });
  });
});
