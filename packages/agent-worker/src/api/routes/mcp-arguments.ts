type ExtractedMcpArguments<T> =
  | { ok: true; body: T }
  | {
      ok: false;
      error: {
        error: 'INVALID_ARGUMENTS';
        message: string;
      };
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function extractMcpArguments<T>(body: unknown): ExtractedMcpArguments<T> {
  const requestBody = isRecord(body) ? body : {};

  if (!Object.hasOwn(requestBody, 'arguments')) {
    return { ok: true, body: requestBody as T };
  }

  const args = requestBody.arguments;
  if (!isRecord(args)) {
    return {
      ok: false,
      error: {
        error: 'INVALID_ARGUMENTS',
        message: 'arguments must be a non-null object when provided',
      },
    };
  }

  return { ok: true, body: args as T };
}
