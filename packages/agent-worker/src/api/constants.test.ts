import { describe, expect, it } from 'vitest';

import { SSE_HEARTBEAT_INTERVAL_MS } from './constants.js';

describe('Worker API constants', () => {
  it('SSE_HEARTBEAT_INTERVAL_MS is 15 seconds', () => {
    expect(SSE_HEARTBEAT_INTERVAL_MS).toBe(15_000);
  });
});
