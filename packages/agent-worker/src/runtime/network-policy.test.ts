import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createNetworkPolicy,
  DEFAULT_BLOCKED_DOMAINS,
  matchesDomain,
  type NetworkPolicy,
  type NetworkRequest,
} from './network-policy.js';

// ── Helpers ─────────────────────────────────────────────────────────

function makeRequest(overrides?: Partial<NetworkRequest>): NetworkRequest {
  return {
    url: 'https://github.com/some/repo',
    method: 'GET',
    agentId: 'agent-1',
    timestamp: new Date(),
    ...overrides,
  };
}

function makePolicy(overrides?: Partial<NetworkPolicy>): NetworkPolicy {
  return {
    mode: 'allowlist',
    allowedDomains: ['github.com'],
    allowedPorts: [443, 80],
    blockedDomains: [],
    maxRequestsPerMinute: 60,
    maxBandwidthBytesPerMinute: 50 * 1024 * 1024,
    logAllRequests: false,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('NetworkPolicyEnforcer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-02T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── createNetworkPolicy defaults ────────────────────────────────

  describe('createNetworkPolicy()', () => {
    it('creates enforcer with default policy (mode: none)', () => {
      const enforcer = createNetworkPolicy();
      const decision = enforcer.evaluate(makeRequest());

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('Network access disabled');
      expect(decision.policyMode).toBe('none');
    });

    it('merges partial policy with defaults', () => {
      const enforcer = createNetworkPolicy({
        mode: 'allowlist',
        allowedDomains: ['github.com'],
        allowedPorts: [443],
      });

      const decision = enforcer.evaluate(makeRequest());

      expect(decision.allowed).toBe(true);
      expect(decision.policyMode).toBe('allowlist');
    });

    it('includes default blocked domains even with custom blockedDomains', () => {
      const enforcer = createNetworkPolicy({
        mode: 'unrestricted',
        blockedDomains: ['evil.com'],
      });

      // Default blocked domain should still be blocked
      const metadataRequest = makeRequest({
        url: 'http://169.254.169.254/latest/meta-data/',
      });
      const decision = enforcer.evaluate(metadataRequest);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('blocked');

      // Custom blocked domain should also be blocked
      const evilRequest = makeRequest({ url: 'https://evil.com/steal' });
      const evilDecision = enforcer.evaluate(evilRequest);

      expect(evilDecision.allowed).toBe(false);
    });
  });

  // ── Mode: none ──────────────────────────────────────────────────

  describe('mode: none', () => {
    it('blocks all requests', () => {
      const enforcer = createNetworkPolicy({ mode: 'none' });

      const decision = enforcer.evaluate(makeRequest());

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('Network access disabled');
    });

    it('blocks even well-known domains', () => {
      const enforcer = createNetworkPolicy({ mode: 'none' });

      const decision = enforcer.evaluate(makeRequest({ url: 'https://google.com' }));

      expect(decision.allowed).toBe(false);
    });

    it('blocks HTTP requests', () => {
      const enforcer = createNetworkPolicy({ mode: 'none' });

      const decision = enforcer.evaluate(makeRequest({ url: 'http://example.com' }));

      expect(decision.allowed).toBe(false);
    });

    it('sets policyMode to none in decision', () => {
      const enforcer = createNetworkPolicy({ mode: 'none' });

      const decision = enforcer.evaluate(makeRequest());

      expect(decision.policyMode).toBe('none');
    });
  });

  // ── Mode: unrestricted ──────────────────────────────────────────

  describe('mode: unrestricted', () => {
    it('allows general requests', () => {
      const enforcer = createNetworkPolicy({ mode: 'unrestricted' });

      const decision = enforcer.evaluate(makeRequest({ url: 'https://example.com/api' }));

      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe('Unrestricted mode');
    });

    it('blocks default blocked domains', () => {
      const enforcer = createNetworkPolicy({ mode: 'unrestricted' });

      const decision = enforcer.evaluate(
        makeRequest({ url: 'http://169.254.169.254/latest/meta-data/' }),
      );

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('blocked');
    });

    it('blocks GCP metadata endpoint', () => {
      const enforcer = createNetworkPolicy({ mode: 'unrestricted' });

      const decision = enforcer.evaluate(
        makeRequest({ url: 'http://metadata.google.internal/computeMetadata/' }),
      );

      expect(decision.allowed).toBe(false);
    });

    it('blocks *.internal wildcard domains', () => {
      const enforcer = createNetworkPolicy({ mode: 'unrestricted' });

      const decision = enforcer.evaluate(makeRequest({ url: 'http://service.internal/api' }));

      expect(decision.allowed).toBe(false);
    });

    it('blocks custom blocked domains alongside defaults', () => {
      const enforcer = createNetworkPolicy({
        mode: 'unrestricted',
        blockedDomains: ['malware.example.com'],
      });

      const decision = enforcer.evaluate(
        makeRequest({ url: 'https://malware.example.com/payload' }),
      );

      expect(decision.allowed).toBe(false);
    });

    it('allows any port when not blocked', () => {
      const enforcer = createNetworkPolicy({ mode: 'unrestricted' });

      const decision = enforcer.evaluate(makeRequest({ url: 'https://example.com:8443/api' }));

      expect(decision.allowed).toBe(true);
    });
  });

  // ── Mode: allowlist ─────────────────────────────────────────────

  describe('mode: allowlist', () => {
    it('allows requests to domains in the allowlist', () => {
      const enforcer = createNetworkPolicy({
        mode: 'allowlist',
        allowedDomains: ['github.com'],
        allowedPorts: [443],
      });

      const decision = enforcer.evaluate(makeRequest());

      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe('Domain and port allowed');
    });

    it('blocks requests to domains not in the allowlist', () => {
      const enforcer = createNetworkPolicy({
        mode: 'allowlist',
        allowedDomains: ['github.com'],
        allowedPorts: [443],
      });

      const decision = enforcer.evaluate(makeRequest({ url: 'https://evil.com/steal' }));

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('not in allowlist');
    });

    it('blocks requests to disallowed ports', () => {
      const enforcer = createNetworkPolicy({
        mode: 'allowlist',
        allowedDomains: ['github.com'],
        allowedPorts: [443],
      });

      const decision = enforcer.evaluate(makeRequest({ url: 'http://github.com/api' }));

      // Port 80 is not in allowedPorts [443]
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Port 80 is not allowed');
    });

    it('allows all ports when allowedPorts is empty', () => {
      const enforcer = createNetworkPolicy({
        mode: 'allowlist',
        allowedDomains: ['github.com'],
        allowedPorts: [],
      });

      const decision = enforcer.evaluate(makeRequest({ url: 'https://github.com:9999/api' }));

      expect(decision.allowed).toBe(true);
    });

    it('blocks domains in blockedDomains even if in allowlist', () => {
      const enforcer = createNetworkPolicy({
        mode: 'allowlist',
        allowedDomains: ['github.com', '169.254.169.254'],
        allowedPorts: [443, 80],
      });

      const decision = enforcer.evaluate(makeRequest({ url: 'http://169.254.169.254/meta-data' }));

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('blocked');
    });

    it('supports wildcard domains in the allowlist', () => {
      const enforcer = createNetworkPolicy({
        mode: 'allowlist',
        allowedDomains: ['*.github.com'],
        allowedPorts: [443],
      });

      const decision = enforcer.evaluate(makeRequest({ url: 'https://api.github.com/repos' }));

      expect(decision.allowed).toBe(true);
    });

    it('extracts correct domain and port from URL', () => {
      const enforcer = createNetworkPolicy({
        mode: 'allowlist',
        allowedDomains: ['registry.npmjs.org'],
        allowedPorts: [443],
      });

      const decision = enforcer.evaluate(
        makeRequest({ url: 'https://registry.npmjs.org/express' }),
      );

      expect(decision.allowed).toBe(true);
      expect(decision.domain).toBe('registry.npmjs.org');
      expect(decision.port).toBe(443);
    });

    it('extracts explicit port from URL', () => {
      const enforcer = createNetworkPolicy({
        mode: 'allowlist',
        allowedDomains: ['localhost'],
        allowedPorts: [3000],
      });

      const decision = enforcer.evaluate(makeRequest({ url: 'http://localhost:3000/api' }));

      expect(decision.allowed).toBe(true);
      expect(decision.port).toBe(3000);
    });
  });

  // ── Domain matching (standalone function) ───────────────────────

  describe('matchesDomain()', () => {
    it('matches exact domain', () => {
      expect(matchesDomain('github.com', 'github.com')).toBe(true);
    });

    it('does not match different domains', () => {
      expect(matchesDomain('gitlab.com', 'github.com')).toBe(false);
    });

    it('is case insensitive', () => {
      expect(matchesDomain('GitHub.COM', 'github.com')).toBe(true);
      expect(matchesDomain('github.com', 'GITHUB.COM')).toBe(true);
    });

    it('single wildcard matches one subdomain level', () => {
      expect(matchesDomain('api.github.com', '*.github.com')).toBe(true);
    });

    it('single wildcard does not match the base domain', () => {
      expect(matchesDomain('github.com', '*.github.com')).toBe(false);
    });

    it('single wildcard does not match deeper subdomains', () => {
      expect(matchesDomain('deep.api.github.com', '*.github.com')).toBe(false);
    });

    it('double wildcard matches the base domain', () => {
      expect(matchesDomain('github.com', '**.github.com')).toBe(true);
    });

    it('double wildcard matches one subdomain level', () => {
      expect(matchesDomain('api.github.com', '**.github.com')).toBe(true);
    });

    it('double wildcard matches deeper subdomains', () => {
      expect(matchesDomain('deep.api.github.com', '**.github.com')).toBe(true);
    });

    it('wildcard does not match unrelated domains', () => {
      expect(matchesDomain('evil.com', '*.github.com')).toBe(false);
      expect(matchesDomain('evil.com', '**.github.com')).toBe(false);
    });

    it('handles empty domain string', () => {
      expect(matchesDomain('', 'github.com')).toBe(false);
      expect(matchesDomain('', '*.github.com')).toBe(false);
    });

    it('handles empty pattern string', () => {
      expect(matchesDomain('github.com', '')).toBe(false);
    });

    it('wildcard *.internal matches service.internal', () => {
      expect(matchesDomain('service.internal', '*.internal')).toBe(true);
    });

    it('double wildcard **.example.com matches many levels deep', () => {
      expect(matchesDomain('a.b.c.d.example.com', '**.example.com')).toBe(true);
    });
  });

  // ── Rate limiting ─────────────────────────────────────────────

  describe('rate limiting', () => {
    it('blocks requests when rate limit is exceeded', () => {
      const enforcer = createNetworkPolicy({
        mode: 'unrestricted',
        maxRequestsPerMinute: 3,
      });

      const now = new Date('2026-03-02T12:00:00.000Z');

      for (let i = 0; i < 3; i++) {
        const decision = enforcer.evaluate(
          makeRequest({
            url: `https://example.com/api/${i}`,
            timestamp: now,
          }),
        );
        expect(decision.allowed).toBe(true);
      }

      const blockedDecision = enforcer.evaluate(
        makeRequest({
          url: 'https://example.com/api/extra',
          timestamp: now,
        }),
      );

      expect(blockedDecision.allowed).toBe(false);
      expect(blockedDecision.reason).toContain('Rate limit exceeded');
    });

    it('rate limit resets after the window elapses', () => {
      const enforcer = createNetworkPolicy({
        mode: 'unrestricted',
        maxRequestsPerMinute: 2,
      });

      const startTime = new Date('2026-03-02T12:00:00.000Z');

      // Use up the limit
      enforcer.evaluate(makeRequest({ url: 'https://example.com/1', timestamp: startTime }));
      enforcer.evaluate(makeRequest({ url: 'https://example.com/2', timestamp: startTime }));

      // Should be blocked now
      const blocked = enforcer.evaluate(
        makeRequest({ url: 'https://example.com/3', timestamp: startTime }),
      );
      expect(blocked.allowed).toBe(false);

      // Advance past the window (61 seconds)
      const laterTime = new Date(startTime.getTime() + 61_000);
      vi.setSystemTime(laterTime);

      const allowed = enforcer.evaluate(
        makeRequest({ url: 'https://example.com/4', timestamp: laterTime }),
      );
      expect(allowed.allowed).toBe(true);
    });

    it('tracks rate limits per agent independently', () => {
      const enforcer = createNetworkPolicy({
        mode: 'unrestricted',
        maxRequestsPerMinute: 2,
      });

      const now = new Date();

      // Agent 1 uses up its limit
      enforcer.evaluate(
        makeRequest({
          url: 'https://example.com/1',
          agentId: 'agent-1',
          timestamp: now,
        }),
      );
      enforcer.evaluate(
        makeRequest({
          url: 'https://example.com/2',
          agentId: 'agent-1',
          timestamp: now,
        }),
      );

      // Agent 1 blocked
      const agent1Result = enforcer.evaluate(
        makeRequest({
          url: 'https://example.com/3',
          agentId: 'agent-1',
          timestamp: now,
        }),
      );
      expect(agent1Result.allowed).toBe(false);

      // Agent 2 should still be fine
      const agent2Result = enforcer.evaluate(
        makeRequest({
          url: 'https://example.com/1',
          agentId: 'agent-2',
          timestamp: now,
        }),
      );
      expect(agent2Result.allowed).toBe(true);
    });

    it('rate limit applies in allowlist mode too', () => {
      const enforcer = createNetworkPolicy({
        mode: 'allowlist',
        allowedDomains: ['api.example.com'],
        allowedPorts: [443],
        maxRequestsPerMinute: 1,
      });

      const now = new Date();

      const first = enforcer.evaluate(
        makeRequest({
          url: 'https://api.example.com/v1',
          timestamp: now,
        }),
      );
      expect(first.allowed).toBe(true);

      const second = enforcer.evaluate(
        makeRequest({
          url: 'https://api.example.com/v2',
          timestamp: now,
        }),
      );
      expect(second.allowed).toBe(false);
      expect(second.reason).toContain('Rate limit');
    });
  });

  // ── Blocked domains (security) ────────────────────────────────

  describe('blocked domains', () => {
    it('always blocks AWS metadata endpoint', () => {
      const enforcer = createNetworkPolicy({ mode: 'unrestricted' });

      const decision = enforcer.evaluate(
        makeRequest({ url: 'http://169.254.169.254/latest/meta-data/' }),
      );

      expect(decision.allowed).toBe(false);
    });

    it('always blocks GCP metadata via metadata.google.internal', () => {
      const enforcer = createNetworkPolicy({ mode: 'unrestricted' });

      const decision = enforcer.evaluate(
        makeRequest({
          url: 'http://metadata.google.internal/computeMetadata/v1/',
        }),
      );

      expect(decision.allowed).toBe(false);
    });

    it('always blocks metadata.google.com', () => {
      const enforcer = createNetworkPolicy({ mode: 'unrestricted' });

      const decision = enforcer.evaluate(makeRequest({ url: 'http://metadata.google.com/v1/' }));

      expect(decision.allowed).toBe(false);
    });

    it('always blocks *.internal pattern', () => {
      const enforcer = createNetworkPolicy({ mode: 'unrestricted' });

      const decision = enforcer.evaluate(makeRequest({ url: 'http://secret.internal/keys' }));

      expect(decision.allowed).toBe(false);
    });

    it('DEFAULT_BLOCKED_DOMAINS contains expected entries', () => {
      expect(DEFAULT_BLOCKED_DOMAINS).toContain('metadata.google.internal');
      expect(DEFAULT_BLOCKED_DOMAINS).toContain('169.254.169.254');
      expect(DEFAULT_BLOCKED_DOMAINS).toContain('metadata.google.com');
      expect(DEFAULT_BLOCKED_DOMAINS).toContain('*.internal');
    });

    it('blocked domains override allowlist', () => {
      const enforcer = createNetworkPolicy({
        mode: 'allowlist',
        allowedDomains: ['**.internal'],
        allowedPorts: [80],
      });

      const decision = enforcer.evaluate(makeRequest({ url: 'http://service.internal/api' }));

      expect(decision.allowed).toBe(false);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles malformed URL gracefully', () => {
      const enforcer = createNetworkPolicy({ mode: 'unrestricted' });

      const decision = enforcer.evaluate(makeRequest({ url: 'not-a-valid-url' }));

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('Malformed URL');
      expect(decision.domain).toBe('');
      expect(decision.port).toBe(0);
    });

    it('handles URL with no explicit port for HTTPS', () => {
      const enforcer = createNetworkPolicy({
        mode: 'allowlist',
        allowedDomains: ['example.com'],
        allowedPorts: [443],
      });

      const decision = enforcer.evaluate(makeRequest({ url: 'https://example.com/path' }));

      expect(decision.port).toBe(443);
      expect(decision.allowed).toBe(true);
    });

    it('handles URL with no explicit port for HTTP', () => {
      const enforcer = createNetworkPolicy({
        mode: 'allowlist',
        allowedDomains: ['example.com'],
        allowedPorts: [80],
      });

      const decision = enforcer.evaluate(makeRequest({ url: 'http://example.com/path' }));

      expect(decision.port).toBe(80);
      expect(decision.allowed).toBe(true);
    });

    it('handles URL with explicit non-standard port', () => {
      const enforcer = createNetworkPolicy({
        mode: 'allowlist',
        allowedDomains: ['example.com'],
        allowedPorts: [8080],
      });

      const decision = enforcer.evaluate(makeRequest({ url: 'http://example.com:8080/api' }));

      expect(decision.port).toBe(8080);
      expect(decision.allowed).toBe(true);
    });

    it('handles empty allowedDomains in allowlist mode', () => {
      const enforcer = createNetworkPolicy({
        mode: 'allowlist',
        allowedDomains: [],
        allowedPorts: [443],
      });

      const decision = enforcer.evaluate(makeRequest());

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('not in allowlist');
    });

    it('handles multiple allowed domains', () => {
      const enforcer = createNetworkPolicy({
        mode: 'allowlist',
        allowedDomains: ['github.com', 'npmjs.org', '*.anthropic.com'],
        allowedPorts: [443],
      });

      expect(enforcer.evaluate(makeRequest({ url: 'https://github.com/repo' })).allowed).toBe(true);

      expect(enforcer.evaluate(makeRequest({ url: 'https://npmjs.org/package' })).allowed).toBe(
        true,
      );

      expect(
        enforcer.evaluate(makeRequest({ url: 'https://api.anthropic.com/v1/messages' })).allowed,
      ).toBe(true);

      expect(enforcer.evaluate(makeRequest({ url: 'https://evil.com/bad' })).allowed).toBe(false);
    });

    it('handles consecutive evaluations correctly', () => {
      const enforcer = createNetworkPolicy({
        mode: 'allowlist',
        allowedDomains: ['github.com'],
        allowedPorts: [443],
      });

      const allowed = enforcer.evaluate(makeRequest());
      expect(allowed.allowed).toBe(true);

      const blocked = enforcer.evaluate(makeRequest({ url: 'https://evil.com/steal' }));
      expect(blocked.allowed).toBe(false);

      const allowedAgain = enforcer.evaluate(makeRequest());
      expect(allowedAgain.allowed).toBe(true);
    });
  });

  // ── Stats ─────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('returns zero stats for a fresh enforcer', () => {
      const enforcer = createNetworkPolicy({ mode: 'unrestricted' });

      const stats = enforcer.getStats();

      expect(stats.totalRequests).toBe(0);
      expect(stats.allowedRequests).toBe(0);
      expect(stats.blockedRequests).toBe(0);
      expect(stats.topDomains).toEqual([]);
      expect(stats.topBlockedDomains).toEqual([]);
    });

    it('tracks total, allowed, and blocked requests', () => {
      const enforcer = createNetworkPolicy({
        mode: 'allowlist',
        allowedDomains: ['github.com'],
        allowedPorts: [443],
      });

      const now = new Date();

      // 2 allowed
      enforcer.evaluate(makeRequest({ url: 'https://github.com/a', timestamp: now }));
      enforcer.evaluate(makeRequest({ url: 'https://github.com/b', timestamp: now }));
      // 1 blocked
      enforcer.evaluate(makeRequest({ url: 'https://evil.com/c', timestamp: now }));

      const stats = enforcer.getStats();

      expect(stats.totalRequests).toBe(3);
      expect(stats.allowedRequests).toBe(2);
      expect(stats.blockedRequests).toBe(1);
    });

    it('tracks top domains', () => {
      const enforcer = createNetworkPolicy({
        mode: 'unrestricted',
      });

      const now = new Date();

      enforcer.evaluate(makeRequest({ url: 'https://github.com/1', timestamp: now }));
      enforcer.evaluate(makeRequest({ url: 'https://github.com/2', timestamp: now }));
      enforcer.evaluate(makeRequest({ url: 'https://npmjs.org/3', timestamp: now }));

      const stats = enforcer.getStats();

      expect(stats.topDomains).toEqual([
        { domain: 'github.com', count: 2 },
        { domain: 'npmjs.org', count: 1 },
      ]);
    });

    it('tracks top blocked domains', () => {
      const enforcer = createNetworkPolicy({
        mode: 'allowlist',
        allowedDomains: ['github.com'],
        allowedPorts: [443],
      });

      const now = new Date();

      enforcer.evaluate(makeRequest({ url: 'https://evil.com/a', timestamp: now }));
      enforcer.evaluate(makeRequest({ url: 'https://evil.com/b', timestamp: now }));
      enforcer.evaluate(makeRequest({ url: 'https://malware.org/c', timestamp: now }));

      const stats = enforcer.getStats();

      expect(stats.topBlockedDomains).toEqual([
        { domain: 'evil.com', count: 2 },
        { domain: 'malware.org', count: 1 },
      ]);
    });

    it('counts rate-limited requests', () => {
      const enforcer = createNetworkPolicy({
        mode: 'unrestricted',
        maxRequestsPerMinute: 2,
      });

      const now = new Date();

      // 2 allowed
      enforcer.evaluate(makeRequest({ url: 'https://example.com/1', timestamp: now }));
      enforcer.evaluate(makeRequest({ url: 'https://example.com/2', timestamp: now }));
      // 1 rate-limited
      enforcer.evaluate(makeRequest({ url: 'https://example.com/3', timestamp: now }));

      const stats = enforcer.getStats();

      expect(stats.totalRequests).toBe(3);
      expect(stats.allowedRequests).toBe(2);
      expect(stats.blockedRequests).toBe(1);
      expect(stats.rateLimitedRequests).toBe(1);
    });
  });

  // ── resetStats ────────────────────────────────────────────────

  describe('resetStats()', () => {
    it('clears all recorded statistics', () => {
      const enforcer = createNetworkPolicy({ mode: 'unrestricted' });

      const now = new Date();

      enforcer.evaluate(makeRequest({ url: 'https://example.com/1', timestamp: now }));
      enforcer.evaluate(makeRequest({ url: 'https://example.com/2', timestamp: now }));

      enforcer.resetStats();

      const stats = enforcer.getStats();

      expect(stats.totalRequests).toBe(0);
      expect(stats.allowedRequests).toBe(0);
      expect(stats.blockedRequests).toBe(0);
      expect(stats.topDomains).toEqual([]);
    });

    it('resets rate limit counters too', () => {
      const enforcer = createNetworkPolicy({
        mode: 'unrestricted',
        maxRequestsPerMinute: 2,
      });

      const now = new Date();

      enforcer.evaluate(makeRequest({ url: 'https://example.com/1', timestamp: now }));
      enforcer.evaluate(makeRequest({ url: 'https://example.com/2', timestamp: now }));

      // Rate limited
      const blocked = enforcer.evaluate(
        makeRequest({ url: 'https://example.com/3', timestamp: now }),
      );
      expect(blocked.allowed).toBe(false);

      enforcer.resetStats();

      // Should be allowed again after reset
      const allowed = enforcer.evaluate(
        makeRequest({ url: 'https://example.com/4', timestamp: now }),
      );
      expect(allowed.allowed).toBe(true);
    });
  });

  // ── generateDockerNetworkArgs ─────────────────────────────────

  describe('generateDockerNetworkArgs()', () => {
    it('returns --network=none for mode: none', () => {
      const enforcer = createNetworkPolicy();

      const args = enforcer.generateDockerNetworkArgs(makePolicy({ mode: 'none' }));

      expect(args).toEqual(['--network=none']);
    });

    it('returns filtered network args for mode: allowlist', () => {
      const enforcer = createNetworkPolicy();

      const args = enforcer.generateDockerNetworkArgs(
        makePolicy({
          mode: 'allowlist',
          allowedDomains: ['github.com', 'npmjs.org'],
          allowedPorts: [443, 80],
          blockedDomains: ['evil.com'],
        }),
      );

      expect(args).toContain('--cap-drop=ALL');
      expect(args).toContain('--network=agentctl-filtered');
      expect(args).toContain('--env=ALLOWED_DOMAINS=github.com,npmjs.org');
      expect(args).toContain('--env=ALLOWED_PORTS=443,80');
      expect(args).toContain('--env=BLOCKED_DOMAINS=evil.com');
    });

    it('returns cap-drop only for mode: unrestricted', () => {
      const enforcer = createNetworkPolicy();

      const args = enforcer.generateDockerNetworkArgs(makePolicy({ mode: 'unrestricted' }));

      expect(args).toEqual(['--cap-drop=ALL']);
    });

    it('omits ALLOWED_DOMAINS env when allowedDomains is empty', () => {
      const enforcer = createNetworkPolicy();

      const args = enforcer.generateDockerNetworkArgs(
        makePolicy({
          mode: 'allowlist',
          allowedDomains: [],
          allowedPorts: [443],
        }),
      );

      expect(args).toContain('--cap-drop=ALL');
      expect(args).toContain('--network=agentctl-filtered');
      const domainArg = args.find((a) => a.startsWith('--env=ALLOWED_DOMAINS='));
      expect(domainArg).toBeUndefined();
    });

    it('omits ALLOWED_PORTS env when allowedPorts is empty', () => {
      const enforcer = createNetworkPolicy();

      const args = enforcer.generateDockerNetworkArgs(
        makePolicy({
          mode: 'allowlist',
          allowedDomains: ['github.com'],
          allowedPorts: [],
        }),
      );

      const portsArg = args.find((a) => a.startsWith('--env=ALLOWED_PORTS='));
      expect(portsArg).toBeUndefined();
    });

    it('omits BLOCKED_DOMAINS env when blockedDomains is empty', () => {
      const enforcer = createNetworkPolicy();

      const args = enforcer.generateDockerNetworkArgs(
        makePolicy({
          mode: 'allowlist',
          allowedDomains: ['github.com'],
          blockedDomains: [],
        }),
      );

      const blockedArg = args.find((a) => a.startsWith('--env=BLOCKED_DOMAINS='));
      expect(blockedArg).toBeUndefined();
    });

    it('never includes --privileged or SYS_ADMIN', () => {
      const enforcer = createNetworkPolicy();

      for (const mode of ['none', 'allowlist', 'unrestricted'] as const) {
        const args = enforcer.generateDockerNetworkArgs(makePolicy({ mode }));
        expect(args).not.toContain('--privileged');
        expect(args.some((a) => a.includes('SYS_ADMIN'))).toBe(false);
      }
    });
  });

  // ── Integration / combined scenarios ──────────────────────────

  describe('integration scenarios', () => {
    it('full workflow: evaluate, track stats, reset', () => {
      const enforcer = createNetworkPolicy({
        mode: 'allowlist',
        allowedDomains: ['github.com', '*.anthropic.com'],
        allowedPorts: [443],
        maxRequestsPerMinute: 100,
      });

      const now = new Date();

      // Allowed
      enforcer.evaluate(makeRequest({ url: 'https://github.com/repo', timestamp: now }));
      enforcer.evaluate(
        makeRequest({
          url: 'https://api.anthropic.com/v1/messages',
          timestamp: now,
        }),
      );

      // Blocked (not in allowlist)
      enforcer.evaluate(makeRequest({ url: 'https://evil.com/steal', timestamp: now }));

      const stats = enforcer.getStats();

      expect(stats.totalRequests).toBe(3);
      expect(stats.allowedRequests).toBe(2);
      expect(stats.blockedRequests).toBe(1);

      enforcer.resetStats();

      const resetStats = enforcer.getStats();

      expect(resetStats.totalRequests).toBe(0);
    });

    it('blocked domains take precedence over rate limit check', () => {
      const enforcer = createNetworkPolicy({
        mode: 'unrestricted',
        maxRequestsPerMinute: 1000,
      });

      const now = new Date();

      const decision = enforcer.evaluate(
        makeRequest({
          url: 'http://169.254.169.254/latest/meta-data/',
          timestamp: now,
        }),
      );

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('blocked');
      // Not "Rate limit exceeded"
      expect(decision.reason).not.toContain('Rate limit');
    });

    it('malformed URL in none mode still returns proper decision', () => {
      const enforcer = createNetworkPolicy({ mode: 'none' });

      const decision = enforcer.evaluate(makeRequest({ url: 'not-valid' }));

      // Even though URL is malformed, mode:none blocks with its own reason
      // The actual behavior depends on order of checks — malformed URL
      // check happens first in implementation
      expect(decision.allowed).toBe(false);
    });

    it('handles high volume of requests without errors', () => {
      const enforcer = createNetworkPolicy({
        mode: 'unrestricted',
        maxRequestsPerMinute: 10000,
      });

      const baseTime = new Date('2026-03-02T12:00:00.000Z');

      for (let i = 0; i < 500; i++) {
        const timestamp = new Date(baseTime.getTime() + i * 100);
        vi.setSystemTime(timestamp);

        const decision = enforcer.evaluate(
          makeRequest({
            url: `https://example.com/api/${i}`,
            agentId: `agent-${i % 10}`,
            timestamp,
          }),
        );
        expect(decision.allowed).toBe(true);
      }

      const stats = enforcer.getStats();

      expect(stats.totalRequests).toBe(500);
      expect(stats.allowedRequests).toBe(500);
    });
  });
});
