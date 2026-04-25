import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EntityCanonicalizationProposalRow } from '../../memory/entity-canonicalization-proposals.js';
import { EntityCanonicalizationStore } from '../../memory/entity-canonicalization-store.js';
import { memoryCanonicalizeApplyRoutes } from './memory-canonicalize-apply.js';
import { createMockLogger } from './test-helpers.js';

vi.mock('../../memory/entity-canonicalization-store.js');

type MockPool = { query: ReturnType<typeof vi.fn> };

const logger = createMockLogger();

function makePool(): MockPool {
  return { query: vi.fn() };
}

async function buildApp(pool: MockPool): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(memoryCanonicalizeApplyRoutes, {
    prefix: '/api/memory/canonicalize/apply',
    pool: pool as never,
    logger,
  });
  await app.ready();
  return app;
}

function makeProposal(overrides: Partial<EntityCanonicalizationProposalRow> = {}): EntityCanonicalizationProposalRow {
  return {
    factId: 'fact_001',
    scope: 'project:agentctl',
    entityType: 'person',
    entityName: 'Garry Tan',
    normalizedEntityName: 'garry tan',
    status: 'resolved',
    resolutionReason: 'fuzzy',
    proposalAction: 'review_alias',
    canonicalId: 'me_canon_001',
    canonicalName: 'Garry Tan',
    proposedAlias: 'Garry Tan',
    aliasAlreadyExists: false,
    matchedCanonicalIds: ['me_canon_001'],
    matchedCanonicalNames: ['Garry Tan'],
    contentPreview: null,
    reviewSource: {
      scope: 'project:agentctl',
      sessionId: null,
      agentId: null,
      machineId: null,
      turnIndex: null,
      importSourceId: null,
      importJobId: null,
    },
    ...overrides,
  };
}

describe('memoryCanonicalizeApplyRoutes', () => {
  let app: FastifyInstance;
  let pool: MockPool;
  let upsertAliasMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    pool = makePool();
    upsertAliasMock = vi.fn().mockResolvedValue({ id: 'mea_001', canonicalId: 'me_canon_001', alias: 'Garry Tan', normalizedAlias: 'garry tan', sourceJson: {}, createdAt: new Date().toISOString() });
    vi.mocked(EntityCanonicalizationStore).mockImplementation(() => ({
      upsertAlias: upsertAliasMock,
      createEntity: vi.fn(),
      listAliases: vi.fn(),
      resolveEntityName: vi.fn(),
    }) as never);
    app = await buildApp(pool);
  });

  afterEach(async () => {
    await app.close();
  });

  it('applies actionable proposals and returns counts', async () => {
    const proposals = [makeProposal()];

    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/canonicalize/apply',
      payload: { proposals },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.dryRun).toBe(false);
    expect(body.applied).toBe(1);
    expect(body.skipped).toBe(0);
    expect(body.errors).toHaveLength(0);
    expect(upsertAliasMock).toHaveBeenCalledWith({
      canonicalId: 'me_canon_001',
      alias: 'Garry Tan',
      sourceJson: { factId: 'fact_001' },
    });
  });

  it('skips proposals with non-review_alias action', async () => {
    const proposals = [
      makeProposal({ proposalAction: 'none', canonicalId: 'me_canon_001' }),
      makeProposal({ proposalAction: 'review_match', canonicalId: 'me_canon_001' }),
      makeProposal({ proposalAction: 'review_entity', canonicalId: null }),
    ];

    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/canonicalize/apply',
      payload: { proposals },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.applied).toBe(0);
    expect(body.skipped).toBe(3);
    expect(upsertAliasMock).not.toHaveBeenCalled();
  });

  it('skips proposals with null canonicalId even if action is review_alias', async () => {
    const proposals = [makeProposal({ canonicalId: null })];

    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/canonicalize/apply',
      payload: { proposals },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.applied).toBe(0);
    expect(body.skipped).toBe(1);
  });

  it('dry run returns expected counts without writing', async () => {
    const proposals = [makeProposal(), makeProposal({ factId: 'fact_002' })];

    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/canonicalize/apply',
      payload: { proposals, dryRun: true },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.dryRun).toBe(true);
    expect(body.applied).toBe(2);
    expect(body.skipped).toBe(0);
    expect(upsertAliasMock).not.toHaveBeenCalled();
  });

  it('handles empty proposals array', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/canonicalize/apply',
      payload: { proposals: [] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.applied).toBe(0);
    expect(body.skipped).toBe(0);
    expect(body.errors).toHaveLength(0);
  });

  it('records errors without aborting when upsertAlias throws', async () => {
    upsertAliasMock.mockRejectedValueOnce(new Error('DB constraint'));
    const proposals = [makeProposal({ factId: 'fact_fail' }), makeProposal({ factId: 'fact_ok' })];

    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/canonicalize/apply',
      payload: { proposals },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.applied).toBe(1);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].factId).toBe('fact_fail');
    expect(body.errors[0].error).toBe('DB constraint');
  });
});
