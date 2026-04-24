# Memory Operations UI - Performance Baseline (PR B)

PR B introduces the DB-backed embedding provider resolver and keeps it cached for normal runtime paths.

Baseline expectation for later backfill PRs:

| Path | Baseline | Acceptance Gate |
| --- | --- | --- |
| `resolveEmbeddingClient()` warm cache | One DB lookup per active-provider TTL window | Backfill P99 should stay within 15% of this warm-cache behavior |
| `MemoryStore.addFact()` with warm resolver | Uses cached provider metadata and one embedding request per fact | PR E backfill batching must not regress single-fact write latency |
| `MemoryDrawerStore.writeSource()` with warm resolver | Resolves provider once per write call and stamps `embedding_model` from provider metadata | Drawer backfill must preserve model stamping and avoid per-chunk DB provider lookups |

The next worker PRs should replace these qualitative baselines with measured batch numbers once the backfill workers and bench harness exist.
