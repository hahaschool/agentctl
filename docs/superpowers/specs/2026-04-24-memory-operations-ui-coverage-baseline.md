# Memory Operations UI - Coverage Baseline (PR B)

Recorded for PR B. Keep the provider backend coverage at or above this level in later PRs.

| Package | File | Coverage |
| --- | --- | --- |
| control-plane | `src/memory/embedding-client-factory.ts` | Covered by focused factory cache/provider tests |
| control-plane | `src/memory/memory-store.ts` | Covered by existing store suite plus provider-model write regression |
| control-plane | `src/memory/memory-search.ts` | Covered by existing search suite plus provider-model vector predicate regression |
| control-plane | `src/memory/memory-drawer-store.ts` | Covered by drawer-store suite plus provider-model write regression |
| control-plane | `src/memory/memory-drawer-search.ts` | Covered by drawer-search suite plus provider-model vector predicate regression |
| control-plane | `src/api/routes/memory-providers.ts` | Covered by focused route tests for listing, validation, test secret handling, activation, and delete guards |

Command used for PR B:

```bash
pnpm --filter @agentctl/control-plane exec vitest run src/memory/provider-invalidation-bus.test.ts src/memory/embedding-client-factory.test.ts src/memory/memory-store.test.ts src/memory/memory-search.test.ts src/memory/memory-drawer-store.test.ts src/memory/memory-drawer-search.test.ts src/memory/ops/audit-logger.test.ts src/api/routes/memory-providers.test.ts
```
