import { describe, expect, it } from 'vitest';

import { sanitizePath } from './path-security.js';

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
});
