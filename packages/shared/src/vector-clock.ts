/** Maps nodeId → logical counter. */
export type VectorClock = Record<string, number>;

/** Returns true if a causally dominates b (a happened strictly after b). */
export function vcDominates(a: VectorClock, b: VectorClock): boolean {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dominated = false;
  for (const k of allKeys) {
    const av = a[k] ?? 0;
    const bv = b[k] ?? 0;
    if (av < bv) return false;
    if (av > bv) dominated = true;
  }
  return dominated;
}

/** Merge two vector clocks (element-wise max). */
export function vcMerge(a: VectorClock, b: VectorClock): VectorClock {
  const result: VectorClock = { ...a };
  for (const [k, v] of Object.entries(b)) {
    result[k] = Math.max(result[k] ?? 0, v);
  }
  return result;
}

/** Compare two vector clocks for causal ordering. */
export function vcCompare(
  a: VectorClock,
  b: VectorClock,
): 'a_dominates' | 'b_dominates' | 'equal' | 'conflict' {
  if (vcDominates(a, b)) return 'a_dominates';
  if (vcDominates(b, a)) return 'b_dominates';
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const equal = [...allKeys].every((k) => (a[k] ?? 0) === (b[k] ?? 0));
  return equal ? 'equal' : 'conflict';
}
