import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyReply } from 'fastify';

const DEFAULT_TIMEOUT_MS = 30_000;
const PRIVATE_TAILSCALE_FIRST_OCTET = 100;
const PRIVATE_TAILSCALE_SECOND_OCTET_MIN = 64;
const PRIVATE_TAILSCALE_SECOND_OCTET_MAX = 127;

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

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((octet) => Number.isNaN(octet))) {
    return false;
  }

  if (octets[0] === 10) {
    return true;
  }

  if (octets[0] === 192 && octets[1] === 168) {
    return true;
  }

  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
    return true;
  }

  return (
    octets[0] === PRIVATE_TAILSCALE_FIRST_OCTET &&
    octets[1] >= PRIVATE_TAILSCALE_SECOND_OCTET_MIN &&
    octets[1] <= PRIVATE_TAILSCALE_SECOND_OCTET_MAX
  );
}

function isAllowedWorkerHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return true;
  }

  if (!hostname.includes('.') || hostname.endsWith('.local')) {
    return true;
  }

  if (hostname.endsWith('.ts.net')) {
    return true;
  }

  return isPrivateIpv4(hostname);
}

function validateWorkerBaseUrl(workerBaseUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(workerBaseUrl);
  } catch {
    throw new ControlPlaneError(
      'INVALID_WORKER_URL',
      'Worker URL must be a valid absolute http(s) URL',
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ControlPlaneError('INVALID_WORKER_URL', 'Worker URL must use http or https');
  }

  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new ControlPlaneError('INVALID_WORKER_URL', 'Worker URL must not include credentials');
  }

  if (parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new ControlPlaneError(
      'INVALID_WORKER_URL',
      'Worker URL must not include query parameters or fragments',
    );
  }

  if (!isAllowedWorkerHostname(parsed.hostname)) {
    throw new ControlPlaneError(
      'INVALID_WORKER_URL',
      `Worker URL points to a non-internal address (${parsed.hostname})`,
    );
  }

  return parsed;
}

export function buildWorkerRequestUrl(workerBaseUrl: string, path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new ControlPlaneError(
      'INVALID_WORKER_URL',
      'Worker path must be an absolute path on the worker origin',
    );
  }

  const baseUrl = validateWorkerBaseUrl(workerBaseUrl);
  const resolved = new URL(path, baseUrl);

  if (resolved.origin !== baseUrl.origin) {
    throw new ControlPlaneError(
      'INVALID_WORKER_URL',
      'Worker path must resolve on the worker origin',
    );
  }

  return resolved.toString();
}

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

  let url: string;
  try {
    url = buildWorkerRequestUrl(workerBaseUrl, path);
  } catch (err) {
    const error =
      err instanceof ControlPlaneError
        ? err
        : new ControlPlaneError('INVALID_WORKER_URL', 'Worker URL validation failed');
    return {
      ok: false,
      status: 400,
      error: error.code,
      message: error.message,
    };
  }

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

/**
 * Send a proxy worker result directly via Fastify reply.
 *
 * Replaces the repeated if/else pattern:
 *   if (!result.ok) return reply.status(result.status).send({ error, message });
 *   return reply.status(result.status).send(result.data);
 */
export function replyWithProxyResult(reply: FastifyReply, result: ProxyWorkerResult): FastifyReply {
  if (!result.ok) {
    return reply.status(result.status).send({ error: result.error, message: result.message });
  }
  return reply.status(result.status).send(result.data);
}
