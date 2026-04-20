import { describe, expect, it } from 'vitest';

import {
  chunkMemoryDrawerContent,
  reconstructMemoryDrawerContent,
} from './memory-drawer-chunker.js';

function paragraph(label: string): string {
  return `${label} ${'deterministic memory text '.repeat(18).trim()}.`;
}

describe('chunkMemoryDrawerContent', () => {
  it('is deterministic, monotonic, bounded, and reconstructs the normalized input', () => {
    const content = Array.from({ length: 14 }, (_, index) => paragraph(`Paragraph ${index}`)).join(
      '\n\n',
    );

    const first = chunkMemoryDrawerContent(content);
    const second = chunkMemoryDrawerContent(content);

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(1);
    expect(first.map((chunk) => chunk.chunkIndex)).toEqual(first.map((_, index) => index));
    expect(reconstructMemoryDrawerContent(first)).toBe(content);
    for (const chunk of first.slice(0, -1)) {
      expect(chunk.content.length).toBeGreaterThanOrEqual(300);
      expect(chunk.content.length).toBeLessThanOrEqual(2000);
    }
  });

  it('does not split fenced code blocks that fit inside the max chunk size', () => {
    const codeBlock = ['```ts', 'const token = "[REDACTED]";', 'console.log(token);', '```'].join(
      '\n',
    );
    const content = [
      paragraph('Before'),
      paragraph('Before again'),
      codeBlock,
      paragraph('After'),
      paragraph('After again'),
      paragraph('After third'),
      paragraph('After fourth'),
    ].join('\n\n');

    const chunks = chunkMemoryDrawerContent(content);
    const containingChunks = chunks.filter((chunk) => chunk.content.includes('const token'));

    expect(containingChunks).toHaveLength(1);
    expect(containingChunks[0]?.content).toContain(codeBlock);
  });
});
