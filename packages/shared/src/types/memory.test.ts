import { describe, expect, it } from 'vitest';

import { DEFAULT_INJECTION_BUDGET } from '../index.js';
import type {
  ConsolidationItem,
  ImportJob,
  MemoryReport,
  MemoryStats,
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

  it('represents a consolidation review item', () => {
    const item: ConsolidationItem = {
      id: 'ci-1',
      type: 'contradiction',
      severity: 'high',
      factIds: ['fact-1', 'fact-2'],
      suggestion: 'Keep fact-1, supersede fact-2',
      reason: 'fact-1 is newer and higher confidence',
      status: 'pending',
      createdAt: '2026-03-11T10:00:00Z',
    };

    expect(item.type).toBe('contradiction');
    expect(item.severity).toBe('high');
  });

  it('represents a generated memory report', () => {
    const report: MemoryReport = {
      id: 'rpt-1',
      type: 'project-progress',
      scope: 'project:agentctl',
      periodStart: '2026-03-04T00:00:00Z',
      periodEnd: '2026-03-11T00:00:00Z',
      content: '## Weekly Progress\n...',
      metadata: { factCount: 120, newFacts: 15, topEntities: ['pgvector', 'Biome'] },
      generatedAt: '2026-03-11T12:00:00Z',
    };

    expect(report.type).toBe('project-progress');
  });

  it('represents an import job', () => {
    const job: ImportJob = {
      id: 'imp-1',
      source: 'claude-mem',
      status: 'running',
      progress: { current: 42, total: 847 },
      imported: 40,
      skipped: 2,
      errors: 0,
      startedAt: '2026-03-11T10:00:00Z',
      completedAt: null,
    };

    expect(job.status).toBe('running');
  });

  it('represents dashboard memory statistics', () => {
    const stats: MemoryStats = {
      totalFacts: 1247,
      newThisWeek: 87,
      avgConfidence: 0.82,
      pendingConsolidation: 7,
      byScope: { global: 124, 'project:agentctl': 892 },
      byEntityType: { pattern: 420, decision: 280 },
      strengthDistribution: { active: 1110, decaying: 100, archived: 37 },
      growthTrend: [
        { date: '2026-03-10', count: 12 },
        { date: '2026-03-11', count: 15 },
      ],
    };

    expect(stats.totalFacts).toBe(1247);
    expect(stats.byEntityType.pattern).toBe(420);
  });
});
