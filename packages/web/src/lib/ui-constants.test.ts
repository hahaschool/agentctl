import { describe, expect, it } from 'vitest';

import {
  CONFIRM_BUTTON_TIMEOUT_MS,
  CONTENT_INVALIDATION_DELAY_MS,
  COPY_FEEDBACK_MS,
  DRAFT_SAVE_DEBOUNCE_MS,
  IME_COMPOSITION_GUARD_MS,
  INLINE_ATTACHMENT_LIMIT,
  MAX_ATTACHMENT_SIZE_BYTES,
  MESSAGE_TRUNCATE_THRESHOLD,
  MESSAGE_WINDOWING_THRESHOLD,
  SESSION_CONTENT_PAGE_SIZE,
  SESSION_PREVIEW_FETCH_LIMIT,
  TERMINAL_SPAWN_COLS,
  TERMINAL_SPAWN_ROWS,
  TOAST_DISMISS_ANIMATION_MS,
  TOAST_DURATION_MS,
  TOAST_ERROR_DURATION_MS,
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

  it('SESSION_CONTENT_PAGE_SIZE is a positive number', () => {
    expect(SESSION_CONTENT_PAGE_SIZE).toBeGreaterThan(0);
    expect(typeof SESSION_CONTENT_PAGE_SIZE).toBe('number');
  });

  it('MESSAGE_TRUNCATE_THRESHOLD is a positive number', () => {
    expect(MESSAGE_TRUNCATE_THRESHOLD).toBeGreaterThan(0);
    expect(typeof MESSAGE_TRUNCATE_THRESHOLD).toBe('number');
  });

  it('MESSAGE_WINDOWING_THRESHOLD is a positive number', () => {
    expect(MESSAGE_WINDOWING_THRESHOLD).toBeGreaterThan(0);
    expect(typeof MESSAGE_WINDOWING_THRESHOLD).toBe('number');
  });

  it('TOAST_DURATION_MS equals 5000', () => {
    expect(TOAST_DURATION_MS).toBe(5000);
  });

  it('TOAST_ERROR_DURATION_MS equals 8000', () => {
    expect(TOAST_ERROR_DURATION_MS).toBe(8000);
  });

  it('TOAST_DISMISS_ANIMATION_MS equals 300', () => {
    expect(TOAST_DISMISS_ANIMATION_MS).toBe(300);
  });

  it('CONFIRM_BUTTON_TIMEOUT_MS equals 3000', () => {
    expect(CONFIRM_BUTTON_TIMEOUT_MS).toBe(3000);
  });

  it('SESSION_PREVIEW_FETCH_LIMIT is a positive number', () => {
    expect(SESSION_PREVIEW_FETCH_LIMIT).toBeGreaterThan(0);
    expect(typeof SESSION_PREVIEW_FETCH_LIMIT).toBe('number');
  });

  it('TERMINAL_SPAWN_COLS equals 120', () => {
    expect(TERMINAL_SPAWN_COLS).toBe(120);
  });

  it('TERMINAL_SPAWN_ROWS equals 30', () => {
    expect(TERMINAL_SPAWN_ROWS).toBe(30);
  });
});
