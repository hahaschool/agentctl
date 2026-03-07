/** Duration (ms) to show "Copied!" feedback after clipboard copy. */
export const COPY_FEEDBACK_MS = 2000;

/** Duration (ms) to debounce draft persistence in MessageInput. */
export const DRAFT_SAVE_DEBOUNCE_MS = 300;

/** Maximum file size (bytes) for attachments — 10 MB. */
export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;

/** Max content length for inlining file attachments as text in the message. */
export const INLINE_ATTACHMENT_LIMIT = 5000;

/** Delay (ms) before invalidating session content after send — lets CLI flush JSONL. */
export const CONTENT_INVALIDATION_DELAY_MS = 500;

/** Delay (ms) after compositionend before clearing the IME guard flag. */
export const IME_COMPOSITION_GUARD_MS = 100;
