const DEFAULT_TIMEOUT_MS = 30_000;

export type ProxyWorkerSuccess = {
  ok: true;
  status: number;
  data: unknown;
};

export type ProxyWorkerFailure = {
  ok: false;
  status: number;
  error: string;
  message: string;
};

export type ProxyWorkerResult = ProxyWorkerSuccess | ProxyWorkerFailure;

export type ProxyWorkerRequestOptions = {
  workerBaseUrl: string;
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
};

/**
 * Proxy an HTTP request to an agent worker and return a discriminated result.
 *
 * Handles connection errors uniformly by returning a `WORKER_UNREACHABLE` failure
 * with HTTP 502 status, so callers don't need to duplicate error-handling logic.
 */
export async function proxyWorkerRequest(
  opts: ProxyWorkerRequestOptions,
): Promise<ProxyWorkerResult> {
  const { workerBaseUrl, path, method, body, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;

  const url = `${workerBaseUrl}${path}`;

  const fetchOptions: RequestInit = {
    method,
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'Content-Type': 'application/json' },
  };

  if (body !== undefined && method !== 'GET' && method !== 'DELETE') {
    fetchOptions.body = JSON.stringify(body);
  }

  let response: Response;

  try {
    response = await fetch(url, fetchOptions);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 502,
      error: 'WORKER_UNREACHABLE',
      message: `Failed to connect to worker at ${workerBaseUrl}: ${message}`,
    };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: 'WORKER_ERROR',
        message:
          response.statusText ||
          `Worker returned non-JSON response with HTTP ${String(response.status)}`,
      };
    }
    return {
      ok: false,
      status: 502,
      error: 'INVALID_RESPONSE',
      message: `Worker returned non-JSON response with HTTP ${String(response.status)}`,
    };
  }

  if (!response.ok) {
    const errBody = data as Record<string, unknown> | null;
    return {
      ok: false,
      status: response.status,
      error: typeof errBody?.error === 'string' ? errBody.error : 'WORKER_ERROR',
      message: typeof errBody?.message === 'string' ? errBody.message : response.statusText,
    };
  }

  return { ok: true, status: response.status, data };
}
