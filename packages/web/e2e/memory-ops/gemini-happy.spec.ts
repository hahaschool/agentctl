import { expect, test } from '@playwright/test';

test.describe('Gemini embedding provider Gate 2', () => {
  test.skip(
    !process.env.GATE2_GEMINI_API_KEY || process.env.GEMINI_VERIFIED !== '1',
    'Gate 2 requires GATE2_GEMINI_API_KEY and GEMINI_VERIFIED=1',
  );

  test('returns 1536 dimensions when output_dimensionality is requested', async ({ request }) => {
    const response = await request.post(
      'https://generativelanguage.googleapis.com/v1beta/openai/embeddings',
      {
        headers: {
          Authorization: `Bearer ${process.env.GATE2_GEMINI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        data: {
          model: 'gemini-embedding-001',
          input: ['agentctl gate 2 dimension check'],
          output_dimensionality: 1536,
        },
      },
    );

    expect(response.ok()).toBe(true);
    const body = (await response.json()) as {
      model?: string;
      data?: Array<{ embedding?: number[] }>;
    };
    expect(body.model ?? 'gemini-embedding-001').toContain('gemini-embedding-001');
    expect(body.data?.[0]?.embedding).toHaveLength(1536);
  });
});
