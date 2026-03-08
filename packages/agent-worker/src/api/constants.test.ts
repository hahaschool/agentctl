import { describe, expect, it } from 'vitest';

import { HEALTH_CHECK_TIMEOUT_MS, SSE_HEARTBEAT_INTERVAL_MS } from './constants.js';

describe('Worker API constants', () => {
  it('SSE_HEARTBEAT_INTERVAL_MS is 15 seconds', () => {
    expect(SSE_HEARTBEAT_INTERVAL_MS).toBe(15_000);
  });

  it('HEALTH_CHECK_TIMEOUT_MS is 2 seconds', () => {
    expect(HEALTH_CHECK_TIMEOUT_MS).toBe(2_000);
  });
});
