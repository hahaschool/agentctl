import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { sanitizeMemoryDrawerContent } from './memory-drawer-sanitizer.js';

function joinFixtureParts(parts: string[]): string {
  return parts.join('');
}

describe('sanitizeMemoryDrawerContent', () => {
  it('redacts high-risk raw transcript secrets before hashing', () => {
    const openAiValue = joinFixtureParts(['sk', '-proj-', 'abc', '1234567890']);
    const bearerValue = joinFixtureParts(['secret', '-bearer-', 'token']);
    const githubValue = joinFixtureParts(['ghp', '_abcdefghijklmnopqrstuvwxyz', '123456']);
    const jwtValue = joinFixtureParts([
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ',
      '.payload.',
      'signature',
    ]);
    const postgresUrl = joinFixtureParts(['postgres', '://user:pass', '@localhost:5432/db']);
    const privateKey = joinFixtureParts([
      '-----BEGIN ',
      'PRIVATE KEY-----\nsecret\n-----END ',
      'PRIVATE KEY-----',
    ]);

    const raw = [
      `OPENAI_API_KEY=${openAiValue}`,
      `Authorization: Bearer ${bearerValue}`,
      `github token ${githubValue}`,
      `jwt ${jwtValue}`,
      postgresUrl,
      'Cookie: session=raw-cookie; theme=dark',
      privateKey,
    ].join('\n');

    const result = sanitizeMemoryDrawerContent(raw);

    expect(result.content).not.toContain(openAiValue);
    expect(result.content).not.toContain(bearerValue);
    expect(result.content).not.toContain(githubValue);
    expect(result.content).not.toContain(jwtValue);
    expect(result.content).not.toContain(postgresUrl);
    expect(result.content).not.toContain('session=raw-cookie');
    expect(result.content).not.toContain('BEGIN PRIVATE KEY');
    expect(result.redactionStatus).toBe('quarantined');
    expect(result.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.redactionCount).toBeGreaterThanOrEqual(7);
  });

  it('hashes normalized non-sensitive content deterministically', () => {
    const raw = 'safe note\r\nwith normalized newline';
    const result = sanitizeMemoryDrawerContent(raw);

    expect(result.content).toBe('safe note\nwith normalized newline');
    expect(result.contentSha256).toBe(createHash('sha256').update(result.content).digest('hex'));
    expect(result.redactionStatus).toBe('unreviewed');
  });
});
