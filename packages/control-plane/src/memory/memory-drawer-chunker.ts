import {
  MEMORY_DRAWER_CHUNK_MAX_CHARS,
  MEMORY_DRAWER_CHUNK_MIN_CHARS,
  MEMORY_DRAWER_CHUNK_TARGET_CHARS,
  MEMORY_DRAWER_OVERLAP_CHARS,
} from '@agentctl/shared';

import { normalizeMemoryDrawerContent } from './memory-drawer-sanitizer.js';
import type { MemoryDrawerChunk } from './memory-drawer-types.js';

type Range = {
  start: number;
  end: number;
};

function findFencedCodeRanges(content: string): Range[] {
  const ranges: Range[] = [];
  const fencePattern = /(^|\n)```[^\n]*\n[\s\S]*?\n```(?=\n|$)/g;

  for (const match of content.matchAll(fencePattern)) {
    const prefix = match[1] ?? '';
    const start = (match.index ?? 0) + prefix.length;
    const end = start + match[0].length - prefix.length;
    if (end - start <= MEMORY_DRAWER_CHUNK_MAX_CHARS) {
      ranges.push({ start, end });
    }
  }

  return ranges;
}

function isInsideRange(position: number, ranges: readonly Range[]): boolean {
  return ranges.some((range) => position > range.start && position < range.end);
}

function collectBoundaryPositions(content: string, protectedRanges: readonly Range[]): number[] {
  const positions = new Set<number>();
  const patterns = [
    /\n---+\n/g,
    /\n#{1,6}\s+/g,
    /\n\n+/g,
    /\n\s*(?:[-*+]|\d+\.)\s+/g,
    /[.!?]["')\]]?\s+/g,
    /\s+/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const position = (match.index ?? 0) + match[0].length;
      if (position > 0 && position < content.length && !isInsideRange(position, protectedRanges)) {
        positions.add(position);
      }
    }
  }

  return [...positions].sort((a, b) => a - b);
}

function chooseChunkEnd(
  content: string,
  start: number,
  boundaries: readonly number[],
  protectedRanges: readonly Range[],
): number {
  const remaining = content.length - start;
  if (remaining <= MEMORY_DRAWER_CHUNK_MAX_CHARS) {
    return content.length;
  }

  const minEnd = start + MEMORY_DRAWER_CHUNK_MIN_CHARS;
  const targetEnd = start + MEMORY_DRAWER_CHUNK_TARGET_CHARS;
  const maxEnd = Math.min(start + MEMORY_DRAWER_CHUNK_MAX_CHARS, content.length);
  const candidates = boundaries.filter((position) => {
    if (position < minEnd || position > maxEnd) {
      return false;
    }
    const tailLength = content.length - position;
    return tailLength === 0 || tailLength >= MEMORY_DRAWER_CHUNK_MIN_CHARS;
  });

  const beforeTarget = candidates.filter((position) => position <= targetEnd).at(-1);
  if (beforeTarget !== undefined) {
    return beforeTarget;
  }

  const afterTarget = candidates.find((position) => position > targetEnd);
  if (afterTarget !== undefined) {
    return afterTarget;
  }

  const lineBreak = content.lastIndexOf('\n', maxEnd);
  if (lineBreak > minEnd && !isInsideRange(lineBreak + 1, protectedRanges)) {
    return lineBreak + 1;
  }

  return maxEnd;
}

function nextChunkStart(
  end: number,
  currentStart: number,
  protectedRanges: readonly Range[],
): number {
  const overlapStart = Math.max(0, end - MEMORY_DRAWER_OVERLAP_CHARS);
  if (overlapStart <= currentStart || isInsideRange(overlapStart, protectedRanges)) {
    return end;
  }
  return overlapStart;
}

export function chunkMemoryDrawerContent(rawContent: string): MemoryDrawerChunk[] {
  const content = normalizeMemoryDrawerContent(rawContent);
  if (content.trim().length === 0) {
    return [];
  }

  const protectedRanges = findFencedCodeRanges(content);
  const boundaries = collectBoundaryPositions(content, protectedRanges);
  const chunks: MemoryDrawerChunk[] = [];
  let start = 0;

  while (start < content.length) {
    const end = chooseChunkEnd(content, start, boundaries, protectedRanges);
    const chunkContent = content.slice(start, end);
    chunks.push({
      chunkIndex: chunks.length,
      content: chunkContent,
      startOffset: start,
      endOffset: end,
      overlapStartOffset: chunks.length === 0 ? start : start,
      sourceJson: {},
    });

    if (end >= content.length) {
      break;
    }

    start = nextChunkStart(end, start, protectedRanges);
  }

  return chunks;
}

function overlapLength(left: string, right: string): number {
  const max = Math.min(MEMORY_DRAWER_OVERLAP_CHARS, left.length, right.length);
  for (let size = max; size > 0; size -= 1) {
    if (left.endsWith(right.slice(0, size))) {
      return size;
    }
  }
  return 0;
}

export function reconstructMemoryDrawerContent(chunks: readonly MemoryDrawerChunk[]): string {
  if (chunks.length === 0) {
    return '';
  }

  let content = chunks[0]?.content ?? '';
  for (const chunk of chunks.slice(1)) {
    content += chunk.content.slice(overlapLength(content, chunk.content));
  }
  return content;
}
