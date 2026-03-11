// ---------------------------------------------------------------------------
// Experience Extractor — §7.3 Automated Experience Extraction
//
// Core logic for:
//   1. Calling an LLM to extract experiences from a session transcript
//   2. Deduplicating against existing memory (similarity > 0.85 = skip)
//   3. Storing new facts via the control-plane memory API
//   4. Flagging low-confidence extractions for human review
// ---------------------------------------------------------------------------

import type { EntityType, MemoryFact, MemoryScope } from '@agentctl/shared';
import { WorkerError } from '@agentctl/shared';
import type { Logger } from 'pino';

import {
  buildExperienceExtractionPrompt,
  type ExtractedExperience,
} from './experience-extraction-prompt.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Similarity threshold above which we consider a fact a duplicate. */
const DEDUP_SIMILARITY_THRESHOLD = 0.85;

/** Confidence threshold below which extractions are flagged for review. */
const REVIEW_CONFIDENCE_THRESHOLD = 0.7;

/** Maximum transcript length (chars) sent to the LLM to stay within context. */
const MAX_TRANSCRIPT_LENGTH = 120_000;

/** Timeout for the LLM extraction call (120s for long transcripts). */
const LLM_TIMEOUT_MS = 120_000;

/** Minimum number of turns for a session to be worth extracting. */
const MIN_TURNS_FOR_EXTRACTION = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExperienceExtractorOptions = {
  /** Base URL for the LiteLLM proxy (e.g. http://localhost:4000). */
  litellmBaseUrl: string;
  /** Base URL for the control plane (e.g. http://localhost:8080). */
  controlPlaneUrl: string;
  /** Model to use for extraction. Defaults to haiku for cost efficiency. */
  extractionModel?: string;
  /** Logger instance. */
  logger: Logger;
};

export type ExtractionInput = {
  sessionId: string;
  agentId: string;
  machineId: string;
  /** Raw session transcript text. */
  transcript: string;
  /** Total turns in the session. */
  totalTurns: number;
  /** Scope to store facts under. */
  scope: MemoryScope;
};

export type ExtractionResult = {
  /** Total experiences extracted by the LLM. */
  extracted: number;
  /** Number stored (after dedup). */
  stored: number;
  /** Number skipped due to dedup. */
  deduplicated: number;
  /** Number flagged for human review (confidence < 0.7). */
  flaggedForReview: number;
  /** IDs of newly stored facts. */
  factIds: string[];
};

type MemorySearchResponse = {
  ok: boolean;
  facts: MemoryFact[];
  total: number;
};

type MemoryStoreResponse = {
  ok: boolean;
  fact: MemoryFact;
};

type ChatCompletionResponse = {
  id: string;
  choices: Array<{
    message: {
      content: string;
    };
  }>;
};

// ---------------------------------------------------------------------------
// Experience Extractor
// ---------------------------------------------------------------------------

export class ExperienceExtractor {
  private readonly litellmBaseUrl: string;
  private readonly controlPlaneUrl: string;
  private readonly extractionModel: string;
  private readonly logger: Logger;

  constructor(options: ExperienceExtractorOptions) {
    this.litellmBaseUrl = options.litellmBaseUrl.replace(/\/+$/, '');
    this.controlPlaneUrl = options.controlPlaneUrl.replace(/\/+$/, '');
    this.extractionModel = options.extractionModel ?? 'claude-haiku-4-5';
    this.logger = options.logger.child({ component: 'experience-extractor' });
  }

  /**
   * Extract experiences from a completed session and store them in memory.
   *
   * Skips sessions that are too short to contain meaningful knowledge.
   */
  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const { sessionId, agentId, totalTurns } = input;

    if (totalTurns < MIN_TURNS_FOR_EXTRACTION) {
      this.logger.info(
        { sessionId, agentId, totalTurns },
        'Session too short for experience extraction, skipping',
      );
      return { extracted: 0, stored: 0, deduplicated: 0, flaggedForReview: 0, factIds: [] };
    }

