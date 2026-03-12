import { describe, expect, it } from 'vitest';

import { detectCycles, topologicalSort, validateTaskGraph } from './dag-validation.js';
import type { TaskEdge } from './types/task-graph.js';

function edge(from: string, to: string, type: TaskEdge['type'] = 'blocks'): TaskEdge {
  return { fromDefinition: from, toDefinition: to, type };
}

describe('detectCycles', () => {
  it('returns null for an empty graph', () => {
    expect(detectCycles([], [])).toBeNull();
  });

  it('returns null for a linear chain', () => {
    const nodes = ['a', 'b', 'c'];
    const edges = [edge('a', 'b'), edge('b', 'c')];
    expect(detectCycles(nodes, edges)).toBeNull();
  });

  it('returns null for a diamond graph (no cycle)', () => {
    const nodes = ['a', 'b', 'c', 'd'];
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')];
    expect(detectCycles(nodes, edges)).toBeNull();
  });

  it('detects a simple A->B->A cycle', () => {
    const nodes = ['a', 'b'];
    const edges = [edge('a', 'b'), edge('b', 'a')];
    const cycle = detectCycles(nodes, edges);
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBeGreaterThanOrEqual(2);
  });

  it('detects a three-node cycle', () => {
    const nodes = ['a', 'b', 'c'];
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')];
    const cycle = detectCycles(nodes, edges);
    expect(cycle).not.toBeNull();
  });

  it('detects a self-loop', () => {
    const nodes = ['a'];
    const edges = [edge('a', 'a')];
    const cycle = detectCycles(nodes, edges);
    expect(cycle).not.toBeNull();
  });

  it('returns null for disconnected acyclic nodes', () => {
    const nodes = ['a', 'b', 'c'];
    expect(detectCycles(nodes, [])).toBeNull();
  });
});

describe('topologicalSort', () => {
  it('sorts an empty graph', () => {
    expect(topologicalSort([], [])).toEqual([]);
  });

  it('sorts a linear chain', () => {
    const nodes = ['a', 'b', 'c'];
    const edges = [edge('a', 'b'), edge('b', 'c')];
    expect(topologicalSort(nodes, edges)).toEqual(['a', 'b', 'c']);
  });

  it('sorts a diamond graph', () => {
    const nodes = ['a', 'b', 'c', 'd'];
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')];
    const result = topologicalSort(nodes, edges);

    // 'a' must come first, 'd' must come last
    expect(result[0]).toBe('a');
    expect(result[result.length - 1]).toBe('d');
    expect(result.length).toBe(4);
  });

  it('places disconnected nodes in the result', () => {
    const nodes = ['a', 'b', 'c'];
    const result = topologicalSort(nodes, []);
    expect(result.sort()).toEqual(['a', 'b', 'c']);
  });

  it('throws on a cycle', () => {
    const nodes = ['a', 'b'];
    const edges = [edge('a', 'b'), edge('b', 'a')];
    expect(() => topologicalSort(nodes, edges)).toThrow('cycles');
  });

  it('ignores context edges for ordering', () => {
    const nodes = ['a', 'b', 'c'];
    // 'blocks' edge: a -> b, 'context' edge: c -> a (should not constrain order)
    const edges = [edge('a', 'b', 'blocks'), edge('c', 'a', 'context')];
    const result = topologicalSort(nodes, edges);
    // 'a' must come before 'b', but 'c' is free
    const aIdx = result.indexOf('a');
    const bIdx = result.indexOf('b');
    expect(aIdx).toBeLessThan(bIdx);
    expect(result.length).toBe(3);
  });
});

describe('validateTaskGraph', () => {
  it('returns valid for an empty graph', () => {
    const result = validateTaskGraph([], []);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.topologicalOrder).toEqual([]);
  });

  it('returns valid for a well-formed DAG', () => {
    const nodes = ['a', 'b', 'c'];
    const edges = [edge('a', 'b'), edge('b', 'c')];
    const result = validateTaskGraph(nodes, edges);
    expect(result.valid).toBe(true);
    expect(result.topologicalOrder).toEqual(['a', 'b', 'c']);
  });

  it('reports orphan edge sources', () => {
    const nodes = ['b'];
    const edges = [edge('a', 'b')];
    const result = validateTaskGraph(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown source definition'))).toBe(true);
  });

  it('reports orphan edge targets', () => {
    const nodes = ['a'];
    const edges = [edge('a', 'z')];
    const result = validateTaskGraph(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown target definition'))).toBe(true);
  });

  it('reports self-loops', () => {
    const nodes = ['a'];
    const edges = [edge('a', 'a')];
    const result = validateTaskGraph(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Self-loop'))).toBe(true);
  });

  it('reports cycles', () => {
    const nodes = ['a', 'b', 'c'];
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')];
    const result = validateTaskGraph(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Cycle detected'))).toBe(true);
    expect(result.topologicalOrder).toBeNull();
  });

  it('returns topological order for valid graph', () => {
    const nodes = ['x', 'y', 'z'];
    const edges = [edge('x', 'y'), edge('y', 'z')];
    const result = validateTaskGraph(nodes, edges);
    expect(result.valid).toBe(true);
    expect(result.topologicalOrder).toEqual(['x', 'y', 'z']);
  });
});
