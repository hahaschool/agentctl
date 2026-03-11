import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../test-helpers.js';
import { computeTextSimilarity, ExperienceExtractor } from './experience-extractor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockLogger = createMockLogger();

function createExtractor(
  overrides?: Partial<{
    litellmBaseUrl: string;
    controlPlaneUrl: string;
    extractionModel: string;
  }>,
): ExperienceExtractor {
  return new ExperienceExtractor({
    litellmBaseUrl: overrides?.litellmBaseUrl ?? 'http://localhost:4000',
    controlPlaneUrl: overrides?.controlPlaneUrl ?? 'http://localhost:8080',
    extractionModel: overrides?.extractionModel ?? 'test-model',
    logger: mockLogger,
  });
}

function makeExtractionInput(overrides?: Record<string, unknown>) {
  return {
    sessionId: 'session-1',
    agentId: 'agent-1',
    machineId: 'machine-1',
    transcript: 'User: Fix the login bug. Assistant: Found the issue in auth.ts line 42.',
    totalTurns: 5,
    scope: 'agent:agent-1' as const,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExperienceExtractor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('parseExtractionResponse', () => {
    it('parses valid JSON array of experiences', () => {
      const extractor = createExtractor();
      const json = JSON.stringify([
        {
          content: 'TypeScript strict mode caught a null access bug in auth.ts',
          entity_type: 'error',
          confidence: 0.9,
          tags: ['typescript'],
          may_contradict: false,
        },
        {
          content: 'Using Vitest watch mode sped up TDD cycle by 3x',
          entity_type: 'pattern',
          confidence: 0.8,
          tags: [],
          may_contradict: false,
        },
      ]);

      const result = extractor.parseExtractionResponse(json, 'session-1');

      expect(result).toHaveLength(2);
      expect(result[0].entity_type).toBe('error');
      expect(result[0].confidence).toBe(0.9);
      expect(result[1].entity_type).toBe('pattern');
    });

    it('strips markdown fences from response', () => {
      const extractor = createExtractor();
      const json =
        '```json\n' +
        JSON.stringify([
          {
            content: 'Some fact',
            entity_type: 'decision',
            confidence: 0.95,
            tags: [],
            may_contradict: false,
          },
        ]) +
        '\n```';

      const result = extractor.parseExtractionResponse(json, 'session-1');

      expect(result).toHaveLength(1);
      expect(result[0].entity_type).toBe('decision');
    });

    it('filters out items with invalid entity_type', () => {
      const extractor = createExtractor();
      const json = JSON.stringify([
        {
          content: 'Valid fact',
          entity_type: 'pattern',
          confidence: 0.8,
          tags: [],
          may_contradict: false,
        },
        {
          content: 'Invalid type',
          entity_type: 'unknown_type',
          confidence: 0.8,
          tags: [],
          may_contradict: false,
        },
      ]);

      const result = extractor.parseExtractionResponse(json, 'session-1');

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Valid fact');
    });

    it('filters out items with confidence below 0.4', () => {
      const extractor = createExtractor();
      const json = JSON.stringify([
        {
          content: 'Low confidence speculation',
          entity_type: 'experience',
          confidence: 0.3,
          tags: [],
          may_contradict: false,
        },
      ]);

      const result = extractor.parseExtractionResponse(json, 'session-1');

      expect(result).toHaveLength(0);
    });

    it('returns empty array for invalid JSON', () => {
      const extractor = createExtractor();

      const result = extractor.parseExtractionResponse('not valid json {', 'session-1');

      expect(result).toHaveLength(0);
    });

    it('returns empty array for non-array JSON', () => {
      const extractor = createExtractor();

      const result = extractor.parseExtractionResponse('{"key": "value"}', 'session-1');

      expect(result).toHaveLength(0);
    });

    it('skips entries with empty content', () => {
      const extractor = createExtractor();
      const json = JSON.stringify([
        {
          content: '',
          entity_type: 'pattern',
          confidence: 0.8,
          tags: [],
          may_contradict: false,
        },
      ]);

      const result = extractor.parseExtractionResponse(json, 'session-1');

      expect(result).toHaveLength(0);
    });

    it('defaults confidence to 0.5 when not a number', () => {
      const extractor = createExtractor();
      const json = JSON.stringify([
        {
          content: 'Some fact',
          entity_type: 'experience',
          confidence: 'high',
          tags: [],
          may_contradict: false,
        },
      ]);

      const result = extractor.parseExtractionResponse(json, 'session-1');

      expect(result).toHaveLength(1);
      expect(result[0].confidence).toBe(0.5);
    });
  });

  describe('extract', () => {
    it('skips sessions with fewer than 3 turns', async () => {
      const extractor = createExtractor();

      const result = await extractor.extract(makeExtractionInput({ totalTurns: 2 }));

      expect(result.extracted).toBe(0);
      expect(result.stored).toBe(0);
    });

    it('calls LLM, dedup-checks, and stores facts end-to-end', async () => {
      const extractor = createExtractor();

      // Mock callLlm to return extracted experiences
      vi.spyOn(extractor, 'callLlm').mockResolvedValue([
        {
          content: 'AgentCTL uses BullMQ for task scheduling instead of Temporal',
          entity_type: 'decision',
          confidence: 0.95,
          tags: ['architecture'],
          may_contradict: false,
        },
      ]);

      // Mock isDuplicate to return false (not a duplicate)
      vi.spyOn(extractor, 'isDuplicate').mockResolvedValue(false);

      // Mock storeFact to return a fake fact
      vi.spyOn(extractor, 'storeFact').mockResolvedValue({
        id: 'fact-123',
        scope: 'agent:agent-1',
        content: 'AgentCTL uses BullMQ for task scheduling instead of Temporal',
        content_model: 'text-embedding-3-small',
        entity_type: 'decision',
        confidence: 0.95,
        strength: 1.0,
        source: {
          session_id: 'session-1',
          agent_id: 'agent-1',
          machine_id: 'machine-1',
          turn_index: null,
          extraction_method: 'llm',
        },
        valid_from: new Date().toISOString(),
        valid_until: null,
        created_at: new Date().toISOString(),
        accessed_at: new Date().toISOString(),
        tags: ['architecture'],
      });

      const result = await extractor.extract(makeExtractionInput());

      expect(result.extracted).toBe(1);
      expect(result.stored).toBe(1);
      expect(result.deduplicated).toBe(0);
      expect(result.factIds).toEqual(['fact-123']);
    });

    it('deduplicates when isDuplicate returns true', async () => {
      const extractor = createExtractor();

      vi.spyOn(extractor, 'callLlm').mockResolvedValue([
        {
          content: 'Some already-known fact',
          entity_type: 'pattern',
          confidence: 0.9,
          tags: [],
          may_contradict: false,
        },
      ]);

      vi.spyOn(extractor, 'isDuplicate').mockResolvedValue(true);

      const result = await extractor.extract(makeExtractionInput());

      expect(result.extracted).toBe(1);
      expect(result.stored).toBe(0);
      expect(result.deduplicated).toBe(1);
    });

    it('flags low-confidence extractions for review', async () => {
      const extractor = createExtractor();

      vi.spyOn(extractor, 'callLlm').mockResolvedValue([
        {
          content: 'Maybe this pattern works well for caching',
          entity_type: 'pattern',
          confidence: 0.55,
          tags: [],
          may_contradict: false,
        },
      ]);

      vi.spyOn(extractor, 'isDuplicate').mockResolvedValue(false);
      vi.spyOn(extractor, 'storeFact').mockResolvedValue({
        id: 'fact-456',
        scope: 'agent:agent-1',
        content: 'Maybe this pattern works well for caching',
        content_model: 'text-embedding-3-small',
        entity_type: 'pattern',
        confidence: 0.55,
        strength: 1.0,
        source: {
          session_id: 'session-1',
          agent_id: 'agent-1',
          machine_id: 'machine-1',
          turn_index: null,
          extraction_method: 'llm',
        },
        valid_from: new Date().toISOString(),
        valid_until: null,
        created_at: new Date().toISOString(),
        accessed_at: new Date().toISOString(),
        tags: ['needs-review'],
      });

      const result = await extractor.extract(makeExtractionInput());

      expect(result.flaggedForReview).toBe(1);
      expect(result.stored).toBe(1);

      // Verify storeFact was called with needsReview = true
      const storeCall = vi.mocked(extractor.storeFact).mock.calls[0];
      expect(storeCall[2]).toBe(true); // needsReview argument
    });
  });
});

