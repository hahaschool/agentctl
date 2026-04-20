export const MEMORY_REDACT_KEYS: ReadonlySet<string> = new Set([
  'api_key',
  'apikey',
  'password',
  'token',
  'authorization',
  'secret',
  'openai_api_key',
  'anthropic_api_key',
  'aws_secret_access_key',
  'bearer',
  'cookie',
  'x-api-key',
  'stripe_api_key',
  'slack_webhook_url',
]);

const REDACTED_VALUE = '[REDACTED]';

function redactValue(value: unknown, keys: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, keys));
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
      key,
      keys.has(key.toLowerCase()) ? REDACTED_VALUE : redactValue(nestedValue, keys),
    ]);
    return Object.fromEntries(entries);
  }

  return value;
}

export function redactKeys<T extends object>(
  obj: T,
  keys: ReadonlySet<string> = MEMORY_REDACT_KEYS,
): T {
  return redactValue(obj, keys) as T;
}
