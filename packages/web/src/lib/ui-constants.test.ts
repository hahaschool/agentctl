import { describe, expect, it } from 'vitest';

import {
  CONTENT_INVALIDATION_DELAY_MS,
  COPY_FEEDBACK_MS,
  DRAFT_SAVE_DEBOUNCE_MS,
  IME_COMPOSITION_GUARD_MS,
  INLINE_ATTACHMENT_LIMIT,
  MAX_ATTACHMENT_SIZE_BYTES,
} from './ui-constants';

describe('ui-constants', () => {
  it('COPY_FEEDBACK_MS is a positive number', () => {
    expect(COPY_FEEDBACK_MS).toBeGreaterThan(0);
    expect(typeof COPY_FEEDBACK_MS).toBe('number');
  });

  it('DRAFT_SAVE_DEBOUNCE_MS is a positive number', () => {
    expect(DRAFT_SAVE_DEBOUNCE_MS).toBeGreaterThan(0);
    expect(typeof DRAFT_SAVE_DEBOUNCE_MS).toBe('number');
  });

  it('MAX_ATTACHMENT_SIZE_BYTES equals 10 MB', () => {
    expect(MAX_ATTACHMENT_SIZE_BYTES).toBe(10 * 1024 * 1024);
  });

  it('INLINE_ATTACHMENT_LIMIT is a positive number', () => {
    expect(INLINE_ATTACHMENT_LIMIT).toBeGreaterThan(0);
    expect(typeof INLINE_ATTACHMENT_LIMIT).toBe('number');
  });

  it('CONTENT_INVALIDATION_DELAY_MS is a positive number', () => {
    expect(CONTENT_INVALIDATION_DELAY_MS).toBeGreaterThan(0);
    expect(typeof CONTENT_INVALIDATION_DELAY_MS).toBe('number');
  });

  it('IME_COMPOSITION_GUARD_MS is a positive number', () => {
    expect(IME_COMPOSITION_GUARD_MS).toBeGreaterThan(0);
    expect(typeof IME_COMPOSITION_GUARD_MS).toBe('number');
  });
});
