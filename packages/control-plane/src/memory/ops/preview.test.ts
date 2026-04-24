import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedEmbeddingClient } from '../embedding-client-factory.js';

const resolvedClient: ResolvedEmbeddingClient = {
  client: {} as never,
  credentialId: 'credential-1',
  model: 'text-embedding-3-small',
  providerKind: 'openai',
  providerHost: 'https://api.openai.com',
  priceUsdPerMtoken: 0.02,
};

describe('preview helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a signed preview token and rejects stale snapshots', async () => {
    process.env.MEMORY_OPS_SIGNING_SECRET = 'preview-secret';
    const { createPreviewToken, verifyPreviewToken } = await import('./preview.js');
    const snapshot = {
      kind: 'embedding-backfill',
      providerKind: 'openai',
      providerModel: 'text-embedding-3-small',
      providerHost: 'https://api.openai.com',
      priceUsdPerMtoken: 0.02,
      rowCount: 100,
      tokenEstimate: 1000,
      costEstimate: 0.00002,
      contentClass: 'memory-facts',
      computedAt: '2026-04-25T00:00:00Z',
    } as const;

    const token = createPreviewToken(snapshot);

    expect(verifyPreviewToken(token, snapshot)).toBe(true);
    expect(
      verifyPreviewToken(token, {
        ...snapshot,
        rowCount: 150,
      }),
    ).toBe(false);
  });

  it('expires preview tokens after ten minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T00:00:00Z'));
    process.env.MEMORY_OPS_SIGNING_SECRET = 'preview-secret';
    const { createPreviewToken, verifyPreviewToken } = await import('./preview.js');
    const snapshot = {
      kind: 'embedding-backfill',
      providerKind: 'openai',
      providerModel: 'text-embedding-3-small',
      providerHost: 'https://api.openai.com',
      priceUsdPerMtoken: 0.02,
      rowCount: 100,
      tokenEstimate: 1000,
      costEstimate: 0.00002,
      contentClass: 'memory-facts',
      computedAt: '2026-04-25T00:00:00Z',
    } as const;

    const token = createPreviewToken(snapshot);
    vi.setSystemTime(new Date('2026-04-25T00:11:00Z'));

    expect(verifyPreviewToken(token, snapshot)).toBe(false);
  });

  it('rejects drawer previews outside configured roots', async () => {
    const allowedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-ops-allowed-'));
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-ops-outside-'));
    process.env.MEMORY_OPS_DRAWER_SOURCE_ROOTS = allowedRoot;
    const { buildEgressSnapshot } = await import('./preview.js');

    await expect(
      buildEgressSnapshot('drawer-backfill', {
        params: {
          sourceRoot: outsideRoot,
          sourceType: 'claude-mem',
        },
        embeddingClientResolver: async () => resolvedClient,
        logger: { child: () => ({}) } as never,
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      context: expect.objectContaining({ sourceRootViolation: true }),
    });
  });

  it('rejects drawer previews when a nested symlink escapes the source root', async () => {
    const allowedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-ops-source-'));
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-ops-escape-'));
    const sourceRoot = path.join(allowedRoot, 'drawer');
    fs.mkdirSync(sourceRoot);
    fs.writeFileSync(path.join(outsideRoot, 'secrets.txt'), 'top-secret');
    fs.symlinkSync(path.join(outsideRoot, 'secrets.txt'), path.join(sourceRoot, 'escape.txt'));
    process.env.MEMORY_OPS_DRAWER_SOURCE_ROOTS = allowedRoot;
    const { buildEgressSnapshot } = await import('./preview.js');

    await expect(
      buildEgressSnapshot('drawer-backfill', {
        params: {
          sourceRoot,
          sourceType: 'claude-mem',
        },
        embeddingClientResolver: async () => resolvedClient,
        logger: { child: () => ({}) } as never,
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      context: expect.objectContaining({ sourceRootViolation: true }),
    });
  });
});
