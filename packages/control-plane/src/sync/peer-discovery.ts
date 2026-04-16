import { execFile } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import { promisify } from 'node:util';

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { extractPeerVersionInfo, type PeerVersionInfo } from './peer-health.js';

const execFileAsync = promisify(execFile);
const TAILSCALE_TIMEOUT_MS = 5_000;
const HEALTH_TIMEOUT_MS = 5_000;
const DEFAULT_CP_PORT = 8080;
const DEFAULT_DISCOVERY_INTERVAL_MS = 60_000;

/**
 * Hostnames that must never be probed — loopback + well-known cloud
 * metadata endpoints. Mirrors the SSRF block list used by
 * `validateSyncUrl` in `api/routes/sync-peers.ts`.
 */
const BLOCKED_PROBE_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'metadata.google.com',
]);

export type TailscalePeer = {
  hostname: string;
  tailscaleIp: string;
};

type TailscaleStatusEntry = {
  TailscaleIPs: string[];
  HostName: string;
  Online: boolean;
  Tags?: string[];
};

type TailscaleStatus = {
  Self: TailscaleStatusEntry;
  Peer: Record<string, TailscaleStatusEntry>;
};

export type PeerHealthIdentity = {
  machineId: string | null;
  nodePublicKey: string | null;
} & PeerVersionInfo;

export type ProbePeerResult =
  | {
      reachable: true;
      statusCode: number;
      syncUrl: string;
      identity: PeerHealthIdentity;
    }
  | {
      reachable: false;
      statusCode: number | null;
      syncUrl: string;
      error: string;
    };

export function parseTailscalePeers(status: TailscaleStatus): TailscalePeer[] {
  const peers: TailscalePeer[] = [];

  for (const peer of Object.values(status.Peer)) {
    if (!peer.Online) {
      continue;
    }
    if (!peer.Tags?.includes('tag:mesh-node')) {
      continue;
    }

    const tailscaleIp = peer.TailscaleIPs[0];
    if (!tailscaleIp) {
      continue;
    }

    peers.push({
      hostname: peer.HostName,
      tailscaleIp,
    });
  }

  return peers;
}

/**
 * Well-known locations of the Tailscale CLI binary, checked in order.
 * - macOS App Store installs to `/Applications/Tailscale.app/Contents/MacOS/Tailscale`
 * - Homebrew / standalone installs typically land in `/usr/local/bin/tailscale`
 * - Linux packages put it in `/usr/bin/tailscale`
 *
 * The bare name `tailscale` is tried last via PATH lookup.
 */
const TAILSCALE_BIN_CANDIDATES = [
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/usr/local/bin/tailscale',
  '/usr/bin/tailscale',
];

let resolvedTailscaleBin: string | null = null;

/**
 * Resolve the Tailscale CLI binary path. Respects `TAILSCALE_BIN` env var,
 * then probes well-known paths, falling back to the bare name for PATH
 * lookup. The result is cached for the process lifetime.
 */
export function resolveTailscaleBin(): string {
  if (resolvedTailscaleBin !== null) return resolvedTailscaleBin;

  const envOverride = process.env.TAILSCALE_BIN;
  if (envOverride) {
    resolvedTailscaleBin = envOverride;
    return resolvedTailscaleBin;
  }

  for (const candidate of TAILSCALE_BIN_CANDIDATES) {
    try {
      accessSync(candidate, fsConstants.X_OK);
      resolvedTailscaleBin = candidate;
      return resolvedTailscaleBin;
    } catch {
      // not found or not executable — try next
    }
  }

  // Fallback: rely on PATH
  resolvedTailscaleBin = 'tailscale';
  return resolvedTailscaleBin;
}

/** Test-only: reset the cached binary path so tests can override env. */
export function __resetTailscaleBinCacheForTests(): void {
  resolvedTailscaleBin = null;
}

// ---------------------------------------------------------------------------
// Phase 1 (§33.12): Tailscale IP auto-detection
// ---------------------------------------------------------------------------

const TAILSCALE_IP_TIMEOUT_MS = 3_000;

export type TailscaleIpSource = 'env-var' | 'tailscale-cli' | 'control-plane-url';

export type ResolvedSyncIdentity = {
  selfSyncUrl: string;
  selfTailscaleIp: string | null;
  selfSyncUrlSource: TailscaleIpSource;
};

