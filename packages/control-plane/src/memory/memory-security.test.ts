import { ControlPlaneError } from '@agentctl/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { createMemorySecurity, type MemoryEntry, type MemorySecurity } from './memory-security.js';

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    agentId: 'agent-1',
    content: 'This is a normal memory entry about TypeScript patterns.',
    ...overrides,
  };
}

describe('MemorySecurity', () => {
  let security: MemorySecurity;

  beforeEach(() => {
    security = createMemorySecurity();
  });

  describe('validate() — agentId checks', () => {
    it('blocks entries with empty agentId', () => {
      const result = security.validate(makeEntry({ agentId: '' }));

      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain('agentId');
    });

    it('blocks entries with whitespace-only agentId', () => {
      const result = security.validate(makeEntry({ agentId: '   ' }));

      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain('agentId');
    });

    it('passes entries with valid agentId', () => {
      const result = security.validate(makeEntry({ agentId: 'agent-42' }));

      expect(result.blocked).toBe(false);
    });
  });

  describe('validate() — content length', () => {
    it('blocks content exceeding maxContentLength', () => {
      const result = security.validate(makeEntry({ content: 'x'.repeat(50_001) }));

      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain('Content length');
      expect(result.blockReason).toContain('50001');
    });

    it('allows content exactly at maxContentLength', () => {
      const small = createMemorySecurity({ maxContentLength: 500 });
      const result = small.validate(makeEntry({ content: 'x'.repeat(500) }));

      expect(result.blocked).toBe(false);
    });

    it('respects custom maxContentLength', () => {
      const strict = createMemorySecurity({ maxContentLength: 100 });
      const result = strict.validate(makeEntry({ content: 'x'.repeat(101) }));

      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain('101');
    });

    it('allows empty content', () => {
      const result = security.validate(makeEntry({ content: '' }));

      expect(result.blocked).toBe(false);
    });
  });

  describe('validate() — tags', () => {
    it('truncates tags exceeding maxTagCount with warning', () => {
      const tags = Array.from({ length: 25 }, (_, i) => `tag-${i}`);
      const result = security.validate(makeEntry({ tags }));

      expect(result.blocked).toBe(false);
      expect(result.sanitized.tags).toHaveLength(20);
      expect(result.warnings.some((w) => w.includes('Tag count'))).toBe(true);
    });

    it('truncates individual tags exceeding maxTagLength with warning', () => {
      const longTag = 'a'.repeat(150);
      const result = security.validate(makeEntry({ tags: [longTag] }));

      expect(result.blocked).toBe(false);
      expect(result.sanitized.tags?.[0]).toHaveLength(100);
      expect(result.warnings.some((w) => w.includes('exceeds maximum length'))).toBe(true);
    });

    it('passes through valid tags unchanged', () => {
      const tags = ['typescript', 'patterns', 'architecture'];
      const result = security.validate(makeEntry({ tags }));

      expect(result.blocked).toBe(false);
      expect(result.sanitized.tags).toEqual(tags);
      expect(result.warnings).toHaveLength(0);
    });

    it('handles undefined tags', () => {
      const result = security.validate(makeEntry({ tags: undefined }));

      expect(result.blocked).toBe(false);
      expect(result.sanitized.tags).toBeUndefined();
    });

    it('handles empty tags array', () => {
      const result = security.validate(makeEntry({ tags: [] }));

      expect(result.blocked).toBe(false);
      expect(result.sanitized.tags).toEqual([]);
    });
  });

  describe('validate() — metadata', () => {
    it('truncates metadata keys exceeding maxMetadataKeys with warning', () => {
      const metadata: Record<string, unknown> = {};
      for (let i = 0; i < 55; i++) {
        metadata[`key-${i}`] = `value-${i}`;
      }

      const result = security.validate(makeEntry({ metadata }));

      expect(result.blocked).toBe(false);
      expect(Object.keys(result.sanitized.metadata ?? {}).length).toBeLessThanOrEqual(50);
      expect(result.warnings.some((w) => w.includes('Metadata has 55 keys'))).toBe(true);
    });

    it('truncates long metadata string values with warning', () => {
      const metadata = { longKey: 'x'.repeat(6000) };
      const result = security.validate(makeEntry({ metadata }));

      expect(result.blocked).toBe(false);
      const val = result.sanitized.metadata?.longKey;
      expect(typeof val === 'string' ? val.length : 0).toBeLessThanOrEqual(5000);
      expect(result.warnings.some((w) => w.includes("Metadata key 'longKey'"))).toBe(true);
    });

    it('handles undefined metadata', () => {
      const result = security.validate(makeEntry({ metadata: undefined }));

      expect(result.blocked).toBe(false);
      expect(result.sanitized.metadata).toBeUndefined();
    });

    it('handles empty metadata', () => {
      const result = security.validate(makeEntry({ metadata: {} }));

      expect(result.blocked).toBe(false);
      expect(result.sanitized.metadata).toEqual({});
    });

    it('preserves valid metadata unchanged', () => {
      const metadata = { source: 'test', count: 42, active: true };
      const result = security.validate(makeEntry({ metadata }));

      expect(result.blocked).toBe(false);
      expect(result.sanitized.metadata).toEqual(metadata);
    });
  });

  describe('validate() — blocked patterns (secrets detection)', () => {
    it('blocks content containing sk- style API keys', () => {
      const content = 'Use this key: sk-abcdefghijklmnopqrstuvwxyz1234567890abcd to connect';
      const result = security.validate(makeEntry({ content }));

      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain('blocked pattern');
    });

    it('blocks content containing api_key pattern', () => {
      const content = 'Set api_keyabcdefghijklmnopqrstuvwx12345 in your config';
      const result = security.validate(makeEntry({ content }));

      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain('blocked pattern');
    });

    it('blocks content containing api-key pattern', () => {
      const content = 'Header: api-keyabcdefghijklmnopqrstuvwx12345 is required';
      const result = security.validate(makeEntry({ content }));

      expect(result.blocked).toBe(true);
    });

    it('blocks content containing bearer tokens', () => {
      const content = 'Authorization: bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdef';
      const result = security.validate(makeEntry({ content }));

      expect(result.blocked).toBe(true);
    });

    it('blocks content containing AWS access key IDs', () => {
      const content = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
      const result = security.validate(makeEntry({ content }));

      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain('blocked pattern');
    });

    it('blocks content containing private keys', () => {
      const content = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQ...';
      const result = security.validate(makeEntry({ content }));

      expect(result.blocked).toBe(true);
    });

    it('blocks content with EC private keys', () => {
      const content = '-----BEGIN EC PRIVATE KEY-----\nMHQCAQ...';
      const result = security.validate(makeEntry({ content }));

      expect(result.blocked).toBe(true);
    });

    it('blocks content with generic private keys', () => {
      const content = '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...';
      const result = security.validate(makeEntry({ content }));

      expect(result.blocked).toBe(true);
    });

    it('blocks content containing postgres connection strings with passwords', () => {
      const content = 'DATABASE_URL=postgres://admin:supersecret@db.example.com:5432/mydb';
      const result = security.validate(makeEntry({ content }));

      expect(result.blocked).toBe(true);
    });

    it('blocks content containing mysql connection strings with passwords', () => {
      const content = 'mysql://root:password123@localhost:3306/app';
      const result = security.validate(makeEntry({ content }));

      expect(result.blocked).toBe(true);
    });

    it('blocks content containing redis connection strings with passwords', () => {
      const content = 'redis://default:mypassword@redis.example.com:6379';
      const result = security.validate(makeEntry({ content }));

      expect(result.blocked).toBe(true);
    });

    it('does not block content without secrets', () => {
      const content =
        'The agent should use TypeScript strict mode and follow the project conventions.';
      const result = security.validate(makeEntry({ content }));

      expect(result.blocked).toBe(false);
    });

    it('does not block short strings that partially match patterns', () => {
      const content = 'Use sk- prefix for keys. The API key format is documented.';
      const result = security.validate(makeEntry({ content }));

      expect(result.blocked).toBe(false);
    });
  });

  describe('validate() — sensitive pattern redaction', () => {
    it('redacts email addresses', () => {
      const content = 'Contact admin@example.com for access.';
      const result = security.validate(makeEntry({ content }));

      expect(result.blocked).toBe(false);
      expect(result.sanitized.content).toBe('Contact [REDACTED] for access.');
      expect(result.warnings.some((w) => w.includes('sensitive data'))).toBe(true);
    });

    it('redacts multiple email addresses', () => {
      const content = 'Send to alice@dev.org and bob@company.io please.';
      const result = security.validate(makeEntry({ content }));

      expect(result.blocked).toBe(false);
      expect(result.sanitized.content).toBe('Send to [REDACTED] and [REDACTED] please.');
    });

    it('redacts non-Tailscale IP addresses', () => {
      const content = 'Server is at 192.168.1.100 on the network.';
      const result = security.validate(makeEntry({ content }));

      expect(result.blocked).toBe(false);
      expect(result.sanitized.content).toBe('Server is at [REDACTED] on the network.');
    });

    it('does NOT redact Tailscale IP addresses (100.64-127.x.x.x)', () => {
      const content = 'Connect to Tailscale peer at 100.100.50.25 for sync.';
      const result = security.validate(makeEntry({ content }));

      expect(result.blocked).toBe(false);
      expect(result.sanitized.content).toContain('100.100.50.25');
    });

    it('redacts public IPs while preserving Tailscale range', () => {
      const content = 'Public: 203.0.113.50, Tailscale: 100.64.0.1, Internal: 10.0.0.5';
      const result = security.validate(makeEntry({ content }));

      expect(result.sanitized.content).toContain('100.64.0.1');
      expect(result.sanitized.content).not.toContain('203.0.113.50');
      expect(result.sanitized.content).not.toContain('10.0.0.5');
    });

    it('does not produce warnings when no sensitive data found', () => {
      const content = 'This is completely clean content.';
      const result = security.validate(makeEntry({ content }));

      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('validate() — allowedAgentIds', () => {
    it('blocks agents not in the allowed list', () => {
      const restricted = createMemorySecurity({
        allowedAgentIds: ['agent-1', 'agent-2'],
      });

      const result = restricted.validate(makeEntry({ agentId: 'agent-rogue' }));

      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain('agent-rogue');
      expect(result.blockReason).toContain('not in the allowed');
    });

    it('allows agents in the allowed list', () => {
      const restricted = createMemorySecurity({
        allowedAgentIds: ['agent-1', 'agent-2'],
      });

      const result = restricted.validate(makeEntry({ agentId: 'agent-1' }));

      expect(result.blocked).toBe(false);
    });

    it('does not restrict when allowedAgentIds is not set', () => {
      const result = security.validate(makeEntry({ agentId: 'any-agent-at-all' }));

      expect(result.blocked).toBe(false);
    });
  });

  describe('validate() — custom blocked patterns', () => {
    it('uses custom blocked patterns instead of defaults', () => {
      const custom = createMemorySecurity({
        blockedPatterns: [/FORBIDDEN_WORD/g],
      });

      const blocked = custom.validate(makeEntry({ content: 'Contains FORBIDDEN_WORD here' }));
      expect(blocked.blocked).toBe(true);

      // Default patterns should NOT apply since we replaced them
      const allowed = custom.validate(
        makeEntry({
          content: 'sk-abcdefghijklmnopqrstuvwxyz1234567890abcd',
        }),
      );
      expect(allowed.blocked).toBe(false);
    });
  });

  describe('validate() — custom sensitive patterns', () => {
    it('uses custom sensitive patterns for redaction', () => {
      const custom = createMemorySecurity({
        sensitivePatterns: [/SECRET_\w+/g],
      });

      const result = custom.validate(
        makeEntry({ content: 'The value is SECRET_TOKEN_123 in config.' }),
      );

      expect(result.blocked).toBe(false);
      expect(result.sanitized.content).toBe('The value is [REDACTED] in config.');
    });
  });

  describe('sanitizeMetadata()', () => {
    it('removes function values', () => {
      const metadata = {
        name: 'test',
        callback: () => 'evil',
        nested: 'value',
      };

      const result = security.sanitizeMetadata(metadata as Record<string, unknown>);

      expect(result).not.toHaveProperty('callback');
      expect(result.name).toBe('test');
      expect(result.nested).toBe('value');
    });

    it('truncates long string values', () => {
      const custom = createMemorySecurity({ maxMetadataValueLength: 50 });
      const metadata = { description: 'x'.repeat(100) };

      const result = custom.sanitizeMetadata(metadata);

      expect((result.description as string).length).toBe(50);
    });

    it('stringifies nested objects', () => {
      const metadata = {
        config: { host: 'localhost', port: 5432 },
      };

      const result = security.sanitizeMetadata(metadata);

      expect(typeof result.config).toBe('string');
      expect(result.config).toContain('localhost');
    });

    it('preserves primitive values', () => {
      const metadata = {
        count: 42,
        active: true,
        label: 'test',
      };

      const result = security.sanitizeMetadata(metadata);

      expect(result.count).toBe(42);
      expect(result.active).toBe(true);
      expect(result.label).toBe('test');
    });

    it('handles null and undefined values', () => {
      const metadata = {
        nullVal: null,
        undefinedVal: undefined,
      };

      const result = security.sanitizeMetadata(metadata as Record<string, unknown>);

      expect(result.nullVal).toBeNull();
      expect(result.undefinedVal).toBeUndefined();
    });

    it('returns empty object for empty input', () => {
      const result = security.sanitizeMetadata({});

      expect(result).toEqual({});
    });

    it('preserves arrays', () => {
      const metadata = { tags: ['a', 'b', 'c'] };

      const result = security.sanitizeMetadata(metadata);

      expect(result.tags).toEqual(['a', 'b', 'c']);
    });
  });

  describe('createIsolatedNamespace()', () => {
    it('returns correct namespace prefix for agent', () => {
      const ns = security.createIsolatedNamespace('agent-42');

      expect(ns).toBe('agent:agent-42:');
    });

    it('returns unique namespaces for different agents', () => {
      const ns1 = security.createIsolatedNamespace('agent-1');
      const ns2 = security.createIsolatedNamespace('agent-2');

      expect(ns1).not.toBe(ns2);
    });

    it('throws ControlPlaneError for empty agentId', () => {
      expect(() => security.createIsolatedNamespace('')).toThrow(ControlPlaneError);
    });

    it('throws ControlPlaneError for whitespace-only agentId', () => {
      expect(() => security.createIsolatedNamespace('   ')).toThrow(ControlPlaneError);
    });

    it('includes MEMORY_INVALID_AGENT_ID error code', () => {
      try {
        security.createIsolatedNamespace('');
      } catch (error: unknown) {
        expect((error as ControlPlaneError).code).toBe('MEMORY_INVALID_AGENT_ID');
      }
    });
  });

  describe('validateNamespaceAccess()', () => {
    it('returns true when key starts with agent namespace', () => {
      const result = security.validateNamespaceAccess('agent-1', 'agent:agent-1:memory-key');

      expect(result).toBe(true);
    });

    it('returns false when key belongs to different agent', () => {
      const result = security.validateNamespaceAccess('agent-1', 'agent:agent-2:memory-key');

      expect(result).toBe(false);
    });

    it('returns false for keys without namespace prefix', () => {
      const result = security.validateNamespaceAccess('agent-1', 'global:shared-memory');

      expect(result).toBe(false);
    });

    it('returns false for empty key', () => {
      const result = security.validateNamespaceAccess('agent-1', '');

      expect(result).toBe(false);
    });

    it('returns false when agent prefix is substring but not proper namespace', () => {
      // "agent:agent-1:" is 15 chars. "agent:agent-10:" would be 16 chars.
      // Key "agent:agent-10:data" should NOT be accessible by agent-1.
      const result = security.validateNamespaceAccess('agent-1', 'agent:agent-10:data');

      expect(result).toBe(false);
    });

    it('handles special characters in agentId', () => {
      const result = security.validateNamespaceAccess('agent/special', 'agent:agent/special:key');

      expect(result).toBe(true);
    });
  });

  describe('validate() — edge cases', () => {
    it('handles entry with all fields populated', () => {
      const result = security.validate({
        agentId: 'agent-1',
        content: 'Full entry with everything set.',
        tags: ['tag-1', 'tag-2'],
        metadata: { source: 'test', priority: 'high' },
      });

      expect(result.blocked).toBe(false);
      expect(result.sanitized.agentId).toBe('agent-1');
      expect(result.sanitized.content).toBe('Full entry with everything set.');
      expect(result.sanitized.tags).toEqual(['tag-1', 'tag-2']);
      expect(result.sanitized.metadata).toEqual({
        source: 'test',
        priority: 'high',
      });
    });

    it('handles entry with only required fields', () => {
      const result = security.validate({
        agentId: 'agent-1',
        content: 'Minimal entry.',
      });

      expect(result.blocked).toBe(false);
      expect(result.sanitized.tags).toBeUndefined();
      expect(result.sanitized.metadata).toBeUndefined();
    });

    it('redacts sensitive data and adds warnings without blocking', () => {
      const content = 'Deploy to 192.168.1.1 and email admin@internal.dev when done.';
      const result = security.validate(makeEntry({ content }));

      expect(result.blocked).toBe(false);
      expect(result.sanitized.content).not.toContain('192.168.1.1');
      expect(result.sanitized.content).not.toContain('admin@internal.dev');
      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    });

    it('blocks before redacting when content matches blocked pattern', () => {
      const content = 'Key: sk-abcdefghijklmnopqrstuvwxyz1234567890abcd and email admin@test.com';
      const result = security.validate(makeEntry({ content }));

      // Should be blocked, not just redacted
      expect(result.blocked).toBe(true);
    });

    it('handles multiple invocations without state leaking between calls', () => {
      const entry1 = makeEntry({ content: 'Email user@example.com here.' });
      const result1 = security.validate(entry1);

      const entry2 = makeEntry({ content: 'Clean content with no PII.' });
      const result2 = security.validate(entry2);

      expect(result1.warnings.length).toBeGreaterThan(0);
      expect(result2.warnings).toHaveLength(0);
      expect(result2.sanitized.content).toBe('Clean content with no PII.');
    });
  });

  describe('createMemorySecurity() — factory', () => {
    it('creates instance with default config when no args provided', () => {
      const sec = createMemorySecurity();
      const result = sec.validate(makeEntry());

      expect(result.blocked).toBe(false);
    });

    it('merges partial config with defaults', () => {
      const sec = createMemorySecurity({ maxTagCount: 5 });

      const tags = Array.from({ length: 10 }, (_, i) => `t${i}`);
      const result = sec.validate(makeEntry({ tags }));

      expect(result.sanitized.tags).toHaveLength(5);
    });

    it('allows overriding all config fields', () => {
      const sec = createMemorySecurity({
        maxContentLength: 100,
        maxTagCount: 2,
        maxTagLength: 10,
        maxMetadataKeys: 3,
        maxMetadataValueLength: 20,
        blockedPatterns: [/BLOCK_ME/g],
        sensitivePatterns: [/REDACT_ME/g],
        allowedAgentIds: ['allowed-agent'],
      });

      // Test custom content length
      const longResult = sec.validate(
        makeEntry({ agentId: 'allowed-agent', content: 'x'.repeat(101) }),
      );
      expect(longResult.blocked).toBe(true);

      // Test custom blocked pattern
      const blockedResult = sec.validate(
        makeEntry({ agentId: 'allowed-agent', content: 'Has BLOCK_ME in it' }),
      );
      expect(blockedResult.blocked).toBe(true);

      // Test custom sensitive pattern
      const redactResult = sec.validate(
        makeEntry({
          agentId: 'allowed-agent',
          content: 'Has REDACT_ME in it',
        }),
      );
      expect(redactResult.blocked).toBe(false);
      expect(redactResult.sanitized.content).toBe('Has [REDACTED] in it');
    });
  });
});