    // 1. Call LLM to extract experiences
    const experiences = await this.callLlm(input);

    if (experiences.length === 0) {
      this.logger.info({ sessionId, agentId }, 'No experiences extracted from session');
      return { extracted: 0, stored: 0, deduplicated: 0, flaggedForReview: 0, factIds: [] };
    }

    this.logger.info(
      { sessionId, agentId, count: experiences.length },
      'Experiences extracted from session',
    );

    // 2. Dedup and store each experience
    let stored = 0;
    let deduplicated = 0;
    let flaggedForReview = 0;
    const factIds: string[] = [];

    for (const experience of experiences) {
      try {
        const isDuplicate = await this.isDuplicate(experience.content, input.scope);

        if (isDuplicate) {
          deduplicated += 1;
          this.logger.debug(
            { sessionId, content: experience.content.slice(0, 80) },
            'Skipping duplicate experience',
          );
          continue;
        }

        const needsReview = experience.confidence < REVIEW_CONFIDENCE_THRESHOLD;
        if (needsReview) {
          flaggedForReview += 1;
        }

        const fact = await this.storeFact(experience, input, needsReview);
        if (fact) {
          factIds.push(fact.id);
          stored += 1;
        }
      } catch (error: unknown) {
        this.logger.warn(
          { err: error, sessionId, content: experience.content.slice(0, 80) },
          'Failed to process extracted experience',
        );
      }
    }

    this.logger.info(
      { sessionId, agentId, extracted: experiences.length, stored, deduplicated, flaggedForReview },
      'Experience extraction complete',
    );

