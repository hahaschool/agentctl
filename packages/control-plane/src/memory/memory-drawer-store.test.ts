import { describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../api/routes/test-helpers.js';

import type { EmbeddingClient } from './embedding-client.js';
import { MemoryDrawerStore } from './memory-drawer-store.js';

function createMockEmbedding(): EmbeddingClient {
  return {
    embed: vi.fn(),
    embedBatch: vi
      .fn()
      .mockResolvedValue([
        Array.from({ length: 4 }, () => 0.1),
        Array.from({ length: 4 }, () => 0.2),
      ]),
  } as unknown as EmbeddingClient;
}

function createMockPool() {
  return {
    query: vi.fn().mockImplementation((_sql: string, params: unknown[]) => ({
      rows: [
        {
          id: params[0],
          scope: params[1],
          topic: params[2],
          source_type: params[3],
          source_id: params[4],
          source_uri: params[5],
          chunk_index: params[6],
          content: params[7],
          content_sha256: params[8],
          embedding_model: params[10],
          embedding_version: params[11],
          token_count: params[12],
          source_json: params[13],
          sync_visibility: params[14],
          redaction_status: params[17],
          created_at: new Date('2026-04-20T00:00:00.000Z'),
          updated_at: new Date('2026-04-20T00:00:00.000Z'),
        },
      ],
      rowCount: 1,
    })),
  };
}

function joinFixtureParts(parts: string[]): string {
  return parts.join('');
}

describe('MemoryDrawerStore', () => {
  it('stores sanitized chunks, hashes sanitized content, and embeds sanitized content only', async () => {
    const pool = createMockPool();
    const embedding = createMockEmbedding();
    const store = new MemoryDrawerStore({
      pool: pool as never,
      embeddingClient: embedding,
      logger: createMockLogger(),
    });

    const openAiValue = joinFixtureParts(['sk', '-proj-', 'secret', '1234567890']);
    const result = await store.writeSource({
      scope: 'project:agentctl',
      sourceType: 'manual',
      sourceId: 'manual-1',
      content: `remember OPENAI_API_KEY=${openAiValue}`,
      sourceJson: { token: 'raw-token', safe: 'visible' },
    });

    expect(result.drawers).toHaveLength(1);
    expect(result.drawers[0]?.content).not.toContain(openAiValue);
    expect(result.drawers[0]?.sourceJson).toEqual({ token: '[REDACTED]', safe: 'visible' });
    expect(embedding.embedBatch).toHaveBeenCalledWith([result.drawers[0]?.content]);
    expect(result.drawers[0]?.contentSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uses source-local upsert idempotency while allowing duplicate content hashes across sources', async () => {
    const pool = createMockPool();
    const store = new MemoryDrawerStore({
      pool: pool as never,
      logger: createMockLogger(),
    });

    await store.writeSource({
      scope: 'project:agentctl',
      sourceType: 'manual',
      sourceId: 'source-a',
      content: 'same sanitized content',
    });
    await store.writeSource({
      scope: 'project:agentctl',
      sourceType: 'manual',
      sourceId: 'source-b',
      content: 'same sanitized content',
    });

    const firstCall = vi.mocked(pool.query).mock.calls[0];
    expect(firstCall?.[0]).toContain('ON CONFLICT (source_type, source_id, chunk_index)');

    const firstHash = vi.mocked(pool.query).mock.calls[0]?.[1]?.[8];
    const secondHash = vi.mocked(pool.query).mock.calls[1]?.[1]?.[8];
    expect(firstHash).toBe(secondHash);
    expect(vi.mocked(pool.query).mock.calls[0]?.[1]?.[4]).toBe('source-a');
    expect(vi.mocked(pool.query).mock.calls[1]?.[1]?.[4]).toBe('source-b');
  });

  it('emits a redacted memory_write audit entry after storing a drawer', async () => {
    const pool = createMockPool();
    const auditLogger = { writeMemoryWrite: vi.fn().mockResolvedValue(undefined) };
    const store = new MemoryDrawerStore({
      pool: pool as never,
      logger: createMockLogger(),
      auditLogger,
    });

    const openAiValue = joinFixtureParts(['sk', '-proj-', 'secret', '1234567890']);
    const result = await store.writeSource({
      scope: 'project:agentctl',
      sourceType: 'session-jsonl',
      sourceId: 'session-1.jsonl',
      content: `remember OPENAI_API_KEY=${openAiValue}`,
      sourceJson: {
        session_id: 'session-1',
        agent_id: 'agent-1',
        machine_id: 'machine-1',
        token: 'raw-token',
        safe: 'visible',
        content: 'raw drawer content',
      },
    });

    expect(auditLogger.writeMemoryWrite).toHaveBeenCalledTimes(1);
    expect(auditLogger.writeMemoryWrite).toHaveBeenCalledWith({
      sessionId: 'session-1',
      agentId: 'agent-1',
      machineId: 'machine-1',
      drawerId: result.drawers[0]?.id,
      sourceType: 'session-jsonl',
      scope: 'project:agentctl',
      chunkIndex: 0,
      contentHash: result.drawers[0]?.contentSha256,
      redactionStatus: 'sanitized',
      success: true,
      metadata: {
        session_id: 'session-1',
        agent_id: 'agent-1',
        machine_id: 'machine-1',
        token: '[REDACTED]',
        safe: 'visible',
      },
    });
    expect(JSON.stringify(auditLogger.writeMemoryWrite.mock.calls[0][0])).not.toContain(
      'raw-token',
    );
    expect(JSON.stringify(auditLogger.writeMemoryWrite.mock.calls[0][0])).not.toContain(
      'raw drawer content',
    );
    expect(JSON.stringify(auditLogger.writeMemoryWrite.mock.calls[0][0])).not.toContain(
      openAiValue,
    );
  });

  it('emits a failed memory_write audit entry without leaking drawer content when insert fails', async () => {
    const pool = createMockPool();
    const auditLogger = { writeMemoryWrite: vi.fn().mockResolvedValue(undefined) };
    const dbError = Object.assign(new Error('raw drawer content leaked by driver'), {
      code: '23505',
    });
    vi.mocked(pool.query).mockRejectedValueOnce(dbError);

    const store = new MemoryDrawerStore({
      pool: pool as never,
      logger: createMockLogger(),
      auditLogger,
    });

    await expect(
      store.writeSource({
        scope: 'project:agentctl',
        sourceType: 'manual',
        sourceId: 'manual-1',
        content: 'raw drawer content with password=hunter2',
        sourceJson: {
          sessionId: 'session-1',
          agentId: 'agent-1',
          machineId: 'machine-1',
          password: 'hunter2',
        },
      }),
    ).rejects.toThrow(dbError);

    expect(auditLogger.writeMemoryWrite).toHaveBeenCalledTimes(1);
    expect(auditLogger.writeMemoryWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        agentId: 'agent-1',
        machineId: 'machine-1',
        drawerId: null,
        sourceType: 'manual',
        scope: 'project:agentctl',
        chunkIndex: 0,
        success: false,
        error: '23505',
        metadata: {
          sessionId: 'session-1',
          agentId: 'agent-1',
          machineId: 'machine-1',
          password: '[REDACTED]',
        },
      }),
    );
    expect(JSON.stringify(auditLogger.writeMemoryWrite.mock.calls[0][0])).not.toContain(
      'raw drawer content',
    );
    expect(JSON.stringify(auditLogger.writeMemoryWrite.mock.calls[0][0])).not.toContain('hunter2');
  });
});
