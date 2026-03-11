import type {
  InjectionBudget,
  MemoryFact,
  MemoryScope,
  MemorySearchResult,
  TriggerContext,
} from '@agentctl/shared';
import { DEFAULT_INJECTION_BUDGET } from '@agentctl/shared';
import { describe, expect, it } from 'vitest';

import { buildContextBudget, estimateTokens, matchesTrigger } from './context-budget.js';

const NOW = '2026-03-11T00:00:00.000Z';

const DEFAULT_SOURCE = {
  session_id: null,
  agent_id: null,
  machine_id: null,
  turn_index: null,
  extraction_method: 'manual' as const,
};

function makeFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: `fact-${Math.random().toString(36).slice(2, 8)}`,
    scope: 'global' as MemoryScope,
    content: 'Default fact content for testing',
    content_model: 'text-embedding-3-small',
    entity_type: 'pattern',
    confidence: 0.9,
    strength: 1.0,
    source: DEFAULT_SOURCE,
    valid_from: NOW,
    valid_until: null,
    created_at: NOW,
    accessed_at: NOW,
    ...overrides,
  };
}

function makeSearchResult(fact: MemoryFact, score: number): MemorySearchResult {
  return {
    fact,
    score,
    source_path: 'vector',
  };
}

describe('estimateTokens', () => {
  it('estimates 1 token per 4 characters', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('')).toBe(0);
  });

  it('rounds up partial tokens', () => {
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('ab')).toBe(1);
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('matchesTrigger', () => {
  it('returns true when spec is empty (wildcard)', () => {
    expect(matchesTrigger({}, {})).toBe(true);
  });

  it('matches tool field exactly', () => {
    expect(matchesTrigger({ tool: 'Edit' }, { tool: 'Edit' })).toBe(true);
    expect(matchesTrigger({ tool: 'Edit' }, { tool: 'Read' })).toBe(false);
    expect(matchesTrigger({ tool: 'Edit' }, {})).toBe(false);
  });

  it('matches file_pattern as regex', () => {
    expect(
      matchesTrigger(
        { file_pattern: '\\.test\\.ts$' },
        { filePath: 'src/memory/context-budget.test.ts' },
      ),
    ).toBe(true);

    expect(
      matchesTrigger(
        { file_pattern: '\\.test\\.ts$' },
        { filePath: 'src/memory/context-budget.ts' },
      ),
    ).toBe(false);
  });

  it('falls back to substring match on invalid regex', () => {
    expect(
      matchesTrigger({ file_pattern: '[invalid' }, { filePath: 'path/[invalid/file.ts' }),
    ).toBe(true);

    expect(matchesTrigger({ file_pattern: '[invalid' }, { filePath: 'path/valid/file.ts' })).toBe(
      false,
    );
  });

  it('matches keyword against context keywords (case-insensitive)', () => {
    expect(matchesTrigger({ keyword: 'docker' }, { keywords: ['Docker', 'container'] })).toBe(true);

    expect(matchesTrigger({ keyword: 'kubernetes' }, { keywords: ['Docker', 'container'] })).toBe(
      false,
    );
  });

  it('requires all defined spec fields to match', () => {
    expect(
      matchesTrigger(
        { tool: 'Bash', keyword: 'deploy' },
        { tool: 'Bash', keywords: ['deploy', 'production'] },
      ),
    ).toBe(true);

    expect(
      matchesTrigger({ tool: 'Bash', keyword: 'deploy' }, { tool: 'Edit', keywords: ['deploy'] }),
    ).toBe(false);
  });

  it('returns false when file_pattern is set but context has no filePath', () => {
    expect(matchesTrigger({ file_pattern: '.*\\.ts$' }, {})).toBe(false);
  });
});

describe('buildContextBudget', () => {
  it('returns empty result with no facts', () => {
    const result = buildContextBudget({
      allFacts: [],
      searchResults: [],
    });

    expect(result.facts).toEqual([]);
    expect(result.tokenCount).toBe(0);
    expect(result.tierBreakdown).toEqual({ pinned: 0, 'on-demand': 0, triggered: 0 });
  });

  describe('Tier 1: pinned facts', () => {
    it('includes pinned facts first', () => {
      const pinned = makeFact({ id: 'pinned-1', content: 'Always remember this', pinned: true });
      const regular = makeFact({ id: 'regular-1', content: 'Normal fact' });

      const result = buildContextBudget({
        allFacts: [pinned, regular],
        searchResults: [makeSearchResult(regular, 0.8)],
      });

      expect(result.facts[0]?.id).toBe('pinned-1');
      expect(result.tierBreakdown.pinned).toBe(1);
    });

    it('respects pinnedCap limit', () => {
      const pinnedFacts = Array.from({ length: 10 }, (_, i) =>
        makeFact({ id: `pinned-${i}`, content: `Pinned fact ${i}`, pinned: true }),
      );

      const budget: InjectionBudget = {
        ...DEFAULT_INJECTION_BUDGET,
        pinnedCap: 3,
      };

      const result = buildContextBudget({
        allFacts: pinnedFacts,
        searchResults: [],
        budget,
      });

      expect(result.tierBreakdown.pinned).toBe(3);
    });

    it('does not apply decay to pinned facts (they are always included)', () => {
      const oldPinned = makeFact({
        id: 'old-pinned',
        content: 'Ancient pinned fact',
        pinned: true,
        strength: 0.1,
        accessed_at: '2020-01-01T00:00:00.000Z',
      });

      const result = buildContextBudget({
        allFacts: [oldPinned],
        searchResults: [],
      });

      expect(result.facts).toHaveLength(1);
      expect(result.facts[0]?.id).toBe('old-pinned');
    });
  });

  describe('Tier 2: on-demand facts', () => {
    it('fills remaining budget with relevance-ranked search results', () => {
      const pinned = makeFact({ id: 'pinned-1', content: 'Pin', pinned: true });
      const ranked1 = makeFact({ id: 'ranked-1', content: 'High relevance' });
      const ranked2 = makeFact({ id: 'ranked-2', content: 'Lower relevance' });

      const result = buildContextBudget({
        allFacts: [pinned, ranked1, ranked2],
        searchResults: [makeSearchResult(ranked1, 0.95), makeSearchResult(ranked2, 0.7)],
      });

      expect(result.facts).toHaveLength(3);
      expect(result.tierBreakdown.pinned).toBe(1);
      expect(result.tierBreakdown['on-demand']).toBe(2);
    });

    it('skips facts already included by the pinned tier', () => {
      const fact = makeFact({ id: 'both-pinned-and-ranked', content: 'Dual', pinned: true });

      const result = buildContextBudget({
        allFacts: [fact],
        searchResults: [makeSearchResult(fact, 0.99)],
      });

      expect(result.facts).toHaveLength(1);
      expect(result.tierBreakdown.pinned).toBe(1);
      expect(result.tierBreakdown['on-demand']).toBe(0);
    });
  });

  describe('Tier 3: triggered facts', () => {
    it('includes facts matching the trigger context', () => {
      const triggered = makeFact({
        id: 'triggered-1',
        content: 'Use --cap-drop=ALL for Docker',
        trigger_spec: { tool: 'Bash', keyword: 'docker' },
      });

      const triggerContext: TriggerContext = {
        tool: 'Bash',
        keywords: ['docker', 'container'],
      };

      const result = buildContextBudget({
        allFacts: [triggered],
        searchResults: [],
        triggerContext,
      });

      expect(result.facts).toHaveLength(1);
      expect(result.tierBreakdown.triggered).toBe(1);
    });

    it('does not include triggered facts when context does not match', () => {
      const triggered = makeFact({
        id: 'triggered-1',
        content: 'Docker security rule',
        trigger_spec: { tool: 'Bash', keyword: 'docker' },
      });

      const triggerContext: TriggerContext = {
        tool: 'Edit',
        keywords: ['typescript'],
      };

      const result = buildContextBudget({
        allFacts: [triggered],
        searchResults: [],
        triggerContext,
      });

      expect(result.facts).toHaveLength(0);
      expect(result.tierBreakdown.triggered).toBe(0);
    });

    it('does not duplicate facts already in pinned or on-demand', () => {
      const fact = makeFact({
        id: 'pinned-and-triggered',
        content: 'Dual fact',
        pinned: true,
        trigger_spec: { tool: 'Bash' },
      });

      const result = buildContextBudget({
        allFacts: [fact],
        searchResults: [],
        triggerContext: { tool: 'Bash' },
      });

      expect(result.facts).toHaveLength(1);
      expect(result.tierBreakdown.pinned).toBe(1);
      expect(result.tierBreakdown.triggered).toBe(0);
    });
  });

  describe('budget enforcement', () => {
    it('stops adding facts when maxFacts is reached', () => {
      const facts = Array.from({ length: 30 }, (_, i) =>
        makeFact({ id: `fact-${i}`, content: `Fact ${i}` }),
      );

      const budget: InjectionBudget = {
        ...DEFAULT_INJECTION_BUDGET,
        maxFacts: 5,
        maxTokens: 100000,
      };

      const result = buildContextBudget({
        allFacts: facts,
        searchResults: facts.map((f, i) => makeSearchResult(f, 1 - i * 0.01)),
        budget,
      });

      expect(result.facts).toHaveLength(5);
    });

    it('stops adding facts when maxTokens is reached', () => {
      // Each fact has content "X".repeat(100) = 100 chars = 25 tokens
      const facts = Array.from({ length: 10 }, (_, i) =>
        makeFact({ id: `fact-${i}`, content: 'X'.repeat(100) }),
      );

      const budget: InjectionBudget = {
        ...DEFAULT_INJECTION_BUDGET,
        maxFacts: 100,
        maxTokens: 60, // Allows ~2 facts (each is 25 tokens)
      };

      const result = buildContextBudget({
        allFacts: facts,
        searchResults: facts.map((f, i) => makeSearchResult(f, 1 - i * 0.01)),
        budget,
      });

      expect(result.facts).toHaveLength(2);
      expect(result.tokenCount).toBe(50);
    });

    it('does not add a fact that would exceed the token budget', () => {
      const smallFact = makeFact({ id: 'small', content: 'Hi' }); // ~1 token
      const largeFact = makeFact({ id: 'large', content: 'X'.repeat(100) }); // 25 tokens

      const budget: InjectionBudget = {
        ...DEFAULT_INJECTION_BUDGET,
        maxFacts: 100,
        maxTokens: 10,
      };

      const result = buildContextBudget({
        allFacts: [smallFact, largeFact],
        searchResults: [makeSearchResult(smallFact, 0.9), makeSearchResult(largeFact, 0.8)],
        budget,
      });

      expect(result.facts).toHaveLength(1);
      expect(result.facts[0]?.id).toBe('small');
    });

    it('pinned facts consume budget before on-demand facts', () => {
      const pinned = makeFact({
        id: 'pinned-1',
        content: 'X'.repeat(80), // 20 tokens
        pinned: true,
      });
      const onDemand = makeFact({
        id: 'on-demand-1',
        content: 'X'.repeat(80), // 20 tokens
      });

      const budget: InjectionBudget = {
        ...DEFAULT_INJECTION_BUDGET,
        maxTokens: 30, // Only room for 1 fact
        maxFacts: 100,
      };

      const result = buildContextBudget({
        allFacts: [pinned, onDemand],
        searchResults: [makeSearchResult(onDemand, 0.95)],
        budget,
      });

      expect(result.facts).toHaveLength(1);
      expect(result.facts[0]?.id).toBe('pinned-1');
      expect(result.tierBreakdown.pinned).toBe(1);
      expect(result.tierBreakdown['on-demand']).toBe(0);
    });
  });

  describe('tier configuration', () => {
    it('skips disabled tiers', () => {
      const pinned = makeFact({ id: 'pinned-1', content: 'Pinned', pinned: true });
      const regular = makeFact({ id: 'regular-1', content: 'Regular' });

      const budget: InjectionBudget = {
        ...DEFAULT_INJECTION_BUDGET,
        tiers: ['on-demand'], // Only on-demand enabled
      };

      const result = buildContextBudget({
        allFacts: [pinned, regular],
        searchResults: [makeSearchResult(regular, 0.8)],
        budget,
      });

      expect(result.tierBreakdown.pinned).toBe(0);
      expect(result.tierBreakdown['on-demand']).toBe(1);
      expect(result.facts).toHaveLength(1);
      expect(result.facts[0]?.id).toBe('regular-1');
    });

    it('uses DEFAULT_INJECTION_BUDGET when no budget provided', () => {
      const result = buildContextBudget({
        allFacts: [],
        searchResults: [],
      });

      // Verifies no error occurs and defaults are applied
      expect(result.facts).toEqual([]);
      expect(result.tokenCount).toBe(0);
    });
  });

  describe('default budget values', () => {
    it('has maxTokens of 2400', () => {
      expect(DEFAULT_INJECTION_BUDGET.maxTokens).toBe(2400);
    });

    it('has maxFacts of 20', () => {
      expect(DEFAULT_INJECTION_BUDGET.maxFacts).toBe(20);
    });

    it('has all 3 tiers enabled', () => {
      expect(DEFAULT_INJECTION_BUDGET.tiers).toEqual(['pinned', 'on-demand', 'triggered']);
    });

    it('has pinnedCap of 5', () => {
      expect(DEFAULT_INJECTION_BUDGET.pinnedCap).toBe(5);
    });
  });

  describe('integration scenario', () => {
    it('injects facts from all 3 tiers respecting order and budget', () => {
      const pinnedFact = makeFact({
        id: 'pinned-security',
        content: 'Never commit secrets to git',
        pinned: true,
      });

      const onDemandFact1 = makeFact({
        id: 'on-demand-1',
        content: 'Use pnpm workspaces for monorepo installs',
      });

      const onDemandFact2 = makeFact({
        id: 'on-demand-2',
        content: 'Biome replaces ESLint and Prettier',
      });

      const triggeredFact = makeFact({
        id: 'triggered-docker',
        content: 'Use --cap-drop=ALL for container security',
        trigger_spec: { keyword: 'docker' },
      });

      const nonTriggeredFact = makeFact({
        id: 'not-triggered',
        content: 'This should not be included',
        trigger_spec: { keyword: 'kubernetes' },
      });

      const result = buildContextBudget({
        allFacts: [pinnedFact, onDemandFact1, onDemandFact2, triggeredFact, nonTriggeredFact],
        searchResults: [
          makeSearchResult(onDemandFact1, 0.95),
          makeSearchResult(onDemandFact2, 0.85),
        ],
        triggerContext: { keywords: ['docker', 'deploy'] },
      });

      // Pinned first, then on-demand, then triggered
      expect(result.facts.map((f) => f.id)).toEqual([
        'pinned-security',
        'on-demand-1',
        'on-demand-2',
        'triggered-docker',
      ]);
      expect(result.tierBreakdown).toEqual({
        pinned: 1,
        'on-demand': 2,
        triggered: 1,
      });
      expect(result.tokenCount).toBeGreaterThan(0);
    });
  });
});
