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
