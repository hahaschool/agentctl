import type { TaskEdge } from './types/task-graph.js';

/**
 * Adjacency list built from task edges.
 * Key = source definition ID, Value = set of target definition IDs.
 */
type AdjacencyMap = Map<string, Set<string>>;

function buildAdjacencyMap(edges: ReadonlyArray<TaskEdge>): AdjacencyMap {
  const adj: AdjacencyMap = new Map();
  for (const edge of edges) {
    const existing = adj.get(edge.fromDefinition);
    if (existing) {
      existing.add(edge.toDefinition);
    } else {
      adj.set(edge.fromDefinition, new Set([edge.toDefinition]));
    }
  }
  return adj;
}

/**
 * Detect cycles in the task graph using DFS.
 * Returns the first cycle found as an ordered array of definition IDs, or null.
 */
export function detectCycles(
  nodeIds: ReadonlyArray<string>,
  edges: ReadonlyArray<TaskEdge>,
): string[] | null {
  const adj = buildAdjacencyMap(edges);
  const WHITE = 0; // unvisited
  const GRAY = 1; // in current DFS path
  const BLACK = 2; // fully processed

  const color = new Map<string, number>();
  for (const id of nodeIds) {
    color.set(id, WHITE);
  }

  const parent = new Map<string, string | null>();

  function dfs(node: string): string[] | null {
    color.set(node, GRAY);

    const neighbors = adj.get(node);
    if (neighbors) {
      for (const neighbor of neighbors) {
        const neighborColor = color.get(neighbor) ?? WHITE;

        if (neighborColor === GRAY) {
          // Found a cycle: reconstruct path
          const cycle: string[] = [neighbor, node];
          let current = node;
          while (parent.get(current) !== null && parent.get(current) !== neighbor) {
            current = parent.get(current) as string;
            cycle.push(current);
          }
          return cycle.reverse();
        }

        if (neighborColor === WHITE) {
          parent.set(neighbor, node);
          const result = dfs(neighbor);
          if (result) {
            return result;
          }
        }
      }
    }

    color.set(node, BLACK);
    return null;
  }

  for (const id of nodeIds) {
    if (color.get(id) === WHITE) {
      parent.set(id, null);
      const cycle = dfs(id);
      if (cycle) {
        return cycle;
      }
    }
  }

  return null;
}

/**
 * Produce a topological ordering of task definition IDs using Kahn's algorithm.
 * Returns ordered IDs. Throws if the graph contains cycles.
 */
export function topologicalSort(
  nodeIds: ReadonlyArray<string>,
  edges: ReadonlyArray<TaskEdge>,
): string[] {
  // Only consider 'blocks' edges for execution ordering.
  // 'context' edges provide data flow but don't constrain order.
  const blockingEdges = edges.filter((e) => e.type === 'blocks');

  const inDegree = new Map<string, number>();
  for (const id of nodeIds) {
    inDegree.set(id, 0);
  }

  const adj = buildAdjacencyMap(blockingEdges);

  for (const edge of blockingEdges) {
    inDegree.set(edge.toDefinition, (inDegree.get(edge.toDefinition) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  const result: string[] = [];

  while (queue.length > 0) {
    const node = queue.shift() as string;
    result.push(node);

    const neighbors = adj.get(node);
    if (neighbors) {
      for (const neighbor of neighbors) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }
  }

  if (result.length !== nodeIds.length) {
    throw new Error('Task graph contains cycles — topological sort is impossible');
  }

  return result;
}

export type DagValidationResult = {
  readonly valid: boolean;
  readonly errors: string[];
  readonly topologicalOrder: string[] | null;
};

/**
 * Comprehensive validation of a task graph's DAG structure.
 * Checks for: cycles, orphan edges, and basic structural integrity.
 */
export function validateTaskGraph(
  nodeIds: ReadonlyArray<string>,
  edges: ReadonlyArray<TaskEdge>,
): DagValidationResult {
  const errors: string[] = [];
  const nodeSet = new Set(nodeIds);

  // Check for edges referencing non-existent nodes
  for (const edge of edges) {
    if (!nodeSet.has(edge.fromDefinition)) {
      errors.push(`Edge references unknown source definition: ${edge.fromDefinition}`);
    }
    if (!nodeSet.has(edge.toDefinition)) {
      errors.push(`Edge references unknown target definition: ${edge.toDefinition}`);
    }
  }

  // Check for self-loops
  for (const edge of edges) {
    if (edge.fromDefinition === edge.toDefinition) {
      errors.push(`Self-loop detected on definition: ${edge.fromDefinition}`);
    }
  }

  // Check for cycles
  const cycle = detectCycles(nodeIds, edges);
  if (cycle) {
    errors.push(`Cycle detected: ${cycle.join(' -> ')}`);
  }

  // Attempt topological sort
  let topologicalOrder: string[] | null = null;
  if (errors.length === 0) {
    try {
      topologicalOrder = topologicalSort(nodeIds, edges);
    } catch {
      errors.push('Failed to compute topological order');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    topologicalOrder,
  };
}
