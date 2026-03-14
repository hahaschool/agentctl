import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscoveryCache } from './discovery-cache.js';

describe('DiscoveryCache', () => {
  let cache: DiscoveryCache<string[]>;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new DiscoveryCache<string[]>(60_000); // 60s TTL
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns undefined for cache miss', () => {
    expect(cache.get('key')).toBeUndefined();
  });

  it('stores and retrieves a value', () => {
    cache.set('key', ['a', 'b']);
    expect(cache.get('key')).toEqual(['a', 'b']);
  });

  it('returns undefined after TTL expires', () => {
    cache.set('key', ['a']);
    vi.advanceTimersByTime(61_000);
    expect(cache.get('key')).toBeUndefined();
  });

  it('returns value before TTL expires', () => {
    cache.set('key', ['a']);
    vi.advanceTimersByTime(59_000);
    expect(cache.get('key')).toEqual(['a']);
  });

  it('invalidates a specific key', () => {
    cache.set('key1', ['a']);
    cache.set('key2', ['b']);
    cache.invalidate('key1');
    expect(cache.get('key1')).toBeUndefined();
    expect(cache.get('key2')).toEqual(['b']);
  });

  it('invalidates all keys', () => {
    cache.set('key1', ['a']);
    cache.set('key2', ['b']);
    cache.invalidateAll();
    expect(cache.get('key1')).toBeUndefined();
    expect(cache.get('key2')).toBeUndefined();
  });
});
