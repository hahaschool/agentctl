import { execFile } from 'node:child_process';
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
    const { stdout } = await execFileAsync('tailscale', ['status', '--json'], {
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
