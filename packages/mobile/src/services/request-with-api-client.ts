import type { ApiClient } from './api-client.js';
import { MobileClientError } from './api-client.js';

type ApiClientInternals = {
  baseUrl: string;
  authToken: string | undefined;
  timeoutMs: number;
};

export async function requestWithApiClient<T>(
  apiClient: ApiClient,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const client = apiClient as unknown as ApiClientInternals;
  const url = `${client.baseUrl}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  if (client.authToken) {
    headers.Authorization = `Bearer ${client.authToken}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), client.timeoutMs ?? 30_000);

  let response: Response;

  try {
    response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);

    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new MobileClientError('REQUEST_TIMEOUT', `Request to ${method} ${path} timed out`, {
        timeoutMs: client.timeoutMs,
      });
    }

    const message = err instanceof Error ? err.message : String(err);
    throw new MobileClientError('NETWORK_ERROR', `Network error: ${message}`, {
      method,
      path,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let errorBody: Record<string, unknown> | null = null;

    try {
      errorBody = (await response.json()) as Record<string, unknown>;
    } catch {
      // Response body isn't JSON — ignore.
    }

    const errorCode =
      typeof errorBody?.code === 'string' ? errorBody.code : `HTTP_${response.status}`;
    const errorMessage =
      typeof errorBody?.error === 'string'
        ? errorBody.error
        : typeof errorBody?.message === 'string'
          ? errorBody.message
          : `HTTP ${response.status} ${response.statusText}`;

    throw new MobileClientError(errorCode, errorMessage, {
      status: response.status,
      statusText: response.statusText,
      body: errorBody,
      method,
      path,
    });
  }

  return (await response.json()) as T;
}
