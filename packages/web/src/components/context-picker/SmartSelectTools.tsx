'use client';

import React from 'react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DECISION_PATTERNS = [
  /\bdecid(?:ed|e|ing)\b/i,
  /\bdecision\b/i,
  /\bcho(?:se|ice|ose|osing)\b/i,
  /\bgoing with\b/i,
  /\blet'?s go with\b/i,
  /\bwe(?:'ll| will) use\b/i,
  /\binstead of\b/i,
  /\bapproach[:\s]/i,
  /\bstrategy[:\s]/i,
  /\btrade-?off/i,
  /\barchitect(?:ure|ural)/i,
];

/** Matches file paths in message content (absolute or relative paths with extensions). */
const FILE_PATH_REGEX = /(?:^|\s)((?:\/[\w./-]+|[\w.-]+\/[\w./-]+)(?:\.\w{1,10})?)/gm;

/** Matches recognised Claude Code tool names referenced in message content. */
const TOOL_NAME_REGEX = /\b(Read|Write|Edit|Bash|Glob|Grep|Task|WebFetch|WebSearch)\b/g;

// ---------------------------------------------------------------------------
// Pure selection helpers
// ---------------------------------------------------------------------------

export function findKeyDecisionIndices(
  messages: { type: string; content: string }[],
  contextRadius = 1,
): number[] {
  const matchIndices = new Set<number>();
  const skipTypes = new Set(['tool_use', 'tool_result', 'progress']);

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || skipTypes.has(msg.type)) continue;
    if (DECISION_PATTERNS.some((pat) => pat.test(msg.content))) {
      for (
        let j = Math.max(0, i - contextRadius);
        j <= Math.min(messages.length - 1, i + contextRadius);
        j++
      ) {
        const ctx = messages[j];
        if (ctx && !skipTypes.has(ctx.type)) {
          matchIndices.add(j);
        }
      }
    }
  }

  return Array.from(matchIndices).sort((a, b) => a - b);
}

/**
 * Find message indices whose content matches any keyword in the given topic.
 * Uses case-insensitive substring matching for speed on large histories.
 */
export function findByTopicIndices(
  messages: { type: string; content: string }[],
  topic: string,
  contextRadius = 1,
): number[] {
  const trimmed = topic.trim().toLowerCase();
  if (!trimmed) return [];

  const keywords = trimmed.split(/\s+/).filter((w) => w.length >= 3);
  if (keywords.length === 0) return [];

  const matchIndices = new Set<number>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;
    const lower = msg.content.toLowerCase();

    const isMatch = keywords.some((kw) => lower.includes(kw));
    if (isMatch) {
      for (
        let j = Math.max(0, i - contextRadius);
        j <= Math.min(messages.length - 1, i + contextRadius);
        j++
      ) {
        matchIndices.add(j);
      }
    }
  }

  return Array.from(matchIndices).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Helpers for findRelatedMessages
// ---------------------------------------------------------------------------

function extractFilePaths(content: string): string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(FILE_PATH_REGEX)) {
    const path = match[1];
    if (path) found.add(path);
  }
  return Array.from(found);
}

function extractToolNames(content: string): string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(TOOL_NAME_REGEX)) {
    const name = match[1];
    if (name) found.add(name);
  }
  return Array.from(found);
}

// ---------------------------------------------------------------------------
// findRelatedMessages
// ---------------------------------------------------------------------------

/**
 * Given a set of anchor message indices, find all messages that are "related":
 *  - Same file paths appear in the message content
 *  - Same tool names are referenced
 *  - Immediately adjacent conversation turns (contextRadius = 1 by default)
 *
 * The anchor indices themselves are always included in the result.
 */
export function findRelatedMessages(
  messages: { type: string; content: string }[],
  anchorIndices: ReadonlySet<number>,
  contextRadius = 1,
): number[] {
  if (anchorIndices.size === 0 || messages.length === 0) return [];

  // Collect all file paths + tool names referenced in anchor messages.
  const anchorFilePaths = new Set<string>();
  const anchorToolNames = new Set<string>();

  for (const idx of anchorIndices) {
    const msg = messages[idx];
    if (!msg) continue;
    for (const p of extractFilePaths(msg.content)) anchorFilePaths.add(p);
    for (const t of extractToolNames(msg.content)) anchorToolNames.add(t);
  }

  const relatedIndices = new Set<number>(anchorIndices);

  // Find messages that share file paths or tool names with the anchors.
  for (let i = 0; i < messages.length; i++) {
    if (relatedIndices.has(i)) continue;
    const msg = messages[i];
    if (!msg) continue;

    const filePaths = extractFilePaths(msg.content);
    const toolNames = extractToolNames(msg.content);

    const sharesFilePath =
      anchorFilePaths.size > 0 && filePaths.some((p) => anchorFilePaths.has(p));
    const sharesTool = anchorToolNames.size > 0 && toolNames.some((t) => anchorToolNames.has(t));

    if (sharesFilePath || sharesTool) {
      relatedIndices.add(i);
    }
  }

  // Expand with conversation-turn adjacency (contextRadius around each anchor).
  for (const idx of Array.from(anchorIndices)) {
    const start = Math.max(0, idx - contextRadius);
    const end = Math.min(messages.length - 1, idx + contextRadius);
    for (let j = start; j <= end; j++) {
      relatedIndices.add(j);
    }
  }

  return Array.from(relatedIndices).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// SelectRelatedButton component
// ---------------------------------------------------------------------------

export type SelectRelatedButtonProps = {
  /** Currently selected message indices (the anchors). */
  selectedIndices: ReadonlySet<number>;
  /** All messages in the session. */
  messages: { type: string; content: string }[];
  /** Called with the expanded set of indices after computing related messages. */
  onSelect: (indices: number[]) => void;
  /** Context radius passed to findRelatedMessages. Defaults to 1. */
  contextRadius?: number;
};

export const SelectRelatedButton = React.memo(function SelectRelatedButton({
  selectedIndices,
  messages,
  onSelect,
  contextRadius = 1,
}: SelectRelatedButtonProps): React.ReactNode {
  const handleClick = React.useCallback(() => {
    const related = findRelatedMessages(messages, selectedIndices, contextRadius);
    if (related.length > 0) {
      onSelect(related);
    }
  }, [messages, selectedIndices, onSelect, contextRadius]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={selectedIndices.size === 0}
      aria-label="Auto-select related messages"
      className="px-2 py-0.5 min-h-[44px] min-w-[44px] text-[10px] text-purple-600 dark:text-purple-400 border border-purple-300/50 dark:border-purple-800/50 rounded-md hover:bg-purple-100/50 dark:hover:bg-purple-900/30 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center"
    >
      Select Related
    </button>
  );
});
