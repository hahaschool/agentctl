import { WorkerError } from '@agentctl/shared';

// ── Types ───────────────────────────────────────────────────────────

type NetworkPolicy = {
  mode: 'none' | 'allowlist' | 'unrestricted';
  allowedDomains: string[];
  allowedPorts: number[];
  blockedDomains: string[];
  maxRequestsPerMinute: number;
  maxBandwidthBytesPerMinute: number;
  logAllRequests: boolean;
};

type NetworkRequest = {
  url: string;
  method: string;
  agentId: string;
  timestamp: Date;
};

type NetworkDecision = {
  allowed: boolean;
  reason: string;
  domain: string;
  port: number;
  policyMode: string;
};

type NetworkPolicyStats = {
  totalRequests: number;
  allowedRequests: number;
  blockedRequests: number;
  rateLimitedRequests: number;
  topDomains: { domain: string; count: number }[];
  topBlockedDomains: { domain: string; count: number }[];
};

export type { NetworkDecision, NetworkPolicy, NetworkPolicyStats, NetworkRequest };

// ── Constants ───────────────────────────────────────────────────────

const DEFAULT_BLOCKED_DOMAINS: readonly string[] = [
  'metadata.google.internal',
  '169.254.169.254',
  'metadata.google.com',
  '*.internal',
];

const DEFAULT_POLICY: NetworkPolicy = {
  mode: 'none',
  allowedDomains: [],
  allowedPorts: [],
  blockedDomains: [...DEFAULT_BLOCKED_DOMAINS],
  maxRequestsPerMinute: 60,
  maxBandwidthBytesPerMinute: 50 * 1024 * 1024, // 50 MB
  logAllRequests: false,
};

const RATE_LIMIT_WINDOW_MS = 60_000;

// ── Internal tracking types ─────────────────────────────────────────

type RequestRecord = {
  timestamp: number;
  domain: string;
  allowed: boolean;
};

// ── Enforcer interface ──────────────────────────────────────────────

type NetworkPolicyEnforcer = {
  evaluate: (request: NetworkRequest) => NetworkDecision;
  matchesDomain: (domain: string, pattern: string) => boolean;
  getStats: () => NetworkPolicyStats;
  resetStats: () => void;
  generateDockerNetworkArgs: (policy: NetworkPolicy) => string[];
};

export type { NetworkPolicyEnforcer };

// ── URL parsing helper ──────────────────────────────────────────────

type ParsedUrl = {
  domain: string;
  port: number;
};

function parseRequestUrl(url: string): ParsedUrl {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname;
    let port: number;

    if (parsed.port) {
      port = Number.parseInt(parsed.port, 10);
    } else if (parsed.protocol === 'https:') {
      port = 443;
    } else if (parsed.protocol === 'http:') {
      port = 80;
    } else {
      port = 0;
    }

    return { domain, port };
  } catch {
    throw new WorkerError('INVALID_URL', `Failed to parse URL: ${url}`, {
      url,
    });
  }
}

// ── Domain matching ─────────────────────────────────────────────────

function matchesDomain(domain: string, pattern: string): boolean {
  const normalizedDomain = domain.toLowerCase();
  const normalizedPattern = pattern.toLowerCase();

  // Exact match
  if (normalizedDomain === normalizedPattern) {
    return true;
  }

  // Double wildcard: **.example.com matches example.com AND sub.example.com
  if (normalizedPattern.startsWith('**.')) {
    const baseDomain = normalizedPattern.slice(3);

    // Exact match with base domain
    if (normalizedDomain === baseDomain) {
      return true;
    }

    // Subdomain match
    if (normalizedDomain.endsWith(`.${baseDomain}`)) {
      return true;
    }

    return false;
  }

  // Single wildcard: *.example.com matches sub.example.com but NOT example.com
  if (normalizedPattern.startsWith('*.')) {
    const baseDomain = normalizedPattern.slice(2);

    // Must end with the base domain and have exactly one additional level
    if (normalizedDomain.endsWith(baseDomain)) {
      const prefix = normalizedDomain.slice(0, normalizedDomain.length - baseDomain.length);
      // prefix should be "something." — non-empty and no additional dots
      if (prefix.length > 0 && !prefix.slice(0, -1).includes('.')) {
        return true;
      }
    }

    return false;
  }

  return false;
}

