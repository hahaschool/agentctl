import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { drawerBackfillHandler } from './drawer-backfill.js';

const logger = {
  warn: vi.fn(),
} as unknown as Logger;

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentctl-memory-ops-'));
}

function makeRepos() {
  return {
    jobsRepository: {
      isCancelRequested: vi.fn().mockResolvedValue(false),
      transition: vi.fn().mockResolvedValue({}),
    },
    eventsRepository: {
      insert: vi.fn().mockResolvedValue({}),
    },
  };
}

function makePool(): Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
  } as unknown as Pool;
}

function makeResolvedClient() {
  return {
    model: 'gemini-embedding-001',
    priceUsdPerMtoken: 0.5,
    client: {
      embedBatchWithUsage: vi.fn().mockResolvedValue({
        vectors: [Array.from({ length: 1536 }, () => 0.02)],
        usage: { promptTokens: 1000 },
        model: 'gemini-embedding-001',
      }),
    },
  };
}

describe('drawerBackfillHandler', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    delete process.env.MEMORY_OPS_DRAWER_SOURCE_ROOTS;
    delete process.env.MEMORY_OPS_MAX_FAIL_RATIO;
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('rejects sourceRoot outside configured roots', async () => {
    const allowed = makeTempDir();
    const outside = makeTempDir();
    tempDirs.push(allowed, outside);
    process.env.MEMORY_OPS_DRAWER_SOURCE_ROOTS = allowed;

    const { jobsRepository, eventsRepository } = makeRepos();

    await expect(
      drawerBackfillHandler({
        jobId: 'job-1',
        params: { sourceRoot: outside },
        logger,
        pool: makePool(),
        resolvedClient: makeResolvedClient(),
        jobsRepository,
        eventsRepository,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects symlink escapes inside sourceRoot', async () => {
    const allowed = makeTempDir();
    const sourceRoot = path.join(allowed, 'source');
    const outside = makeTempDir();
    fs.mkdirSync(sourceRoot);
    fs.writeFileSync(path.join(outside, 'secret.md'), 'do not read');
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(sourceRoot, 'secret.md'));
    tempDirs.push(allowed, outside);
    process.env.MEMORY_OPS_DRAWER_SOURCE_ROOTS = allowed;

    const { jobsRepository, eventsRepository } = makeRepos();

    await expect(
      drawerBackfillHandler({
        jobId: 'job-1',
        params: { sourceRoot },
        logger,
        pool: makePool(),
        resolvedClient: makeResolvedClient(),
        jobsRepository,
        eventsRepository,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('writes drawer chunks with the resolved embedding model', async () => {
    const allowed = makeTempDir();
    const sourceRoot = path.join(allowed, 'source');
    fs.mkdirSync(sourceRoot);
    fs.writeFileSync(path.join(sourceRoot, 'memory.md'), 'drawer memory content');
    tempDirs.push(allowed);
    process.env.MEMORY_OPS_DRAWER_SOURCE_ROOTS = allowed;

    const pool = makePool();
    const { jobsRepository, eventsRepository } = makeRepos();

    await drawerBackfillHandler({
      jobId: 'job-1',
      params: { sourceRoot, sourceType: 'claude-mem', scope: 'global' },
      logger,
      pool,
      resolvedClient: makeResolvedClient(),
      priceUsdPerMtoken: '0.02',
      jobsRepository,
      eventsRepository,
    });

    const insertCall = vi
      .mocked(pool.query)
      .mock.calls.find((call) => String(call[0]).includes('INSERT INTO memory_drawers'));
    expect(insertCall?.[1]).toEqual(expect.arrayContaining(['gemini-embedding-001']));
    expect(jobsRepository.transition).toHaveBeenCalledWith(
      'job-1',
      'completed',
      expect.objectContaining({ result: expect.objectContaining({ embedded: 1 }) }),
    );
    const completedCall = jobsRepository.transition.mock.calls.find(
      (call) => call[1] === 'completed',
    );
    const completedPayload = completedCall?.[2] as { result?: { costUsd?: number } } | undefined;
    expect(completedPayload?.result?.costUsd).toBeCloseTo(0.00002);
  });
});
