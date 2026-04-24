// packages/shared/src/memory/ops-audit.ts

export type MemoryOpsAuditAction =
  | 'provider.create'
  | 'provider.update'
  | 'provider.delete'
  | 'provider.rotate-key'
  | 'provider.test-ephemeral'
  | 'provider.test-succeeded'
  | 'provider.test-failed'
  | 'job.create'
  | 'job.cancel'
  | 'job.complete'
  | 'job.fail';

const SENSITIVE_KEY_PATTERN = /key|token|secret|password|credential/i;

/** Recursively remove sensitive keys from a context object. Max 64KB. */
export function redactSensitiveKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(obj);
  if (json.length > 65_536) {
    return { _truncated: true, _originalSize: json.length };
  }
  return redactDeep(obj) as Record<string, unknown>;
}

function redactDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactDeep);
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    result[k] = SENSITIVE_KEY_PATTERN.test(k) ? '[REDACTED]' : redactDeep(v);
  }
  return result;
}