describe('computeTextSimilarity', () => {
  it('returns 1.0 for identical strings', () => {
    const similarity = computeTextSimilarity('hello world', 'hello world');
    expect(similarity).toBe(1);
  });

  it('returns 0 for completely different strings', () => {
    const similarity = computeTextSimilarity('apple banana cherry', 'dog elephant fish');
    expect(similarity).toBe(0);
  });

  it('returns a value between 0 and 1 for partial overlap', () => {
    const similarity = computeTextSimilarity(
      'TypeScript uses strict mode for type safety',
      'TypeScript strict mode catches null bugs',
    );
    expect(similarity).toBeGreaterThan(0);
    expect(similarity).toBeLessThan(1);
  });

  it('returns 1.0 for two empty strings', () => {
    const similarity = computeTextSimilarity('', '');
    expect(similarity).toBe(1);
  });

  it('returns 0 when one string is empty', () => {
    const similarity = computeTextSimilarity('hello world', '');
    expect(similarity).toBe(0);
  });

  it('is case insensitive', () => {
    const similarity = computeTextSimilarity('Hello World', 'hello world');
    expect(similarity).toBe(1);
  });

  it('ignores single-character tokens', () => {
    // "a" is filtered, so "test a case" -> {"test", "case"}
    // "test b case" -> {"test", "case"}
    const similarity = computeTextSimilarity('test a case', 'test b case');
    expect(similarity).toBe(1);
  });
});
