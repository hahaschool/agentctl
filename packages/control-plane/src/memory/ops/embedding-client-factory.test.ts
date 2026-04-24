import { describe, expect, it } from 'vitest';

// Gate 1: Gemini OpenAI-compat endpoint returns 401 for fake key (not 404/ENOTFOUND)
// This test makes a REAL HTTP request. It is skipped in CI unless GATE1_LIVE=true.
describe.skipIf(!process.env.GATE1_LIVE)('Gate 1 — Gemini URL contract', () => {
  it('returns 401 for fake API key (not 404 or network error)', async () => {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/embeddings', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer fake-key-gate1-test',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'gemini-embedding-001', input: ['test'] }),
    });
    expect(res.status).toBe(401);
  }, 10_000);
});
