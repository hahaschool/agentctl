import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  safeChmodSync,
  safeMkdirSync,
  safeReaddirSync,
  safeStatSync,
  sanitizePath,
} from './path-security.js';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'agentctl-path-security-'));
  tempRoots.push(root);
  return root;
}

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

  it('throws when candidate path only matches a string prefix of the base', () => {
    expect(() => sanitizePath('/tmp/agentctl-evil/file.txt', '/tmp/agentctl')).toThrow(
      /outside the allowed base path/i,
    );
  });

  it('throws when the input path contains null bytes', () => {
    expect(() => sanitizePath('/tmp/agentctl/\u0000file', '/tmp/agentctl')).toThrow(/null bytes/i);
  });

  it('returns file stats for paths within the allowed base', () => {
    const root = makeTempRoot();
    const filePath = join(root, 'audit.log');
    writeFileSync(filePath, 'hello');

    const stat = safeStatSync(filePath, root);

    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBe(5);
  });

  it('lists directories only within the allowed base', () => {
    const root = makeTempRoot();
    const nestedDir = join(root, 'nested');
    safeMkdirSync(nestedDir, root);
    writeFileSync(join(nestedDir, 'entry.txt'), 'hello');

    const entries = safeReaddirSync(nestedDir, root);

    expect(entries.map((entry) => entry.name)).toEqual(['entry.txt']);
  });

  it('creates directories only within the allowed base', () => {
    const root = makeTempRoot();
    const nestedDir = join(root, 'a/b/c');

    safeMkdirSync(nestedDir, root);

    expect(safeStatSync(nestedDir, root).isDirectory()).toBe(true);
    expect(() => safeMkdirSync('/tmp/outside-base', root)).toThrow(
      /outside the allowed base path/i,
    );
  });
});

describe('safeMkdirSync', () => {
  it('creates directories inside the allowed base and returns the resolved path', () => {
    const baseDir = makeTempRoot();
    const nestedDir = join(baseDir, 'a', 'b');

    const safePath = safeMkdirSync(nestedDir, baseDir, { recursive: true });
    expect(safePath).toBe(resolve(nestedDir));
    expect(safeStatSync(safePath, baseDir).isDirectory()).toBe(true);
  });

  it('throws when the target path escapes the allowed base', () => {
    expect(() => safeMkdirSync('/tmp/path-security/../../etc', '/tmp/path-security')).toThrow(
      /outside the allowed base path/i,
    );
  });
});

describe('safeChmodSync', () => {
  it('updates mode bits for files inside the allowed base', () => {
    const baseDir = makeTempRoot();
    const filePath = join(baseDir, 'mode-test.txt');

    writeFileSync(filePath, 'ok');
    safeChmodSync(filePath, baseDir, 0o600);
    expect(safeStatSync(filePath, baseDir).mode & 0o777).toBe(0o600);
  });

  it('throws when chmod target escapes the allowed base', () => {
    expect(() =>
      safeChmodSync('/tmp/path-security/../../etc/passwd', '/tmp/path-security', 0o600),
    ).toThrow(/outside the allowed base path/i);
  });
});
