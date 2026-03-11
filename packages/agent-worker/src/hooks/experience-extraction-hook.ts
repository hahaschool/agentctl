// ---------------------------------------------------------------------------
// Experience Extraction PostStop Hook — §7.3
//
// Runs after a Claude Code session ends. Reads the session transcript from the
// audit log / output buffer and triggers the ExperienceExtractor to mine
// decisions, patterns, errors, and lessons.
//
// The hook runs asynchronously (fire-and-forget from the caller's perspective)
// so it does not block session teardown. Errors are logged but never propagated.
// ---------------------------------------------------------------------------

import type { MemoryScope } from '@agentctl/shared';
import type { Logger } from 'pino';

import {
  ExperienceExtractor,
  type ExtractionInput,
  type ExtractionResult,
} from './experience-extractor.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExperienceExtractionHookInput = {
  sessionId: string;
  agentId: string;
  machineId: string;
  reason: string;
  totalTurns: number;
  totalCostUsd: number;
  /** Raw session transcript text. Caller is responsible for providing this. */
  transcript?: string;
  /** Scope to store extracted facts under. Defaults to agent scope. */
  scope?: MemoryScope;
};

export type ExperienceExtractionHookOptions = {
  /** Base URL for the LiteLLM proxy. */
  litellmBaseUrl: string;
  /** Base URL for the control plane. */
  controlPlaneUrl: string;
  /** LLM model for extraction. */
  extractionModel?: string;
  /** Logger instance. */
  logger: Logger;
};

export type ExperienceExtractionHookFn = (
  input: ExperienceExtractionHookInput,
) => Promise<ExtractionResult>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an experience extraction hook function.
 *
 * The returned function accepts a session-end input (with transcript) and
 * returns the extraction result. The caller should fire-and-forget this
 * (catch errors at the call site) so it does not block session cleanup.
 */
export function createExperienceExtractionHook(
  options: ExperienceExtractionHookOptions,
): ExperienceExtractionHookFn {
  const { litellmBaseUrl, controlPlaneUrl, extractionModel, logger: parentLogger } = options;
  const log = parentLogger.child({ hook: 'experience-extraction' });

  const extractor = new ExperienceExtractor({
    litellmBaseUrl,
    controlPlaneUrl,
    extractionModel,
    logger: log,
  });

  return async (input: ExperienceExtractionHookInput): Promise<ExtractionResult> => {
    const { sessionId, agentId, machineId, totalTurns, transcript } = input;

    if (!transcript || transcript.trim().length === 0) {
      log.info({ sessionId, agentId }, 'No transcript provided, skipping experience extraction');
      return { extracted: 0, stored: 0, deduplicated: 0, flaggedForReview: 0, factIds: [] };
    }

    const scope: MemoryScope = input.scope ?? `agent:${agentId}`;

    const extractionInput: ExtractionInput = {
      sessionId,
      agentId,
      machineId,
      transcript,
      totalTurns,
      scope,
    };

    try {
      const result = await extractor.extract(extractionInput);

      log.info(
        {
          sessionId,
          agentId,
          extracted: result.extracted,
          stored: result.stored,
          deduplicated: result.deduplicated,
          flaggedForReview: result.flaggedForReview,
        },
        'Experience extraction hook completed',
      );

      return result;
    } catch (error: unknown) {
      log.error({ err: error, sessionId, agentId }, 'Experience extraction hook failed');

      return { extracted: 0, stored: 0, deduplicated: 0, flaggedForReview: 0, factIds: [] };
    }
  };
}