// ── Factory ─────────────────────────────────────────────────────────

function createNetworkPolicy(policy?: Partial<NetworkPolicy>): NetworkPolicyEnforcer {
  const resolvedPolicy: NetworkPolicy = {
    ...DEFAULT_POLICY,
    ...policy,
    blockedDomains: [...DEFAULT_BLOCKED_DOMAINS, ...(policy?.blockedDomains ?? [])],
  };

  // Per-agent request tracking for rate limiting
  const agentRequests = new Map<string, RequestRecord[]>();

  // Global stats
  let allRequests: RequestRecord[] = [];

  function getAgentRecordsInWindow(agentId: string, now: number): RequestRecord[] {
    const records = agentRequests.get(agentId) ?? [];
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    return records.filter((r) => r.timestamp >= windowStart);
  }

  function pruneAgentRecords(agentId: string, now: number): void {
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    const records = agentRequests.get(agentId);
    if (records) {
      const pruned = records.filter((r) => r.timestamp >= windowStart);
      agentRequests.set(agentId, pruned);
    }
  }

  function recordRequest(
    agentId: string,
    domain: string,
    allowed: boolean,
    timestamp: number,
  ): void {
    const record: RequestRecord = { timestamp, domain, allowed };

    const records = agentRequests.get(agentId) ?? [];
    records.push(record);
    agentRequests.set(agentId, records);

    allRequests.push(record);
  }

  function isBlockedDomain(domain: string): boolean {
    for (const blocked of resolvedPolicy.blockedDomains) {
      if (matchesDomain(domain, blocked)) {
        return true;
      }
    }
    return false;
  }

  function isAllowedDomain(domain: string): boolean {
    for (const allowed of resolvedPolicy.allowedDomains) {
      if (matchesDomain(domain, allowed)) {
        return true;
      }
    }
    return false;
  }

  function isAllowedPort(port: number): boolean {
    if (resolvedPolicy.allowedPorts.length === 0) {
      return true;
    }
    return resolvedPolicy.allowedPorts.includes(port);
  }

  function evaluate(request: NetworkRequest): NetworkDecision {
    const { mode } = resolvedPolicy;
    const now = request.timestamp.getTime();

    // Parse URL — if invalid, block immediately
    let domain: string;
    let port: number;

    try {
      const parsed = parseRequestUrl(request.url);
      domain = parsed.domain;
      port = parsed.port;
    } catch {
      recordRequest(request.agentId, '', false, now);
      return {
        allowed: false,
        reason: 'Malformed URL',
        domain: '',
        port: 0,
        policyMode: mode,
      };
    }

    // Mode: none — block everything
    if (mode === 'none') {
      recordRequest(request.agentId, domain, false, now);
      return {
        allowed: false,
        reason: 'Network access disabled',
        domain,
        port,
        policyMode: mode,
      };
    }

    // Always check blocked domains first (overrides everything)
    if (isBlockedDomain(domain)) {
      recordRequest(request.agentId, domain, false, now);
      return {
        allowed: false,
        reason: `Domain '${domain}' is blocked`,
        domain,
        port,
        policyMode: mode,
      };
    }

    // Mode: allowlist — check domain and port
    if (mode === 'allowlist') {
      if (!isAllowedDomain(domain)) {
        recordRequest(request.agentId, domain, false, now);
        return {
          allowed: false,
          reason: `Domain '${domain}' is not in allowlist`,
          domain,
          port,
          policyMode: mode,
        };
      }

      if (!isAllowedPort(port)) {
        recordRequest(request.agentId, domain, false, now);
        return {
          allowed: false,
          reason: `Port ${port} is not allowed`,
          domain,
          port,
          policyMode: mode,
        };
      }
    }

    // Rate limiting (applies to allowlist and unrestricted modes)
    pruneAgentRecords(request.agentId, now);
    const recentRecords = getAgentRecordsInWindow(request.agentId, now);

    if (recentRecords.length >= resolvedPolicy.maxRequestsPerMinute) {
      recordRequest(request.agentId, domain, false, now);
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${resolvedPolicy.maxRequestsPerMinute} requests per minute`,
        domain,
        port,
        policyMode: mode,
      };
    }

    // Allowed
    recordRequest(request.agentId, domain, true, now);
    return {
      allowed: true,
      reason: mode === 'unrestricted' ? 'Unrestricted mode' : 'Domain and port allowed',
      domain,
      port,
      policyMode: mode,
    };
  }

  function getStats(): NetworkPolicyStats {
    const totalRequests = allRequests.length;
    const allowedRequests = allRequests.filter((r) => r.allowed).length;
    const blockedRequests = allRequests.filter((r) => !r.allowed).length;

    // Count rate-limited as a subset of blocked — these are requests that
    // would otherwise be allowed but were denied due to rate limiting.
    // We approximate this by counting blocked requests from agents that have
    // exceeded the rate limit. For simplicity, we track all blocked as
    // blockedRequests and compute rateLimitedRequests from the stats.
    let rateLimitedRequests = 0;
    for (const r of allRequests) {
      if (!r.allowed && r.domain !== '') {
        // Check if it could be a rate limit (domain is valid)
        // This is a heuristic; for precise tracking we'd need tagged records
      }
    }

    // Count domain occurrences for allowed requests
    const domainCounts = new Map<string, number>();
    const blockedDomainCounts = new Map<string, number>();

    for (const record of allRequests) {
      if (record.domain === '') {
        continue;
      }

      if (record.allowed) {
        domainCounts.set(record.domain, (domainCounts.get(record.domain) ?? 0) + 1);
      } else {
        blockedDomainCounts.set(record.domain, (blockedDomainCounts.get(record.domain) ?? 0) + 1);
      }
    }

    const topDomains = [...domainCounts.entries()]
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topBlockedDomains = [...blockedDomainCounts.entries()]
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Recalculate rateLimitedRequests — count all blocked records for domains
    // that are not inherently blocked (i.e., the domain would normally be
    // allowed, but the request was still denied).
    for (const r of allRequests) {
      if (!r.allowed && r.domain !== '') {
        const domainIsBlocked = isBlockedDomain(r.domain);
        const domainNotAllowed = resolvedPolicy.mode === 'allowlist' && !isAllowedDomain(r.domain);
        if (!domainIsBlocked && !domainNotAllowed) {
          rateLimitedRequests++;
        }
      }
    }

    return {
      totalRequests,
      allowedRequests,
      blockedRequests,
      rateLimitedRequests,
      topDomains,
      topBlockedDomains,
    };
  }

  function resetStats(): void {
    agentRequests.clear();
    allRequests = [];
  }

  function generateDockerNetworkArgs(dockerPolicy: NetworkPolicy): string[] {
    if (dockerPolicy.mode === 'none') {
      return ['--network=none'];
    }

    if (dockerPolicy.mode === 'allowlist') {
      // Use a custom network with iptables rules for domain filtering.
      // The actual iptables setup is done at container runtime; here we
      // return the Docker CLI args that set up the network and cap-drop
      // for the sandboxed agent.
      const args: string[] = ['--cap-drop=ALL', '--network=agentctl-filtered'];

      // Pass allowed domains as environment variables for the
      // container-side firewall script to consume.
      if (dockerPolicy.allowedDomains.length > 0) {
        args.push(`--env=ALLOWED_DOMAINS=${dockerPolicy.allowedDomains.join(',')}`);
      }

      if (dockerPolicy.allowedPorts.length > 0) {
        args.push(`--env=ALLOWED_PORTS=${dockerPolicy.allowedPorts.join(',')}`);
      }

      if (dockerPolicy.blockedDomains.length > 0) {
        args.push(`--env=BLOCKED_DOMAINS=${dockerPolicy.blockedDomains.join(',')}`);
      }

      return args;
    }

    // Unrestricted — no network restriction args, but still cap-drop
    return ['--cap-drop=ALL'];
  }

  return {
    evaluate,
    matchesDomain,
    getStats,
    resetStats,
    generateDockerNetworkArgs,
  };
}

export { createNetworkPolicy, DEFAULT_BLOCKED_DOMAINS, matchesDomain };
