import { describe, expect, it } from 'vitest';

import { MEMORY_QUERY_MAX_CHARS, sanitizeQuery } from './query-sanitizer.js';

describe('sanitizeQuery', () => {
  it('passes normal short queries through unchanged except trimming', () => {
    const result = sanitizeQuery('  Which deployment format did we prefer?  ');

    expect(result).toMatchObject({
      query: 'Which deployment format did we prefer?',
      stage: 'passthrough',
      originalChars: 42,
      sanitizedChars: 38,
      hasPrefixSmell: false,
      maxChars: MEMORY_QUERY_MAX_CHARS,
    });
  });

  it('extracts the final user question from a long system prompt prefix', () => {
    const result = sanitizeQuery(
      `${'System prompt: follow the repository rules. '.repeat(60)}User: Which branch owns the mesh retry fixture?`,
    );

    expect(result.query).toBe('Which branch owns the mesh retry fixture?');
    expect(result.stage).toBe('question_extracted');
    expect(result.hasPrefixSmell).toBe(true);
    expect(result.originalChars).toBeGreaterThan(MEMORY_QUERY_MAX_CHARS);
  });

  it('uses the last question for role-tagged conversation dumps', () => {
    const result = sanitizeQuery(`System: You are Codex.
Assistant: I inspected memory search.
User: What was the first question?
Assistant: It was answered.
User: Which sanitizer stage handles transcript dumps?`);

    expect(result.query).toBe('Which sanitizer stage handles transcript dumps?');
    expect(result.stage).toBe('question_extracted');
    expect(result.hasPrefixSmell).toBe(true);
  });

  it('extracts the final question after a code-fence prefix', () => {
    const result = sanitizeQuery(`\`\`\`ts
const query = "What is inside the snippet?";
\`\`\`
Where should query sanitization run?`);

    expect(result.query).toBe('Where should query sanitization run?');
    expect(result.stage).toBe('question_extracted');
    expect(result.hasPrefixSmell).toBe(true);
  });

  it('falls back to the final tail sentence when no question marker exists', () => {
    const result = sanitizeQuery(`System: keep this transcript concise.
Assistant: The prior answer is irrelevant. User: Remember that deploys use canary rings.`);

    expect(result.query).toBe('Remember that deploys use canary rings.');
    expect(result.stage).toBe('tail_fallback');
    expect(result.hasPrefixSmell).toBe(true);
  });

  it('truncates fallback text that remains over the configured character cap', () => {
    const result = sanitizeQuery(`System: contaminated prefix. User: ${'alpha '.repeat(20)}`, {
      maxChars: 32,
    });

    expect(result.query).toBe('alpha alpha alpha alpha alpha al');
    expect(result.stage).toBe('truncated');
    expect(result.sanitizedChars).toBe(32);
    expect(result.maxChars).toBe(32);
  });

  it('returns empty metadata for whitespace-only input', () => {
    const result = sanitizeQuery('   \n\t');

    expect(result).toMatchObject({
      query: '',
      stage: 'empty',
      originalChars: 5,
      sanitizedChars: 0,
    });
  });
});
