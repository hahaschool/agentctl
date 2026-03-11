import { describe, expect, it } from 'vitest';

import { DEFAULT_INJECTION_BUDGET } from '../index.js';
import type {
  EntityType,
  FactSource,
  InjectionBudget,
  MemoryEdge,
  MemoryFact,
  MemoryScope,
  MemorySearchResult,
  RelationType,
} from './memory.js';

describe('memory types', () => {
  it('supports all four memory scopes', () => {
    const scopes: MemoryScope[] = ['global', 'project:agentctl', 'agent:worker-1', 'session:s-1'];
    expect(scopes).toEqual(['global', 'project:agentctl', 'agent:worker-1', 'session:s-1']);
  });

  it('supports the expected entity and relation types', () => {
    const entityTypes: EntityType[] = [
      'code_artifact',
      'decision',
      'pattern',
      'error',
      'person',
      'concept',
      'preference',
    ];
    const relationTypes: RelationType[] = [
      'modifies',
      'depends_on',
      'caused_by',
      'resolves',
      'supersedes',
      'related_to',
      'summarizes',
    ];

    expect(entityTypes).toHaveLength(7);
    expect(relationTypes).toHaveLength(7);
    expect(new Set(entityTypes).size).toBe(entityTypes.length);
    expect(new Set(relationTypes).size).toBe(relationTypes.length);
  });

  it('defines a memory fact, edge, and search result shape', () => {
    const source: FactSource = {
      session_id: 'session-1',
      agent_id: 'agent-1',
      machine_id: 'machine-1',
      turn_index: 4,
      extraction_method: 'manual',
    };

    const fact: MemoryFact = {
      id: 'fact-1',
      scope: 'project:agentctl',
      content: 'Use Biome instead of ESLint.',
      content_model: 'text-embedding-3-small',
      entity_type: 'decision',
      confidence: 0.9,
      strength: 1,
      source,
      valid_from: '2026-03-11T00:00:00.000Z',
      valid_until: null,
      created_at: '2026-03-11T00:00:00.000Z',
      accessed_at: '2026-03-11T00:00:00.000Z',
    };

    const edge: MemoryEdge = {
      id: 'edge-1',
      source_fact_id: fact.id,
      target_fact_id: 'fact-2',
      relation: 'related_to',
      weight: 0.5,
      created_at: '2026-03-11T00:00:00.000Z',
    };

    const result: MemorySearchResult = {
      fact,
      score: 0.82,
      source_path: 'vector',
    };

    expect(result.fact.source).toEqual(source);
    expect(edge.source_fact_id).toBe(fact.id);
    expect(result.source_path).toBe('vector');
  });

  it('exports the default injection budget from the shared barrel', () => {
    const budget: InjectionBudget = DEFAULT_INJECTION_BUDGET;

    expect(budget).toEqual({
      maxTokens: 2000,
      maxFacts: 15,
      priorityWeights: {
        relevance: 0.5,
        recency: 0.2,
        strength: 0.2,
        scopeProximity: 0.1,
      },
    });
  });
});
