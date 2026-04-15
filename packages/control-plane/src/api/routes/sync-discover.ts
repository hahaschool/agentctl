// ---------------------------------------------------------------------------
// Mesh peer discovery + URL probe routes — roadmap §33.7.
//
// `GET  /api/sync/discover` — return candidate Tailscale peers the operator
//   could add. Shells out to `TAILSCALE_STATUS_CMD` when set; otherwise the
//   endpoint returns an empty list with `source: "none"` (the CI default).
//   Zero database writes — the route is strictly read-only.
//
// `POST /api/sync/probe`   — fire a 2s-timeout GET to `<syncUrl>/health` and
//   report reachability + a small slice of version metadata. Used by the web
//   add-peer dialog to validate a URL before persisting it. Does not touch
//   the database.
//
// Both routes are IP-rate-limited via `@fastify/rate-limit` (10/min discover,
// 20/min probe) so the endpoints cannot be used as scanning proxies.
// ---------------------------------------------------------------------------

import { execFile } from 'node:child_process';

import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';

import { extractPeerVersionInfo } from '../../sync/peer-health.js';
import { readRateLimitEnv } from '../rate-limit.js';

const DISCOVER_RATE_LIMIT = { max: 10, timeWindow: 60_000 } as const;
const PROBE_RATE_LIMIT = { max: 20, timeWindow: 60_000 } as const;

const TAILSCALE_CMD_TIMEOUT_MS = 3_000;
const TAILSCALE_OUTPUT_MAX_BYTES = 256 * 1024;

const PROBE_TIMEOUT_MS = 2_000;
const MAX_PROBE_URL_LENGTH = 2_048;

const BLOCKED_PROBE_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'metadata.google.com',
]);

/**
 * Reject IP literals that either loop back to the control-plane host or point
 * at well-known cloud metadata services. Tailscale peers live in 100.64.0.0/10
 * (CGNAT) so we deliberately do NOT block the full RFC1918 space — doing so
 * would break the primary use case of probing a peer's LAN-routed sync URL.
 */
function isBlockedIpLiteral(host: string): boolean {
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true;
  if (host === '0.0.0.0') return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  const v6 = host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (v6 === '::1' || v6 === '::' || v6 === '0:0:0:0:0:0:0:1' || v6 === '0:0:0:0:0:0:0:0') {
    return true;
  }
  return false;
}

/**
 * Shape of a candidate Tailscale peer surfaced to the operator. The
 * `candidateSyncUrl` is a *guess* at the peer's control-plane URL assembled
 * from its Tailscale IP + the AgentCTL default port (8080); the operator can
 * override it before saving.
 */
export type DiscoverCandidate = {
  hostname: string;
  tailscaleIp: string;
  candidateSyncUrl: string;
};

export type DiscoverResponse = {
  peers: DiscoverCandidate[];
  source: 'tailscale' | 'none';
  message?: string;
};

export type ProbeResponse = {
  reachable: boolean;
  statusCode?: number;
  appVersion?: string;
  schemaVersion?: number;
  error?: string;
};

export type SyncDiscoverRoutesOptions = {
  /**
   * Injectable fetch for tests. Defaults to `globalThis.fetch`.
   */
  fetchImpl?: typeof fetch;
  /**
   * Injectable Tailscale-status runner for tests. When omitted the real
   * implementation is used — which reads `TAILSCALE_STATUS_CMD` from env and
   * shells out via `execFile` with a short timeout.
   */
  runTailscaleStatus?: () => Promise<string | null>;
  /** Optional logger for diagnostics. */
  logger?: Pick<Logger, 'warn' | 'debug'>;
};

type TailscalePeerEntry = {
  HostName?: unknown;
  TailscaleIPs?: unknown;
};

type TailscaleStatus = {
  Peer?: unknown;
};

type ProbeBody = {
  syncUrl?: unknown;
};

function getRateLimitKey(request: {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}): string {
  return (
    request.ip ??
    (typeof request.headers['x-forwarded-for'] === 'string'
      ? request.headers['x-forwarded-for']
      : 'unknown')
  );
}