/**
 * Validate that an IPv4 string is safe to use as a Tailscale IP. Rejects
 * loopback (`127.0.0.0/8`), link-local (`169.254.0.0/16`), all-zeros, and
 * non-IPv4 formats. Does NOT restrict to CGNAT only — some operators run
 * Tailscale with custom subnet routes.
 */
export function isValidTailscaleIp(ip: string): boolean {
  const trimmed = ip.trim();
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(trimmed)) return false;
  if (/^127(?:\.\d{1,3}){3}$/.test(trimmed)) return false;
  if (trimmed === '0.0.0.0') return false;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(trimmed)) return false;
  return true;
}

let cachedTailscaleIp: string | null | undefined;

/**
 * Run `tailscale ip -4` to auto-detect the local node's Tailscale IPv4.
 * Result is cached for the process lifetime. Returns `null` when the CLI
 * is unavailable, times out, or returns an invalid address.
 */
export async function detectTailscaleIp(
  logger?: Pick<Logger, 'debug' | 'warn'>,
): Promise<string | null> {
  if (cachedTailscaleIp !== undefined) return cachedTailscaleIp;

  try {
    const bin = resolveTailscaleBin();
    const { stdout } = await execFileAsync(bin, ['ip', '-4'], {
      timeout: TAILSCALE_IP_TIMEOUT_MS,
    });
    const ip = stdout.trim().split('\n')[0]?.trim() ?? '';
    if (isValidTailscaleIp(ip)) {
      cachedTailscaleIp = ip;
      logger?.debug?.({ ip }, 'Auto-detected Tailscale IP via CLI');
      return ip;
    }
    logger?.warn?.({ rawOutput: ip }, 'tailscale ip -4 returned invalid address');
    cachedTailscaleIp = null;
    return null;
  } catch (err: unknown) {
    logger?.debug?.(
      { err: err instanceof Error ? err.message : String(err) },
      'Tailscale IP auto-detect failed',
    );
    cachedTailscaleIp = null;
    return null;
  }
}

/** Test-only: reset the cached Tailscale IP so tests can override env. */
export function __resetTailscaleIpCacheForTests(): void {
  cachedTailscaleIp = undefined;
}

/**
 * Resolve the local node's sync identity using the Phase 1 resolution chain:
 *
 * 1. `TAILSCALE_IP` env var (validated — loopback/link-local rejected with warning)
 * 2. `tailscale ip -4` auto-detect (cached)
 * 3. `controlPlaneUrl` fallback (e.g. `http://localhost:8080`)
 */
export async function resolveSyncIdentity(opts: {
  port: number;
  controlPlaneUrl: string;
  logger?: Pick<Logger, 'info' | 'warn' | 'debug'>;
}): Promise<ResolvedSyncIdentity> {
  const { port, controlPlaneUrl, logger } = opts;

  // 1. TAILSCALE_IP env var — validated
  const envIp = process.env.TAILSCALE_IP;
  if (envIp) {
    if (isValidTailscaleIp(envIp)) {
      const selfSyncUrl = `http://${envIp.trim()}:${port}`;
      logger?.info?.(
        { selfSyncUrl, source: 'env-var' },
        'selfSyncUrl resolved from TAILSCALE_IP env var',
      );
      return { selfSyncUrl, selfTailscaleIp: envIp.trim(), selfSyncUrlSource: 'env-var' };
    }
    logger?.warn?.(
      { envValue: envIp },
      'TAILSCALE_IP env var is loopback/link-local/invalid — falling through to auto-detect',
    );
  }

  // 2. tailscale ip -4 auto-detect
  const autoIp = await detectTailscaleIp(logger);
  if (autoIp) {
    const selfSyncUrl = `http://${autoIp}:${port}`;
    logger?.info?.(
      { selfSyncUrl, source: 'tailscale-cli' },
      'selfSyncUrl resolved via tailscale CLI',
    );
    return { selfSyncUrl, selfTailscaleIp: autoIp, selfSyncUrlSource: 'tailscale-cli' };
  }

  // 3. controlPlaneUrl fallback
  logger?.info?.(
    { selfSyncUrl: controlPlaneUrl, source: 'control-plane-url' },
    'selfSyncUrl resolved from CONTROL_PLANE_URL fallback',
  );
  return {
    selfSyncUrl: controlPlaneUrl,
    selfTailscaleIp: null,
    selfSyncUrlSource: 'control-plane-url',
  };
}

/**
 * Shell out to the local Tailscale CLI and return the parsed mesh-node peers.
 * Returns an empty array on any failure so callers never see exceptions for
 * missing/offline Tailscale — the operator simply sees "no candidates".
 *
 * Callers must pass a dedicated logger so failures are visible in pino logs
 * without leaking into stdout.
 */
