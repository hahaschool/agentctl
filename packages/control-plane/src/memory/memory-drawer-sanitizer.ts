import { createHash } from 'node:crypto';

import type { MemoryDrawerRedactionStatus } from '@agentctl/shared';

import type { SanitizeMemoryDrawerContentResult } from './memory-drawer-types.js';

const REDACTED = '[REDACTED]';

type RedactionPattern = {
  pattern: RegExp;
  replacement: string | ((match: string, ...captures: string[]) => string);
  quarantines?: boolean;
};

const REDACTION_PATTERNS: RedactionPattern[] = [
  {
    pattern:
      /^([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|COOKIE|DSN|DATABASE_URL|REDIS_URL)[A-Z0-9_]*\s*=\s*).+$/gim,
    replacement: (_match, prefix: string) => `${prefix}${REDACTED}`,
  },
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
    quarantines: true,
  },
  {
    pattern: /\bsk-ant-[A-Za-z0-9_-]{8,}\b/g,
    replacement: REDACTED,
  },
  {
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}\b/g,
    replacement: REDACTED,
  },
  {
    pattern: /\b(?:ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    replacement: REDACTED,
  },
  {
    pattern: /\b(Authorization:\s*Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi,
    replacement: (_match, prefix: string) => `${prefix}${REDACTED}`,
  },
  {
    pattern: /\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){1,2}\b/g,
    replacement: REDACTED,
  },
  {
    pattern: /\b(?:postgres|postgresql|redis|mysql):\/\/[^\s'")<>]+/gi,
    replacement: REDACTED,
  },
  {
    pattern: /\b(Cookie|Set-Cookie):[^\n\r]*/gi,
    replacement: (_match, header: string) => `${header}: ${REDACTED}`,
  },
  {
    pattern: /\bsession=[^;\s]+/gi,
    replacement: `session=${REDACTED}`,
  },
];

export function normalizeMemoryDrawerContent(content: string): string {
  return content.replace(/\r\n?/g, '\n');
}

export function hashMemoryDrawerContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function sanitizeMemoryDrawerContent(rawContent: string): SanitizeMemoryDrawerContentResult {
  let content = normalizeMemoryDrawerContent(rawContent);
  let redactionCount = 0;
  let quarantined = false;

  for (const rule of REDACTION_PATTERNS) {
    content = content.replace(rule.pattern, (...args: unknown[]) => {
      redactionCount += 1;
      quarantined = quarantined || Boolean(rule.quarantines);
      if (typeof rule.replacement === 'function') {
        const [match, ...captures] = args as [string, ...string[]];
        return rule.replacement(match, ...captures);
      }
      return rule.replacement;
    });
  }

  const redactionStatus: MemoryDrawerRedactionStatus = quarantined
    ? 'quarantined'
    : redactionCount > 0
      ? 'sanitized'
      : 'unreviewed';

  return {
    content,
    contentSha256: hashMemoryDrawerContent(content),
    redactionStatus,
    redactionCount,
  };
}
