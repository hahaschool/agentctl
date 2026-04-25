import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { memoryNarrativeReportRoutes } from './memory-narrative-report.js';
import { createMockLogger } from './test-helpers.js';

type MockPool = { query: ReturnType<typeof vi.fn> };

type MockLiteLLMClient = {
  chatCompletion: ReturnType<typeof vi.fn>;
};

const logger = createMockLogger();

function createMockPool(): MockPool {
  return { query: vi.fn() };
}

function createMockLLM(): MockLiteLLMClient {
  return { chatCompletion: vi.fn() };
}

const SAMPLE_FACTS = [
  {
    content: 'Agent completed auth refactor',
    entity_type: 'experience',
    scope: 'project',
    created_at: new Date().toISOString(),
  },
];

const LLM_RESPONSE = {
  id: 'test-id',
  object: 'chat.completion',
  model: 'claude-haiku-4-5-20251001',
  choices: [{ index: 0, message: { role: 'assistant', content: 'Summary text here.' }, finishReason: 'stop' }],
  usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
};

async function buildApp(pool: MockPool, llm?: MockLiteLLMClient): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(memoryNarrativeReportRoutes, {
    prefix: '/api/memory/narrative-report',
    pool: pool as never,
    logger,
    litellmClient: llm as never,
  });
  await app.ready();
  return app;
}

describe('memoryNarrativeReportRoutes', () => {
  let app: FastifyInstance;
  let pool: MockPool;
  let llm: MockLiteLLMClient;

  beforeEach(async () => {
    vi.restoreAllMocks();
    pool = createMockPool();
    llm = createMockLLM();
    app = await buildApp(pool, llm);
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 503 when litellmClient is not configured', async () => {
    const appNoLLM = await buildApp(createMockPool());
    const res = await appNoLLM.inject({ method: 'POST', url: '/api/memory/narrative-report', payload: {} });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error).toBe('LITELLM_UNAVAILABLE');
    await appNoLLM.close();
  });

  it('returns 200 with generated text for valid request', async () => {
    pool.query.mockResolvedValueOnce({ rows: SAMPLE_FACTS });
    llm.chatCompletion.mockResolvedValueOnce(LLM_RESPONSE);

    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/narrative-report',
      payload: { style: 'prose' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.text).toBe('Summary text here.');
    expect(body.factCount).toBe(1);
    expect(body.model).toBe('claude-haiku-4-5-20251001');
  });

  it('returns empty text when no facts match', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/narrative-report',
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.factCount).toBe(0);
    expect(llm.chatCompletion).not.toHaveBeenCalled();
  });

  it('applies scope and entity_type filters via parameterized query', async () => {
    pool.query.mockResolvedValueOnce({ rows: SAMPLE_FACTS });
    llm.chatCompletion.mockResolvedValueOnce(LLM_RESPONSE);

    await app.inject({
      method: 'POST',
      url: '/api/memory/narrative-report',
      payload: { scope: 'project:agentctl', entity_type: 'experience', limit: 10 },
    });

    const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE');
    expect(params).toContain('project:agentctl');
    expect(params).toContain('experience');
    expect(params[0]).toBe(10);
  });

  it('clamps limit to MAX_LIMIT=200', async () => {
    pool.query.mockResolvedValueOnce({ rows: SAMPLE_FACTS });
    llm.chatCompletion.mockResolvedValueOnce(LLM_RESPONSE);

    await app.inject({
      method: 'POST',
      url: '/api/memory/narrative-report',
      payload: { limit: 9999 },
    });

    const [, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBe(200);
  });

  it('returns 500 when LLM call throws', async () => {
    pool.query.mockResolvedValueOnce({ rows: SAMPLE_FACTS });
    llm.chatCompletion.mockRejectedValueOnce(new Error('LLM timeout'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/narrative-report',
      payload: {},
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe('NARRATIVE_REPORT_FAILED');
  });
});
