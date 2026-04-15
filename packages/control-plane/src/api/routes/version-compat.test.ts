// ---------------------------------------------------------------------------
// Tests for version-compat.ts — roadmap §33.11.
// ---------------------------------------------------------------------------

import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { versionCompatRoutes } from './version-compat.js';

type BuildOpts = {
  appVersion?: string;
  gitSha?: string;
  schemaVersion?: number;
  rateLimitMax?: number;
};

async function buildApp(opts: BuildOpts = {}): Promise<FastifyInstance> {
  if (opts.rateLimitMax !== undefined) {
    process.env.VERSION_COMPAT_RATE_LIMIT_MAX = String(opts.rateLimitMax);
  }
  const app = Fastify({ logger: false });
  await app.register(versionCompatRoutes, {
    prefix: '/api',
    appVersion: opts.appVersion ?? '1.2.3',
    gitSha: opts.gitSha ?? 'abc1234',
    schemaVersion: opts.schemaVersion ?? 42,
  });
  await app.ready();
  return app;
}

describe('GET /api/version-compat', () => {
  let app: FastifyInstance | null = null;
  const originalEnv = { ...process.env };

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
    // Restore env so tests don't leak overrides into each other.
    for (const key of [
      'MIN_SUPPORTED_MOBILE_BUILD',
      'MIN_SUPPORTED_WEB_BUILD',
      'VERSION_COMPAT_RATE_LIMIT_MAX',
      'VERSION_COMPAT_RATE_LIMIT_WINDOW_MS',
    ]) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it('returns version identity + default zero build floors', async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/version-compat' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({
      appVersion: '1.2.3',
      gitSha: 'abc1234',
      schemaVersion: 42,
      minSupportedMobileBuild: 0,
      minSupportedWebBuild: 0,
    });
  });

  it('honors MIN_SUPPORTED_MOBILE_BUILD and MIN_SUPPORTED_WEB_BUILD env overrides', async () => {
    process.env.MIN_SUPPORTED_MOBILE_BUILD = '123';
    process.env.MIN_SUPPORTED_WEB_BUILD = '45';
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/version-compat' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.minSupportedMobileBuild).toBe(123);
    expect(body.minSupportedWebBuild).toBe(45);
  });

  it('falls back to 0 when env values are non-numeric or negative', async () => {
    process.env.MIN_SUPPORTED_MOBILE_BUILD = 'not-a-number';
    process.env.MIN_SUPPORTED_WEB_BUILD = '-5';
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/version-compat' });
    const body = res.json();
    expect(body.minSupportedMobileBuild).toBe(0);
    expect(body.minSupportedWebBuild).toBe(0);
  });

  it('rate-limits with 429 on the 61st request within the window', async () => {
    // Cap the limit at 3 so the test stays fast but still exercises the real
    // @fastify/rate-limit path rather than a hand-rolled counter.
    app = await buildApp({ rateLimitMax: 3 });

    for (let i = 0; i < 3; i += 1) {
      const res = await app.inject({ method: 'GET', url: '/api/version-compat' });
      expect(res.statusCode).toBe(200);
    }

    const limited = await app.inject({ method: 'GET', url: '/api/version-compat' });
    expect(limited.statusCode).toBe(429);
    const body = limited.json();
    expect(body.error).toBe('RATE_LIMITED');
  });
});
