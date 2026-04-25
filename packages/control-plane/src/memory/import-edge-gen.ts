// ---------------------------------------------------------------------------
// Import Edge Generation
//
// After a batch of memory_facts rows is committed to the DB during a
// claude-mem or JSONL import, this module generates memory_edges that
// connect related facts based on:
//
//  1. Concept co-occurrence — two facts sharing one or more concepts from
//     claude-mem observation metadata get a `related_to` edge. Weight
//     accumulates at 0.2 per shared concept, capped at 0.8.
//
//  2. Session context — facts from the same session that do NOT already
//     have a concept-overlap edge get a weak `related_to` edge (weight 0.1).
//
//  3. JSONL cross-session co-occurrence — when two consecutive imported JSONL
//     sessions share project path components, the first fact of each session
//     gets a `related_to` edge with weight 0.05 (`co_occurred`).
//
// Idempotency: the unique constraint on (source_fact_id, target_fact_id,
// relation) means ON CONFLICT DO NOTHING makes all inserts safe to repeat.
// ---------------------------------------------------------------------------

import type { Pool } from 'pg';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EdgeSourceData = {
  factId: string;
  sessionId: string | null;
  concepts: string[];
  projectPath: string | null;
};

type PendingEdge = {
  sourceFactId: string;
  targetFactId: string;
  relation: string;
  weight: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONCEPT_WEIGHT_PER_SHARED = 0.2;
const MAX_CONCEPT_WEIGHT = 0.8;
const SESSION_CONTEXT_WEIGHT = 0.1;
const JSONL_CO_OCCURRED_WEIGHT = 0.05;
const RELATION_RELATED_TO = 'related_to';

// ---------------------------------------------------------------------------
// ID generation (mirrors pattern from memory-store.ts)
// ---------------------------------------------------------------------------

function generateEdgeId(): string {
  const timestamp = Date.now().toString(36).padStart(10, '0');
  const random = Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join(
    '',
  );
  return `me_${timestamp}${random}`;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Compute the `related_to` weight for two facts sharing `sharedCount`
 * concepts. Weight is 0.2 per shared concept, capped at 0.8.
 */
export function computeConceptWeight(sharedCount: number): number {
  return Math.min(sharedCount * CONCEPT_WEIGHT_PER_SHARED, MAX_CONCEPT_WEIGHT);
}

/**
 * Determine the canonical pair key (smaller id first) to de-duplicate
 * pending edges within a batch before hitting the DB.
 */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

/**
 * Count how many elements two arrays share (case-insensitive).
 */
export function countSharedConcepts(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a.map((s) => s.toLowerCase()));
  return b.reduce((acc, c) => (setA.has(c.toLowerCase()) ? acc + 1 : acc), 0);
}

/**
 * Check if two project paths share at least one non-trivial path component.
 * A trivial component is empty, '.', or very short (≤ 2 chars).
 */
export function shareProjectComponent(pathA: string | null, pathB: string | null): boolean {
  if (!pathA || !pathB) return false;
  const partsA = new Set(pathA.split('/').filter((p) => p.length > 2 && p !== '.' && p !== '..'));
  return pathB.split('/').some((p) => p.length > 2 && p !== '.' && p !== '..' && partsA.has(p));
}

// ---------------------------------------------------------------------------
// Edge collection logic (pure, operates on EdgeSourceData[])
// ---------------------------------------------------------------------------

/**
 * Build pending edges from concept co-occurrence within the batch.
 * Returns a Map from pairKey → PendingEdge (highest-weight wins per pair).
 */
export function buildConceptEdges(items: EdgeSourceData[]): Map<string, PendingEdge> {
  const edgeMap = new Map<string, PendingEdge>();

  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    if (a.concepts.length === 0) continue;

    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      if (b.concepts.length === 0) continue;

      const shared = countSharedConcepts(a.concepts, b.concepts);
      if (shared === 0) continue;

      const weight = computeConceptWeight(shared);
      const key = pairKey(a.factId, b.factId);
      const existing = edgeMap.get(key);

      if (!existing || existing.weight < weight) {
        const [src, tgt] = a.factId < b.factId ? [a.factId, b.factId] : [b.factId, a.factId];
        edgeMap.set(key, {
          sourceFactId: src,
          targetFactId: tgt,
          relation: RELATION_RELATED_TO,
          weight,
        });
      }
    }
  }

  return edgeMap;
}

/**
 * Build session-context edges for pairs that share a sessionId but do not
 * already have a concept-overlap edge in `existingPairKeys`.
 */