    return {
      extracted: experiences.length,
      stored,
      deduplicated,
      flaggedForReview,
      factIds,
    };
  }

  /**
   * Call the LLM via LiteLLM proxy to extract experiences from the transcript.
   */
  async callLlm(input: ExtractionInput): Promise<ExtractedExperience[]> {
    const { sessionId, agentId } = input;
    const transcript = input.transcript.slice(0, MAX_TRANSCRIPT_LENGTH);

    const prompt = buildExperienceExtractionPrompt(transcript, agentId, sessionId);

    let response: Response;
    try {
      response = await fetch(`${this.litellmBaseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.extractionModel,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 4096,
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      throw new WorkerError(
        'EXPERIENCE_LLM_UNREACHABLE',
        'Failed to reach LiteLLM proxy for experience extraction',
        { sessionId, err: error instanceof Error ? error.message : String(error) },
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '<unreadable>');
      throw new WorkerError(
        'EXPERIENCE_LLM_ERROR',
        `LiteLLM returned ${response.status} during experience extraction`,
        { sessionId, status: response.status, body: errorText.slice(0, 200) },
      );
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content ?? '';

    return this.parseExtractionResponse(content, sessionId);
  }

  /**
   * Parse the LLM response into validated ExtractedExperience objects.
   *
   * Tolerates markdown fences and extra whitespace. Drops any entries that
   * fail validation rather than throwing.
   */
  parseExtractionResponse(content: string, sessionId: string): ExtractedExperience[] {
    // Strip markdown fences if present
    const cleaned = content
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```\s*$/m, '')
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      this.logger.warn(
        { sessionId, responseSnippet: content.slice(0, 200) },
        'Failed to parse LLM extraction response as JSON',
      );
      return [];
    }

    if (!Array.isArray(parsed)) {
      this.logger.warn({ sessionId }, 'LLM extraction response is not an array');
      return [];
    }

    const validTypes = new Set(['experience', 'decision', 'pattern', 'error']);
    const results: ExtractedExperience[] = [];

    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) {
        continue;
      }

      const record = item as Record<string, unknown>;

      if (typeof record.content !== 'string' || record.content.trim().length === 0) {
        continue;
      }

      if (typeof record.entity_type !== 'string' || !validTypes.has(record.entity_type)) {
        continue;
      }

      const confidence = typeof record.confidence === 'number' ? record.confidence : 0.5;
      if (confidence < 0.4) {
        continue;
      }

      results.push({
        content: record.content.trim(),
        entity_type: record.entity_type as ExtractedExperience['entity_type'],
        confidence: Math.min(1, Math.max(0, confidence)),
        tags: Array.isArray(record.tags)
          ? (record.tags as unknown[]).filter((t): t is string => typeof t === 'string')
          : [],
        may_contradict: record.may_contradict === true,
      });
    }

    return results;
  }

  /**
   * Check whether a similar fact already exists in memory (similarity > 0.85).
   *
   * Uses the control-plane hybrid search endpoint.
   */
  async isDuplicate(content: string, scope: MemoryScope): Promise<boolean> {
    const params = new URLSearchParams({
      q: content.slice(0, 500),
      scope,
      limit: '3',
    });

    try {
      const response = await fetch(
        `${this.controlPlaneUrl}/api/memory/facts?${params.toString()}`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!response.ok) {
        // If search fails, err on the side of storing (not deduplicating)
        this.logger.warn(
          { status: response.status },
          'Memory search failed during dedup check, storing anyway',
        );
        return false;
      }

      const data = (await response.json()) as MemorySearchResponse;
      const facts = data.facts ?? [];

      // Check if any returned fact is semantically very similar.
      // The search API returns results ranked by relevance — if the top result
      // content is nearly identical, treat it as a duplicate.
      for (const fact of facts) {
        const similarity = computeTextSimilarity(content, fact.content);
        if (similarity > DEDUP_SIMILARITY_THRESHOLD) {
          this.logger.debug(
            { existingFactId: fact.id, similarity: similarity.toFixed(3) },
            'Dedup: found existing similar fact',
          );
          return true;
        }
      }

      return false;
    } catch (error: unknown) {
      this.logger.warn({ err: error }, 'Dedup check failed (network error), storing anyway');
      return false;
    }
  }

  /**
   * Store a single extracted experience as a memory fact via the control-plane API.
   */
  async storeFact(
    experience: ExtractedExperience,
    input: ExtractionInput,
    needsReview: boolean,
  ): Promise<MemoryFact | null> {
    const tags = [...experience.tags];
    if (needsReview) {
      tags.push('needs-review');
    }
    if (experience.may_contradict) {
      tags.push('may-contradict');
    }

    const body = {
      content: experience.content,
      scope: input.scope,
      entityType: experience.entity_type as EntityType,
      confidence: experience.confidence,
      source: {
        session_id: input.sessionId,
        agent_id: input.agentId,
        machine_id: input.machineId,
        turn_index: null,
        extraction_method: 'llm' as const,
      },
      tags,
    };

    try {
      const response = await fetch(`${this.controlPlaneUrl}/api/memory/facts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '<unreadable>');
        this.logger.warn(
          { status: response.status, body: errorText.slice(0, 200) },
          'Control-plane rejected memory fact storage',
        );
        return null;
      }

      const data = (await response.json()) as MemoryStoreResponse;
      return data.fact ?? null;
    } catch (error: unknown) {
      this.logger.warn({ err: error }, 'Failed to store experience fact in control-plane');
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Compute a rough text similarity score between two strings using
 * word-level Jaccard similarity. This is a fast client-side heuristic;
 * the real semantic similarity check happens via the vector search on the
 * control-plane side. This catches obvious textual near-duplicates.
 */
export function computeTextSimilarity(a: string, b: string): number {
  const tokenize = (text: string): Set<string> =>
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((token) => token.length > 1),
    );

  const setA = tokenize(a);
  const setB = tokenize(b);

  if (setA.size === 0 && setB.size === 0) {
    return 1;
  }
  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) {
      intersection += 1;
    }
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
