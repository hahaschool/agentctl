// ---------------------------------------------------------------------------
// POST /api/memory/narrative-report
//
// Generates an LLM-backed narrative summary of memory facts. Requires a
// configured LiteLLM proxy (LITELLM_URL env var). Falls back to a stub
// when the client is unavailable so the route is always registered.
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import type { LiteLLMClient } from '../../router/litellm-client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NarrativeStyle = 'prose' | 'bullet' | 'timeline';

type NarrativeReportRequest = {
  scope?: string;
  entity_type?: string;
  limit?: number;
  style?: NarrativeStyle;
};

type NarrativeReportResponse = {
  ok: true;
  text: string;
  factCount: number;
  model: string;
};

export type MemoryNarrativeReportRoutesOptions = {
  pool: Pool;
  logger: Logger;
  litellmClient?: LiteLLMClient;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const NARRATIVE_MODEL = 'claude-haiku-4-5-20251001';

const VALID_STYLES: ReadonlySet<string> = new Set(['prose', 'bullet', 'timeline']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPrompt(
  facts: Array<{ content: string; entity_type: string; scope: string; created_at: string }>,
  style: NarrativeStyle,
): string {
  const factsJson = JSON.stringify(
    facts.map((f) => ({
      content: f.content,
      entity_type: f.entity_type,
      scope: f.scope,
      created_at: f.created_at,
    })),
    null,
    2,
  );

  const styleInstruction =
    style === 'bullet'
      ? 'Write a bulleted list summary where each bullet covers a key theme or insight.'
      : style === 'timeline'
        ? 'Write a chronological narrative organized by time, starting from oldest to most recent.'
        : 'Write a flowing prose narrative that synthesizes the key themes and insights.';

  return `You are summarizing an agent's memory knowledge base. Below is a JSON array of memory facts.

${styleInstruction}

Focus on:
- What the agent has been working on
- Key decisions or insights recorded
- Patterns or themes across the facts
- Any notable recent activity

Keep the summary concise (200-400 words). Do not invent facts not present in the data.

Memory facts:
${factsJson}`;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export const memoryNarrativeReportRoutes: FastifyPluginAsync<
  MemoryNarrativeReportRoutesOptions
> = async (app, opts) => {
  const { pool, logger, litellmClient } = opts;

  app.post<{ Body: NarrativeReportRequest }>('/', async (request, reply) => {
    const body = request.body ?? {};
    const style: NarrativeStyle =
      typeof body.style === 'string' && VALID_STYLES.has(body.style)
        ? (body.style as NarrativeStyle)
        : 'prose';

    const rawLimit = typeof body.limit === 'number' ? body.limit : DEFAULT_LIMIT;
    const limit = Math.min(Math.max(1, rawLimit), MAX_LIMIT);

    if (!litellmClient) {
      return reply.code(503).send({
        ok: false,
        error: 'LITELLM_UNAVAILABLE',
        message: 'LiteLLM proxy is not configured. Set LITELLM_URL to enable narrative reports.',
      });
    }

    try {
      const params: unknown[] = [limit];
      let whereClause = '';
      let paramIdx = 2;

      const conditions: string[] = [];
      if (body.scope) {
        conditions.push(`scope = $${paramIdx++}`);
        params.push(body.scope);
      }
      if (body.entity_type) {
        conditions.push(`entity_type = $${paramIdx++}`);
        params.push(body.entity_type);
      }
      if (conditions.length > 0) {
        whereClause = `WHERE ${conditions.join(' AND ')}`;
      }

      const result = await pool.query<{
        content: string;
        entity_type: string;
        scope: string;
        created_at: string;
      }>(
        `SELECT content, entity_type, scope, created_at
         FROM memory_facts
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT $1`,
        params,
      );

      const facts = result.rows;

      if (facts.length === 0) {
        return reply.code(200).send({
          ok: true,
          text: 'No memory facts found matching the specified filters.',
          factCount: 0,
          model: NARRATIVE_MODEL,
        } satisfies NarrativeReportResponse);
      }

      const prompt = buildPrompt(facts, style);

      const completion = await litellmClient.chatCompletion({
        model: NARRATIVE_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800,
        temperature: 0.3,
      });

      const text = completion.choices[0]?.message.content ?? '';

      logger.info(
        { factCount: facts.length, model: NARRATIVE_MODEL, style },
        'Narrative report generated',
      );

      return reply.code(200).send({
        ok: true,
        text,
        factCount: facts.length,
        model: NARRATIVE_MODEL,
      } satisfies NarrativeReportResponse);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err }, 'Narrative report generation failed');
      return reply.code(500).send({
        ok: false,
        error: 'NARRATIVE_REPORT_FAILED',
        message,
      });
    }
  });
};
