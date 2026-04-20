import { describe, expect, it } from 'vitest';

import { buildMemoryWriteAuditEntry } from './audit.js';

describe('buildMemoryWriteAuditEntry', () => {
  it('builds a stable redacted memory_write entry without raw drawer content', () => {
    const entry = buildMemoryWriteAuditEntry({
      timestamp: '2026-04-20T00:00:00.000Z',
      sessionId: 'session-1',
      agentId: 'agent-1',
      machineId: 'machine-1',
      drawerId: 'drawer-1',
      sourceType: 'session-jsonl',
      scope: 'project:agentctl',
      chunkIndex: 3,
      contentHash: 'a'.repeat(64),
      redactionStatus: 'sanitized',
      success: true,
      metadata: {
        token: 'raw-token',
        safe: 'visible',
        content: 'raw drawer content with sk-proj-secret1234567890',
        nested: {
          authorization: 'Bearer raw',
          narrative: 'raw transcript narrative',
        },
      },
    });

    expect(entry).toEqual({
      kind: 'memory_write',
      timestamp: '2026-04-20T00:00:00.000Z',
      sessionId: 'session-1',
      agentId: 'agent-1',
      machineId: 'machine-1',
      drawerId: 'drawer-1',
      sourceType: 'session-jsonl',
      scope: 'project:agentctl',
      chunkIndex: 3,
      contentHash: 'a'.repeat(64),
      redactionStatus: 'sanitized',
      success: true,
      error: null,
      metadata: {
        token: '[REDACTED]',
        safe: 'visible',
        nested: {
          authorization: '[REDACTED]',
        },
      },
    });
    expect(JSON.stringify(entry)).not.toContain('raw-token');
    expect(JSON.stringify(entry)).not.toContain('raw drawer content');
    expect(JSON.stringify(entry)).not.toContain('raw transcript narrative');
  });
});
