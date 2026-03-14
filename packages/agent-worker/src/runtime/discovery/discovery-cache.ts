// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CacheEntry<T> = {
  readonly value: T;
  readonly expiresAt: number;
};

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * Generic in-memory cache with a fixed TTL.
 *
 * Used to avoid re-scanning the filesystem on every discovery request.
 * Entries are lazily evicted on `get()` after TTL expiration.
 */
export class DiscoveryCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }

  invalidateAll(): void {
    this.entries.clear();
  }
}