/**
 * Parse the `tailscale status --json` output into a list of discovery
 * candidates. Accepts only well-typed values so malformed output never leaks
 * into the response.
 */
export function parseTailscaleStatus(raw: string): DiscoverCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== 'object') {
    return [];
  }

  const peerMap = (parsed as TailscaleStatus).Peer;
  if (!peerMap || typeof peerMap !== 'object') {
    return [];
  }

  const candidates: DiscoverCandidate[] = [];
  for (const entry of Object.values(peerMap as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue;
    const peer = entry as TailscalePeerEntry;
    const hostnameRaw = peer.HostName;
    const ipsRaw = peer.TailscaleIPs;
    if (typeof hostnameRaw !== 'string' || hostnameRaw.length === 0) continue;
    if (!Array.isArray(ipsRaw)) continue;

    const ipv4 = ipsRaw.find(
      (ip): ip is string => typeof ip === 'string' && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip),
    );
    if (!ipv4) continue;

    candidates.push({
      hostname: hostnameRaw,
      tailscaleIp: ipv4,
      candidateSyncUrl: `http://${ipv4}:8080`,
    });
  }

  return candidates;
}

async function defaultRunTailscaleStatus(): Promise<string | null> {
  const cmd = process.env.TAILSCALE_STATUS_CMD;
  if (!cmd || cmd.trim().length === 0) {
    return null;
  }

  // Split on whitespace — we do NOT invoke a shell. The env var must contain
  // an absolute path + flags (e.g. `/usr/bin/tailscale status --json`).
  const parts = cmd.trim().split(/\s+/);
  const [binary, ...args] = parts;
  if (!binary) return null;

  return new Promise<string | null>((resolve) => {
    try {
      execFile(
        binary,
        args,
        {
          timeout: TAILSCALE_CMD_TIMEOUT_MS,
          maxBuffer: TAILSCALE_OUTPUT_MAX_BYTES,
        },
        (err, stdout) => {
          if (err) {
            resolve(null);
            return;
          }
          resolve(stdout);
        },
      );
    } catch {
      resolve(null);
    }
  });
}

/**
 * Validate the probe syncUrl. Rejects non-http(s) schemes, credentials,
 * localhost/metadata hostnames, and overly long inputs so the probe can't be
 * used as an internal-network scanner.
 */
function validateProbeUrl(
  value: unknown,
): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, error: 'syncUrl must be a non-empty string' };
  }

  const trimmed = value.trim();
  if (trimmed.length > MAX_PROBE_URL_LENGTH) {
    return { ok: false, error: `syncUrl must be ${MAX_PROBE_URL_LENGTH} characters or fewer` };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'syncUrl must be a valid URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'syncUrl must use http or https' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'syncUrl must not include credentials' };
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_PROBE_HOSTNAMES.has(host) || host.endsWith('.localhost')) {
    return { ok: false, error: 'syncUrl points to a blocked local or metadata address' };
  }

  if (isBlockedIpLiteral(host)) {
    return { ok: false, error: 'syncUrl points to a blocked local or metadata address' };
  }

  return { ok: true, url: trimmed };
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'AbortError' || /timeout/i.test(err.message)) {
      return 'timeout';
    }
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ECONNREFUSED') return 'connect_refused';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
    return err.message.slice(0, 200);
  }
  return String(err).slice(0, 200);
}

