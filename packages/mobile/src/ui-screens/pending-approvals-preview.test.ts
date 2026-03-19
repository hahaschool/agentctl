import { describe, expect, it } from 'vitest';

import { formatRemaining, formatToolInputPreview } from './pending-approvals-preview.js';

describe('pending approvals preview helpers', () => {
  it('formats remaining time from a provided clock value', () => {
    expect(
      formatRemaining('2024-01-01T00:01:05.000Z', Date.parse('2024-01-01T00:00:00.000Z')),
    ).toBe('1m 5s');
  });

  it('returns expired when the timeout has passed', () => {
    expect(
      formatRemaining('2024-01-01T00:00:00.000Z', Date.parse('2024-01-01T00:00:01.000Z')),
    ).toBe('Expired');
  });

  it('prefers a provided description over raw tool input data', () => {
    expect(formatToolInputPreview({ command: 'rm -rf /' }, 'Delete a temp file')).toBe(
      'Delete a temp file',
    );
  });

  it('summarizes only input field names instead of raw values', () => {
    expect(
      formatToolInputPreview({
        command: 'rm -rf /',
        cwd: '/tmp/project',
      }),
    ).toBe('Input fields: command, cwd');
  });

  it('redacts secret-like field names and truncates long key lists', () => {
    expect(
      formatToolInputPreview({
        command: 'echo hello',
        apiToken: 'secret-token',
        cwd: '/tmp/project',
        env: { DEBUG: '1' },
        extra: true,
      }),
    ).toBe('Input fields: command, [redacted], cwd, env +1 more');
  });

  it('returns a fallback when no preview data is available', () => {
    expect(formatToolInputPreview(undefined)).toBe('No input preview');
    expect(formatToolInputPreview({})).toBe('No input preview');
  });
});