export function buildSessionEdges(
  items: EdgeSourceData[],
  existingPairKeys: ReadonlySet<string>,
): PendingEdge[] {
  const sessionGroups = new Map<string, string[]>();
  for (const item of items) {
    if (!item.sessionId) continue;
    const group = sessionGroups.get(item.sessionId) ?? [];
    group.push(item.factId);
    sessionGroups.set(item.sessionId, group);
  }

  const edges: PendingEdge[] = [];
  for (const factIds of sessionGroups.values()) {
    if (factIds.length < 2) continue;
    for (let i = 0; i < factIds.length; i++) {
      for (let j = i + 1; j < factIds.length; j++) {
        const key = pairKey(factIds[i], factIds[j]);
        if (existingPairKeys.has(key)) continue;
        const [src, tgt] =
          factIds[i] < factIds[j] ? [factIds[i], factIds[j]] : [factIds[j], factIds[i]];
        edges.push({
          sourceFactId: src,
          targetFactId: tgt,
          relation: RELATION_RELATED_TO,
          weight: SESSION_CONTEXT_WEIGHT,
        });
      }
    }
  }
  return edges;
}

/**
 * Build JSONL cross-session edges: for each consecutive pair of sessions
 * (by index in the items array that have distinct sessionIds), if they share
 * a project path component, link the first fact of session N with the first
 * fact of session N+1.
 *
 * Items are expected in import order. Only one edge per consecutive session pair.
 */
export function buildJsonlSessionEdges(items: EdgeSourceData[]): PendingEdge[] {
  // Collect first-fact-id per session in order of first appearance
  const seenSessions = new Map<string, string>(); // sessionId → firstFactId
  const orderedSessions: Array<{ sessionId: string; factId: string; projectPath: string | null }> =
    [];

  for (const item of items) {
    if (!item.sessionId) continue;
    if (!seenSessions.has(item.sessionId)) {
      seenSessions.set(item.sessionId, item.factId);
      orderedSessions.push({
        sessionId: item.sessionId,
        factId: item.factId,
        projectPath: item.projectPath,
      });
    }
  }

  const edges: PendingEdge[] = [];
  for (let i = 0; i < orderedSessions.length - 1; i++) {
    const curr = orderedSessions[i];
    const next = orderedSessions[i + 1];
    if (!shareProjectComponent(curr.projectPath, next.projectPath)) continue;
    const [src, tgt] =
      curr.factId < next.factId ? [curr.factId, next.factId] : [next.factId, curr.factId];
    edges.push({
      sourceFactId: src,
      targetFactId: tgt,
      relation: RELATION_RELATED_TO,
      weight: JSONL_CO_OCCURRED_WEIGHT,
    });
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Database insertion
// ---------------------------------------------------------------------------

/**
 * Insert edges into memory_edges using parameterized queries.
 * Uses ON CONFLICT DO NOTHING so re-running is safe (idempotent).
 */
async function insertEdges(pool: Pool, edges: PendingEdge[]): Promise<number> {
  if (edges.length === 0) return 0;

  let inserted = 0;
  for (const edge of edges) {
    const id = generateEdgeId();
    const result = await pool.query(
      `INSERT INTO memory_edges (id, source_fact_id, target_fact_id, relation, weight)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source_fact_id, target_fact_id, relation) DO NOTHING`,
      [id, edge.sourceFactId, edge.targetFactId, edge.relation, edge.weight],
    );
    if ((result.rowCount ?? 0) > 0) {
      inserted++;
    }
  }
  return inserted;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type GenerateImportEdgesResult = {
  conceptEdges: number;
  sessionEdges: number;
  inserted: number;
};

/**
 * Generate and persist relationship edges for a batch of newly-imported facts.
 *
 * For claude-mem imports: pass items with concepts populated.
 * For JSONL imports: pass items with projectPath populated and concepts empty.
 *
 * @param pool - PostgreSQL connection pool
 * @param items - Source metadata for each imported fact
 * @param mode  - 'claude-mem' uses concept + session edges; 'jsonl' uses cross-session edges
 */
export async function generateImportEdges(
  pool: Pool,
  items: EdgeSourceData[],
  mode: 'claude-mem' | 'jsonl',
): Promise<GenerateImportEdgesResult> {
  if (items.length === 0) {
    return { conceptEdges: 0, sessionEdges: 0, inserted: 0 };
  }

  const pendingEdges: PendingEdge[] = [];

  if (mode === 'claude-mem') {
    const conceptEdgeMap = buildConceptEdges(items);
    const conceptEdges = [...conceptEdgeMap.values()];
    pendingEdges.push(...conceptEdges);

    const conceptPairKeys = new Set(conceptEdgeMap.keys());
    const sessionEdges = buildSessionEdges(items, conceptPairKeys);
    pendingEdges.push(...sessionEdges);

    const inserted = await insertEdges(pool, pendingEdges);
    return {
      conceptEdges: conceptEdges.length,
      sessionEdges: sessionEdges.length,
      inserted,
    };
  }

  // jsonl mode: cross-session co-occurrence edges only
  const sessionEdges = buildJsonlSessionEdges(items);
  pendingEdges.push(...sessionEdges);

  const inserted = await insertEdges(pool, pendingEdges);
  return {
    conceptEdges: 0,
    sessionEdges: sessionEdges.length,
    inserted,
  };
}