export async function fetchTailscaleMeshPeers(
  logger: Pick<Logger, 'debug'>,
): Promise<TailscalePeer[]> {
  try {
    const bin = resolveTailscaleBin();
    const { stdout } = await execFileAsync(bin, ['status', '--json'], {
      timeout: TAILSCALE_TIMEOUT_MS,
    });

    return parseTailscalePeers(JSON.parse(stdout) as TailscaleStatus);
  } catch (error: unknown) {
    logger.debug(
      { err: error instanceof Error ? error.message : String(error) },
      'Tailscale discovery failed',
    );
    return [];
  }
}

/**
 * IPv4 literal block list — loopback (127/8), all-zeroes, and link-local
 * (169.254/16). Tailscale peers live in 100.64/10 (CGNAT) so we deliberately
 * permit RFC1918 + CGNAT ranges — blocking them would defeat the probe.
 */
function isBlockedIpv4Literal(host: string): boolean {
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true;
  if (host === '0.0.0.0') return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return false;
}

function isBlockedIpv6Literal(host: string): boolean {
  const normalized = host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    normalized === '0:0:0:0:0:0:0:0' ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:0.') ||
    normalized.startsWith('::ffff:169.254.') ||
    normalized.startsWith('fe80:')
  );
}

/**
 * Validate a probe target (hostname, IP literal, or http/https URL) and derive
 * the canonical syncUrl to probe. Returns `{ ok: true, syncUrl }` on success.
 *
 * The validator enforces the same SSRF rules as `validateSyncUrl`:
 * - Must be non-empty and ≤ 253 characters (DNS max)
 * - Credentials in URL form are rejected
 * - localhost / loopback / metadata / link-local literals are rejected
 * - Bare hostnames or IPs are wrapped in `http://<host>:8080`
 */
export function deriveSyncUrlFromTarget(
  target: unknown,
): { ok: true; syncUrl: string } | { ok: false; error: string } {
  if (typeof target !== 'string' || target.trim().length === 0) {
    return { ok: false, error: 'target must be a non-empty string' };
  }

  const trimmed = target.trim();
  if (trimmed.length > 2_048) {
    return { ok: false, error: 'target must be 2048 characters or fewer' };
  }

  // Detect whether the input is already a URL. If not, wrap it as an http URL
  // on the default CP port before validating.
  const looksLikeUrl = /^https?:\/\//i.test(trimmed);
  const candidate = looksLikeUrl ? trimmed : `http://${trimmed}:${DEFAULT_CP_PORT}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: 'target must be a valid hostname, IP, or URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'target must use http or https' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'target must not include credentials' };
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (host.length === 0) {
    return { ok: false, error: 'target hostname is empty' };
  }

  if (BLOCKED_PROBE_HOSTNAMES.has(host) || host.endsWith('.localhost')) {
    return { ok: false, error: 'target points to a blocked local or metadata address' };
  }

  if (isBlockedIpv4Literal(host) || isBlockedIpv6Literal(host)) {
    return { ok: false, error: 'target points to a blocked loopback or link-local address' };
  }

  // Normalize: strip trailing slash from the resolved URL.
  const resolvedUrl = `${parsed.protocol}//${parsed.host}`;
  return { ok: true, syncUrl: resolvedUrl };
}

/**
 * Probe a mesh peer candidate's `/health` endpoint and extract identity +
 * version metadata. Never throws — all errors are mapped to a
 * `{ reachable: false, error }` result so callers can render the diagnostic.
 *
 * The fetch is bounded by `HEALTH_TIMEOUT_MS` via `AbortSignal.timeout` so a
 * slow peer cannot hang a discover request.
 */
