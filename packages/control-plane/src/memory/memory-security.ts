import { ControlPlaneError } from '@agentctl/shared';

export type MemoryEntry = {
  agentId: string;
  content: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
};

export type MemorySecurityConfig = {
  maxContentLength: number;
  maxTagCount: number;
  maxTagLength: number;
  maxMetadataKeys: number;
  maxMetadataValueLength: number;
  blockedPatterns: RegExp[];
  sensitivePatterns: RegExp[];
  allowedAgentIds?: string[];
};

export type SanitizeResult = {
  sanitized: MemoryEntry;
  warnings: string[];
  blocked: boolean;
  blockReason?: string;
};

export type MemorySecurity = {
  validate(entry: MemoryEntry): SanitizeResult;
  sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown>;
  createIsolatedNamespace(agentId: string): string;
  validateNamespaceAccess(agentId: string, key: string): boolean;
};

const DEFAULT_BLOCKED_PATTERNS: RegExp[] = [
  /(?:sk-|api[_-]?key|bearer\s+)[a-zA-Z0-9_-]{20,}/gi,
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
  /(?:postgres|mysql|redis):\/\/[^:]+:[^@]+@/gi,
];

const DEFAULT_SENSITIVE_PATTERNS: RegExp[] = [
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  /\b(?!100\.(?:6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.)(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
];

const DEFAULT_CONFIG: MemorySecurityConfig = {
  maxContentLength: 50_000,
  maxTagCount: 20,
  maxTagLength: 100,
  maxMetadataKeys: 50,
  maxMetadataValueLength: 5_000,
  blockedPatterns: DEFAULT_BLOCKED_PATTERNS,
  sensitivePatterns: DEFAULT_SENSITIVE_PATTERNS,
};

function cloneRegExp(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags);
}

function deepClone<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as T;
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    result[key] = deepClone((value as Record<string, unknown>)[key]);
  }
  return result as T;
}

function stringifyValue(value: unknown, maxLength: number): string {
  if (typeof value === 'string') {
    return value.length > maxLength ? value.slice(0, maxLength) : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null || value === undefined) {
    return '';
  }
  const json = JSON.stringify(value);
  return json.length > maxLength ? json.slice(0, maxLength) : json;
}

export function createMemorySecurity(config?: Partial<MemorySecurityConfig>): MemorySecurity {
  const resolved: MemorySecurityConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    const cloned = deepClone(metadata);
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(cloned)) {
      if (typeof value === 'function') {
        continue;
      }

      if (typeof value === 'string') {
        result[key] =
          value.length > resolved.maxMetadataValueLength
            ? value.slice(0, resolved.maxMetadataValueLength)
            : value;
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const nested = stringifyValue(value, resolved.maxMetadataValueLength);
        result[key] = nested;
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  function validate(entry: MemoryEntry): SanitizeResult {
    const warnings: string[] = [];

    // 1. Check agentId is non-empty
    if (!entry.agentId || entry.agentId.trim().length === 0) {
      return {
        sanitized: entry,
        warnings: [],
        blocked: true,
        blockReason: 'agentId is required and must be non-empty',
      };
    }

    // 7. Check allowedAgentIds (check early to fail fast)
    if (resolved.allowedAgentIds && !resolved.allowedAgentIds.includes(entry.agentId)) {
      return {
        sanitized: entry,
        warnings: [],
        blocked: true,
        blockReason: `Agent '${entry.agentId}' is not in the allowed agents list`,
      };
    }

    // 2. Check content length
    if (entry.content.length > resolved.maxContentLength) {
      return {
        sanitized: entry,
        warnings: [],
        blocked: true,
        blockReason: `Content length ${entry.content.length} exceeds maximum ${resolved.maxContentLength}`,
      };
    }

    // 3. Check tags
    let sanitizedTags = entry.tags ? [...entry.tags] : undefined;
    if (sanitizedTags) {
      if (sanitizedTags.length > resolved.maxTagCount) {
        warnings.push(
          `Tag count ${sanitizedTags.length} exceeds maximum ${resolved.maxTagCount}; truncating`,
        );
        sanitizedTags = sanitizedTags.slice(0, resolved.maxTagCount);
      }
      sanitizedTags = sanitizedTags.map((tag) => {
        if (tag.length > resolved.maxTagLength) {
          warnings.push(
            `Tag '${tag.slice(0, 20)}...' exceeds maximum length ${resolved.maxTagLength}; truncating`,
          );
          return tag.slice(0, resolved.maxTagLength);
        }
        return tag;
      });
    }

    // 4. Check metadata
    let sanitizedMetadata = entry.metadata ? deepClone(entry.metadata) : undefined;
    if (sanitizedMetadata) {
      const keys = Object.keys(sanitizedMetadata);
      if (keys.length > resolved.maxMetadataKeys) {
        warnings.push(
          `Metadata has ${keys.length} keys, exceeds maximum ${resolved.maxMetadataKeys}; truncating`,
        );
        const allowedKeys = keys.slice(0, resolved.maxMetadataKeys);
        const truncated: Record<string, unknown> = {};
        for (const key of allowedKeys) {
          truncated[key] = sanitizedMetadata[key];
        }
        sanitizedMetadata = truncated;
      }

      // Check and truncate metadata value lengths
      for (const [key, value] of Object.entries(sanitizedMetadata)) {
        if (typeof value === 'string' && value.length > resolved.maxMetadataValueLength) {
          warnings.push(
            `Metadata key '${key}' value length exceeds maximum ${resolved.maxMetadataValueLength}; truncating`,
          );
          sanitizedMetadata[key] = value.slice(0, resolved.maxMetadataValueLength);
        }
      }

      sanitizedMetadata = sanitizeMetadata(sanitizedMetadata);
    }

    // 5. Check content against blockedPatterns
    const contentToCheck = entry.content;
    for (const pattern of resolved.blockedPatterns) {
      const freshPattern = cloneRegExp(pattern);
      if (freshPattern.test(contentToCheck)) {
        return {
          sanitized: entry,
          warnings: [],
          blocked: true,
          blockReason: `Content matches blocked pattern: ${pattern.source}`,
        };
      }
    }

    // 6. Redact sensitivePatterns from content
    let sanitizedContent = contentToCheck;
    for (const pattern of resolved.sensitivePatterns) {
      const freshPattern = cloneRegExp(pattern);
      if (freshPattern.test(sanitizedContent)) {
        const redactPattern = cloneRegExp(pattern);
        const before = sanitizedContent;
        sanitizedContent = sanitizedContent.replace(redactPattern, '[REDACTED]');
        if (before !== sanitizedContent) {
          warnings.push(`Content contained sensitive data matching /${pattern.source}/ — redacted`);
        }
      }
    }

    return {
      sanitized: {
        agentId: entry.agentId,
        content: sanitizedContent,
        metadata: sanitizedMetadata,
        tags: sanitizedTags,
      },
      warnings,
      blocked: false,
    };
  }

  function createIsolatedNamespace(agentId: string): string {
    if (!agentId || agentId.trim().length === 0) {
      throw new ControlPlaneError(
        'MEMORY_INVALID_AGENT_ID',
        'agentId is required to create a namespace',
        { agentId },
      );
    }
    return `agent:${agentId}:`;
  }

  function validateNamespaceAccess(agentId: string, key: string): boolean {
    const prefix = `agent:${agentId}:`;
    return key.startsWith(prefix);
  }

  return {
    validate,
    sanitizeMetadata,
    createIsolatedNamespace,
    validateNamespaceAccess,
  };
}
