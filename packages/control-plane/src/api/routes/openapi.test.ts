import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createServer } from '../server.js';
import { createMockLogger } from './test-helpers.js';

const logger = createMockLogger();

describe('OpenAPI / Swagger', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({ logger });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the OpenAPI JSON spec at /api/docs/json', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/docs/json' });

    expect(response.statusCode).toBe(200);

    const spec = response.json();
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toBe('AgentCTL Control Plane');
    expect(spec.info.version).toBe('0.1.0');
  });

  it('includes defined tags in the spec', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/docs/json' });
    const spec = response.json();

    const tagNames = spec.tags.map((t: { name: string }) => t.name);
    expect(tagNames).toContain('health');
    expect(tagNames).toContain('agents');
    expect(tagNames).toContain('machines');
    expect(tagNames).toContain('scheduler');
    expect(tagNames).toContain('runtime-config');
    expect(tagNames).toContain('runtime-sessions');
  });

  it('includes routes in the spec paths', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/docs/json' });
    const spec = response.json();

    expect(spec.paths).toBeDefined();
    expect(spec.paths['/health']).toBeDefined();
    expect(spec.paths['/api/agents/register']).toBeDefined();
    expect(spec.paths['/api/runtime-config/defaults']).toBeDefined();
    expect(spec.paths['/api/runtime-config/drift']).toBeDefined();
    expect(spec.paths['/api/runtime-sessions/']).toBeDefined();
    expect(spec.paths['/api/runtime-sessions/{id}/handoffs']).toBeDefined();
  });

  it('serves the Swagger UI at /api/docs/', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/docs/' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.body).toContain('swagger');
  });

  it('includes component schemas', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/docs/json' });
    const spec = response.json();

    expect(spec.components?.schemas?.DependencyStatus).toBeDefined();
    expect(spec.components?.schemas?.ErrorResponse).toBeDefined();
  });
});
