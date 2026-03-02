import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createServer } from '../server.js';
import { createRequestTracker, normalizeRoutePath, recordRequest } from './metrics.js';

const logger = {
  child: () => logger,
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
  level: 'silent',
} as unknown as Logger;

// ── normalizeRoutePath ───────────────────────────────────────────────────

describe('normalizeRoutePath', () => {
  it('leaves simple paths unchanged', () => {
    expect(normalizeRoutePath('/health')).toBe('/health');
    expect(normalizeRoutePath('/metrics')).toBe('/metrics');
  });

  it('replaces UUID segments with :id', () => {
    expect(normalizeRoutePath('/api/agents/550e8400-e29b-41d4-a716-446655440000/start')).toBe(
      '/api/agents/:id/start',
    );
  });

  it('replaces hyphenated ID segments with :id', () => {
    expect(normalizeRoutePath('/api/agents/my-agent-123/runs')).toBe('/api/agents/:id/runs');
  });

  it('strips query strings', () => {
    expect(normalizeRoutePath('/health?detail=true')).toBe('/health');
  });
});

// ── recordRequest ────────────────────────────────────────────────────────

describe('recordRequest', () => {
  it('tracks request counts by method, path, status', () => {
    const tracker = createRequestTracker();
    recordRequest(tracker, 'GET', '/health', 200, 0.005);
    recordRequest(tracker, 'GET', '/health', 200, 0.003);
    recordRequest(tracker, 'POST', '/api/agents/register', 201, 0.01);

    expect(tracker.requests.get('GET|/health|200')).toBe(2);
    expect(tracker.requests.get('POST|/api/agents/register|201')).toBe(1);
  });

  it('records duration histogram data', () => {
    const tracker = createRequestTracker();
    recordRequest(tracker, 'GET', '/health', 200, 0.005);
    recordRequest(tracker, 'GET', '/health', 200, 0.15);

    const hist = tracker.durations.get('GET|/health');
    expect(hist).toBeDefined();
    expect(hist!.count).toBe(2);
    expect(hist!.sum).toBeCloseTo(0.155);
  });
});

// ── GET /metrics (no dependencies) ───────────────────────────────────────

describe('GET /metrics (no dependencies)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({ logger });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with text/plain content type', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
  });

  it('contains agentctl_control_plane_up gauge', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    const body = response.body;
    expect(body).toContain('# HELP agentctl_control_plane_up');
    expect(body).toContain('# TYPE agentctl_control_plane_up gauge');
    expect(body).toContain('agentctl_control_plane_up 1');
  });

  it('contains agentctl_agents_total gauge', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    expect(response.body).toContain('# TYPE agentctl_agents_total gauge');
    expect(response.body).toContain('agentctl_agents_total 0');
  });

  it('contains agentctl_agents_active gauge', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    expect(response.body).toContain('# TYPE agentctl_agents_active gauge');
    expect(response.body).toContain('agentctl_agents_active 0');
  });

  it('contains agentctl_runs_total counter', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    expect(response.body).toContain('# TYPE agentctl_runs_total counter');
    expect(response.body).toContain('agentctl_runs_total 0');
  });

  it('contains agentctl_dependency_healthy gauge for all deps', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    const body = response.body;
    expect(body).toContain('agentctl_dependency_healthy{name="postgres"} 1');
    expect(body).toContain('agentctl_dependency_healthy{name="redis"} 1');
    expect(body).toContain('agentctl_dependency_healthy{name="mem0"} 1');
    expect(body).toContain('agentctl_dependency_healthy{name="litellm"} 1');
  });

  it('tracks HTTP requests from other endpoints', async () => {
    // Make a request to /health first to populate request tracking
    await app.inject({ method: 'GET', url: '/health' });

    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    const body = response.body;
    expect(body).toContain('agentctl_http_requests_total');
    // Should have tracked the /health request
    expect(body).toContain('method="GET"');
  });

  it('contains request duration histogram when requests have been made', async () => {
    // Ensure at least one tracked request exists
    await app.inject({ method: 'GET', url: '/health' });

    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    const body = response.body;
    expect(body).toContain('agentctl_http_request_duration_seconds');
    expect(body).toContain('_bucket');
    expect(body).toContain('_sum');
    expect(body).toContain('_count');
    expect(body).toContain('le="+Inf"');
  });
});

// ── GET /metrics (with degraded deps) ────────────────────────────────────

describe('GET /metrics (with degraded dependencies)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({
      logger,
      redis: {
        ping: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports unhealthy redis dependency as 0', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    expect(response.body).toContain('agentctl_dependency_healthy{name="redis"} 0');
  });

  it('reports healthy dependencies as 1 even when others are down', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    // postgres, mem0, litellm are not configured, so they should be healthy (vacuously true)
    expect(response.body).toContain('agentctl_dependency_healthy{name="postgres"} 1');
    expect(response.body).toContain('agentctl_dependency_healthy{name="mem0"} 1');
    expect(response.body).toContain('agentctl_dependency_healthy{name="litellm"} 1');
  });
});
