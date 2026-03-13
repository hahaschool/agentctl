import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { safeChmodSync, safeMkdirSync, sanitizePath } from './path-security.js';

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

  it('safeMkdirSync creates directories that stay within the allowed base', () => {
    const root = mkdtempSync(join(tmpdir(), 'path-security-'));
    const base = join(root, 'base');
    mkdirSync(base);

    try {
      const target = join(base, 'nested', 'dir');
      safeMkdirSync(target, base, { recursive: true });

      expect(statSync(target).isDirectory()).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('safeMkdirSync rejects directories that escape the allowed base', () => {
    const root = mkdtempSync(join(tmpdir(), 'path-security-'));
    const base = join(root, 'base');
    mkdirSync(base);

    try {
      expect(() => safeMkdirSync(join(base, '..', 'escape-target'), base, { recursive: true })).toThrow(
        /outside the allowed base path|escapes allowed base/i,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('safeChmodSync changes permissions for files within the allowed base', () => {
    const root = mkdtempSync(join(tmpdir(), 'path-security-'));
    const base = join(root, 'base');
    mkdirSync(base);

    try {
      const target = join(base, 'script.sh');
      writeFileSync(target, '#!/usr/bin/env bash\n');
      chmodSync(target, 0o644);

      safeChmodSync(target, base, 0o755);

      expect(statSync(target).mode & 0o777).toBe(0o755);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('safeChmodSync rejects files that escape the allowed base', () => {
    const root = mkdtempSync(join(tmpdir(), 'path-security-'));
    const base = join(root, 'base');
    mkdirSync(base);

    try {
      const escaped = join(root, 'outside.sh');
      writeFileSync(escaped, '#!/usr/bin/env bash\n');

      expect(() => safeChmodSync(join(base, '..', 'outside.sh'), base, 0o755)).toThrow(
        /outside the allowed base path|escapes allowed base/i,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
