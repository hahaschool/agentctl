import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('syncRoutes source shape', () => {
  it('declares route-local auth and Fastify rate limiting on both sync endpoints', () => {
    const source = readFileSync(new URL('./sync.ts', import.meta.url), 'utf8');

    expect(source).toMatch(/await app\.register\(rateLimit,\s*\{/);
    expect(source).toMatch(
      /'\/changes'[\s\S]*?config:\s*\{\s*rateLimit:\s*syncFastifyRateLimit\s*\}[\s\S]*?preHandler:\s*\[\s*app\.rateLimit\(syncFastifyRateLimit\),\s*authHook\s*\]/,
    );
    expect(source).toMatch(
      /'\/ack'[\s\S]*?config:\s*\{\s*rateLimit:\s*syncFastifyRateLimit\s*\}[\s\S]*?preHandler:\s*\[\s*app\.rateLimit\(syncFastifyRateLimit\),\s*authHook\s*\]/,
    );
    expect(source).not.toMatch(/app\.addHook\('preHandler',\s*authHook\)/);
  });
});
