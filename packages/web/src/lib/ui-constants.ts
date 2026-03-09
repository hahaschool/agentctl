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

/** Number of session content messages to fetch per page in session detail views. */
export const SESSION_CONTENT_PAGE_SIZE = 200;

/** Character threshold above which long message content is truncated with "show more". */
export const MESSAGE_TRUNCATE_THRESHOLD = 800;

/** Number of messages above which the message list enables virtual windowing. */
export const MESSAGE_WINDOWING_THRESHOLD = 200;

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

/** Duration (ms) for success/info toast notifications before auto-dismiss. */
export const TOAST_DURATION_MS = 5000;

/** Duration (ms) for error toast notifications before auto-dismiss. */
export const TOAST_ERROR_DURATION_MS = 8000;

/** Duration (ms) of the toast dismiss slide-out animation. */
export const TOAST_DISMISS_ANIMATION_MS = 300;

// ---------------------------------------------------------------------------
// ConfirmButton
// ---------------------------------------------------------------------------

/** Default timeout (ms) before ConfirmButton reverts to its initial state. */
export const CONFIRM_BUTTON_TIMEOUT_MS = 3000;

// ---------------------------------------------------------------------------
// SessionPreview
// ---------------------------------------------------------------------------

/** Number of messages to fetch when loading a session preview panel. */
export const SESSION_PREVIEW_FETCH_LIMIT = 200;

// ---------------------------------------------------------------------------
// Terminal spawn defaults
// ---------------------------------------------------------------------------

/** Default column count when spawning an interactive terminal. */
export const TERMINAL_SPAWN_COLS = 120;

/** Default row count when spawning an interactive terminal. */
export const TERMINAL_SPAWN_ROWS = 30;
