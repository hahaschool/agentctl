/**
 * Fuzzy search utilities for the command palette and other search UIs.
 */

/**
 * Compute the Levenshtein edit-distance between two strings.
 * Used to provide typo tolerance when subsequence matching fails.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Single-row DP to save memory
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  let curr: number[] = new Array(n + 1).fill(0) as number[];

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] as number) + 1,
        (curr[j - 1] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n] as number;
}

/**
 * Score how well `query` fuzzy-matches `text`.
 * Returns a number where higher = better match, or `null` if no match.
 *
 * Strategy (in priority order):
 *  1. Exact substring match → highest score (100 + bonus for position)
 *  2. Subsequence match → score based on gap tightness (10–80)
 *  3. Levenshtein distance ≤ threshold → score inversely proportional to distance (1–9)
 *  4. No match → null
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  // --- 1. Exact substring ---
  const subIdx = t.indexOf(q);
  if (subIdx !== -1) {
    // Bonus: earlier position → higher score; starts-with gets extra bump
    const positionBonus = Math.max(0, 20 - subIdx);
    return 100 + positionBonus;
  }

  // --- 2. Subsequence matching ---
  // Walk through `t` greedily, tracking gaps between matched characters.
  let qi = 0;
  let totalGap = 0;
  let lastMatch = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      if (lastMatch !== -1) {
        totalGap += ti - lastMatch - 1;
      }
      lastMatch = ti;
      qi++;
    }
  }
  if (qi === q.length) {
    // All query characters found in order.
    // Score: fewer gaps → higher score, capped to 10–80 range.
    const maxGap = t.length;
    const tightness = 1 - totalGap / maxGap;
    return 10 + Math.round(tightness * 70);
  }

  // --- 3. Levenshtein (typo tolerance) ---
  // Only apply when query is long enough to make edit distance meaningful,
  // and compare against every window of `t` of length ≈ q.length ± 2.
  if (q.length >= 3) {
    const threshold = q.length <= 4 ? 1 : q.length <= 7 ? 2 : 3;
    let bestDist = threshold + 1;

    // Sliding window comparison for partial matches within the text
    for (
      let winLen = Math.max(1, q.length - threshold);
      winLen <= q.length + threshold && winLen <= t.length;
      winLen++
    ) {
      for (let start = 0; start + winLen <= t.length; start++) {
        const window = t.slice(start, start + winLen);
        const dist = levenshtein(q, window);
        if (dist < bestDist) {
          bestDist = dist;
          if (dist === 0) break; // can't do better
        }
      }
      if (bestDist === 0) break;
    }

    if (bestDist <= threshold) {
      // Score: lower distance → higher score within 1–9 range
      return Math.round(9 * (1 - bestDist / (threshold + 1)));
    }
  }

  return null;
}