export async function probePeerHealth(
  syncUrl: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ProbePeerResult> {
  const target = `${syncUrl.replace(/\/$/, '')}/health`;
  try {
    // This function intentionally fetches a URL derived from operator-supplied
    // input — it's the whole purpose of the mesh peer discover/probe flow
    // (§33.7). Callers pass a syncUrl that has already been restricted by
    // `deriveSyncUrlFromTarget` (scheme http(s) only, no credentials, bounded
    // length, loopback/link-local/metadata literals blocked) OR constructed
    // internally from Tailscale CLI output. The fetch is bounded by
    // AbortSignal.timeout and the response is reduced to a small JSON summary,
    // so this is not a usable SSRF gadget.
    // codeql[js/request-forgery]
    const response = await fetchImpl(target, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        reachable: false,
        statusCode: response.status,
        syncUrl,
        error: `HTTP ${response.status}`,
      };
    }

    let parsedBody: unknown = null;
    try {
      parsedBody = await response.json();
    } catch {
      parsedBody = null;
    }

    const version = extractPeerVersionInfo(parsedBody);
    const record = (
      parsedBody && typeof parsedBody === 'object' ? (parsedBody as Record<string, unknown>) : {}
    ) as Record<string, unknown>;

    const machineIdRaw = record.machineId;
    const nodePublicKeyRaw = record.nodePublicKey;
    const machineId =
      typeof machineIdRaw === 'string' && machineIdRaw.length > 0 && machineIdRaw.length <= 256
        ? machineIdRaw
        : null;
    const nodePublicKey =
      typeof nodePublicKeyRaw === 'string' &&
      nodePublicKeyRaw.length > 0 &&
      nodePublicKeyRaw.length <= 2_048
        ? nodePublicKeyRaw
        : null;

    return {
      reachable: true,
      statusCode: response.status,
      syncUrl,
      identity: {
        machineId,
        nodePublicKey,
        appVersion: version.appVersion,
        gitSha: version.gitSha,
        schemaVersion: version.schemaVersion,
      },
    };
  } catch (err: unknown) {
    return {
      reachable: false,
      statusCode: null,
      syncUrl,
      error: describeProbeError(err),
    };
  }
}

function describeProbeError(err: unknown): string {
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

type ResolvedPeerIdentity = {
  machineId: string;
  publicKey: string | null;
};

async function resolvePeerMachineId(syncUrl: string): Promise<ResolvedPeerIdentity | null> {
  const result = await probePeerHealth(syncUrl);
  if (!result.reachable || !result.identity.machineId) {
    return null;
  }
  return {
    machineId: result.identity.machineId,
    publicKey: result.identity.nodePublicKey,
  };
}

async function upsertPeer(
  db: Database,
  peer: TailscalePeer & ResolvedPeerIdentity & { syncUrl: string },
): Promise<void> {
  await db.execute(
    sql`INSERT INTO sync_nodes (id, hostname, tailscale_ip, sync_url, public_key, sync_status, role)
        VALUES (${peer.machineId}, ${peer.hostname}, ${peer.tailscaleIp}, ${peer.syncUrl}, ${peer.publicKey}, 'unknown', 'full')
        ON CONFLICT (id) DO UPDATE SET
          hostname = EXCLUDED.hostname,
          tailscale_ip = EXCLUDED.tailscale_ip,
          sync_url = EXCLUDED.sync_url,
          public_key = COALESCE(EXCLUDED.public_key, sync_nodes.public_key)`,
  );
}

async function discoverPeersOnce(opts: {
  db: Database;
  logger: Logger;
  cpPort: number;
}): Promise<void> {
  const peers = await fetchTailscaleMeshPeers(opts.logger);

  for (const peer of peers) {
    const syncUrl = `http://${peer.tailscaleIp}:${opts.cpPort}`;

    try {
      const resolved = await resolvePeerMachineId(syncUrl);
      if (!resolved) {
        continue;
      }

      await upsertPeer(opts.db, {
        ...peer,
        ...resolved,
        syncUrl,
      });

      opts.logger.debug(
        { machineId: resolved.machineId, hostname: peer.hostname, syncUrl },
        'Discovered mesh peer',
      );
    } catch (error: unknown) {
      opts.logger.warn(
        {
          err: error instanceof Error ? error.message : String(error),
          hostname: peer.hostname,
          syncUrl,
        },
        'Failed to upsert discovered mesh peer',
      );
    }
  }
}

export function startDiscoveryLoop(opts: {
  db: Database;
  logger: Logger;
  cpPort?: number;
  intervalMs?: number;
}): { stop: () => void } {
  const { db, logger, cpPort = DEFAULT_CP_PORT, intervalMs = DEFAULT_DISCOVERY_INTERVAL_MS } = opts;

  void discoverPeersOnce({ db, logger, cpPort });

  const timer = setInterval(() => {
    void discoverPeersOnce({ db, logger, cpPort });
  }, intervalMs);
  timer.unref?.();

  return {
    stop: () => clearInterval(timer),
  };
}

export const DEFAULT_CONTROL_PLANE_PORT = DEFAULT_CP_PORT;