export const syncDiscoverRoutes: FastifyPluginAsync<SyncDiscoverRoutesOptions> = async (
  app,
  opts,
) => {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const runTailscaleStatus = opts.runTailscaleStatus ?? defaultRunTailscaleStatus;

  const discoverRateLimitConfig = {
    max: readRateLimitEnv('SYNC_DISCOVER_RATE_LIMIT_MAX', DISCOVER_RATE_LIMIT.max),
    timeWindow: readRateLimitEnv(
      'SYNC_DISCOVER_RATE_LIMIT_WINDOW_MS',
      DISCOVER_RATE_LIMIT.timeWindow,
    ),
    keyGenerator: getRateLimitKey,
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'RATE_LIMITED',
      message: 'Too many discover requests',
    }),
  } as const;

  const probeRateLimitConfig = {
    max: readRateLimitEnv('SYNC_PROBE_RATE_LIMIT_MAX', PROBE_RATE_LIMIT.max),
    timeWindow: readRateLimitEnv('SYNC_PROBE_RATE_LIMIT_WINDOW_MS', PROBE_RATE_LIMIT.timeWindow),
    keyGenerator: getRateLimitKey,
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'RATE_LIMITED',
      message: 'Too many probe requests',
    }),
  } as const;

  await app.register(rateLimit, {
    global: false,
    keyGenerator: getRateLimitKey,
    errorResponseBuilder: discoverRateLimitConfig.errorResponseBuilder,
  });

  app.get(
    '/discover',
    {
      config: { rateLimit: discoverRateLimitConfig },
      schema: {
        tags: ['sync'],
        summary: 'List Tailscale mesh peer candidates',
      },
      preHandler: [app.rateLimit(discoverRateLimitConfig)],
    },
    // @fastify/rate-limit runs before the handler. CodeQL only models the
    // legacy fastify-rate-limit plugin for this rule.
    // codeql[js/missing-rate-limiting]
    async (_request: FastifyRequest, reply: FastifyReply) => {
      let output: string | null;
      try {
        output = await runTailscaleStatus();
      } catch (err) {
        opts.logger?.warn?.({ err }, 'Tailscale status command threw');
        output = null;
      }

      if (!output) {
        const body: DiscoverResponse = {
          peers: [],
          source: 'none',
          message: 'Tailscale CLI not detected',
        };
        return reply.code(200).send(body);
      }

      const peers = parseTailscaleStatus(output);
      const body: DiscoverResponse = { peers, source: 'tailscale' };
      return reply.code(200).send(body);
    },
  );

  app.post<{ Body: ProbeBody }>(
    '/probe',
    {
      config: { rateLimit: probeRateLimitConfig },
      schema: {
        tags: ['sync'],
        summary: 'Probe a candidate mesh peer /health endpoint',
      },
      preHandler: [app.rateLimit(probeRateLimitConfig)],
    },
    // codeql[js/missing-rate-limiting]
    async (request, reply) => {
      const validation = validateProbeUrl(request.body?.syncUrl);
      if (!validation.ok) {
        return reply.code(400).send({ error: 'INVALID_SYNC_URL', message: validation.error });
      }

      const target = `${validation.url.replace(/\/$/, '')}/health`;
      try {
        // The probe endpoint intentionally fetches a URL supplied by the
        // (authenticated) operator — that's the whole purpose of this route.
        // `validateProbeUrl` above restricts the scheme, strips credentials,
        // bounds the length, and blocks loopback/link-local/metadata literals.
        // The request is also IP-rate-limited (20/min) and the response is
        // reduced to a small JSON summary, so this is not a usable SSRF gadget.
        // codeql[js/request-forgery]
        const response = await fetchImpl(target, {
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });

        if (!response.ok) {
          const body: ProbeResponse = {
            reachable: false,
            statusCode: response.status,
            error: `HTTP ${response.status}`,
          };
          return reply.code(200).send(body);
        }

        let parsedBody: unknown = null;
        try {
          parsedBody = await response.json();
        } catch {
          parsedBody = null;
        }

        const version = extractPeerVersionInfo(parsedBody);
        const body: ProbeResponse = {
          reachable: true,
          statusCode: response.status,
          appVersion: version.appVersion ?? undefined,
          schemaVersion: version.schemaVersion ?? undefined,
        };
        return reply.code(200).send(body);
      } catch (err) {
        opts.logger?.debug?.({ err, target }, 'Peer probe failed');
        const body: ProbeResponse = {
          reachable: false,
          error: describeError(err),
        };
        return reply.code(200).send(body);
      }
    },
  );
};
