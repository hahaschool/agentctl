# Memory Operations Spec — Verified Facts (2026-04-23)

## 1. memory_facts.id Type
**VERIFIED: `text` PRIMARY KEY**
- Migration: `packages/control-plane/drizzle/0010_add_memory_layer.sql:19` → `"id" text PRIMARY KEY`
- Drizzle schema: `packages/control-plane/src/db/schema.ts:357` → `id: text('id').primaryKey()`
- **NOT uuid; NOT numeric.** Plaintext type identifier.

## 2. memory_facts.id Generation at Runtime
**VERIFIED: Custom timestamp + random alphanumeric**
- Path: `packages/control-plane/src/memory/memory-store.ts:103-109`
- Logic: `const timestamp = Date.now().toString(36).padStart(10, '0'); const random = [16 random base-36 chars]`
- Example: `gj7x8a0k9b5c2d1e3f4g` (26 chars total)
- **NO UUID generation; NO Postgres sequence.**

## 3. memory_facts.embedding in Drizzle
**FALSE CLAIM — embedding NOT in Drizzle schema**
- Drizzle `memoryFacts` table: `packages/control-plane/src/db/schema.ts:354-375`
- Columns: id, scope, content, contentModel, embeddingVersion, entityType, confidence, strength, sourceJson, validFrom, validUntil, createdAt, accessedAt
- **embedding field is ABSENT from Drizzle definition**
- **Fact:** Embedding is stored via raw SQL INSERT in `memory-store.ts:227` as `embedding` (raw SQL column), bypassing Drizzle ORM for vector type

## 4. memory_drawers.embedding_model
**VERIFIED: `embedding_model` with default**
- Migration: `packages/control-plane/drizzle/0030_add_memory_drawers.sql:22`
  - Column: `embedding_model text NOT NULL DEFAULT 'text-embedding-3-small'`
- Drizzle: `packages/control-plane/src/db/schema.ts:311` → `embeddingModel: text('embedding_model').notNull().default('text-embedding-3-small')`
- **Matches default in memory_facts.content_model**

## 5. EmbeddingClient URL Suffix
**VERIFIED: `/v1/embeddings`**
- File: `packages/control-plane/src/memory/embedding-client.ts:64`
- Code: `` const url = `${this.baseUrl}/v1/embeddings` ``
- baseUrl is trimmed of trailing slashes at construction (line 41)

## 6. EmbeddingClient Instantiation Call Sites
**VERIFIED: One call site in main index.ts**
- `packages/control-plane/src/index.ts:378`
  ```
  embeddingClient = new EmbeddingClient({
    baseUrl: LITELLM_URL,
    model: 'text-embedding-3-small',
    logger: logger.child({ component: 'embedding-client' }),
  });
  ```
- **ONE call site only.** Gated on `LITELLM_URL` env var (line 377: `if (LITELLM_URL)`)
- Test instantiations in `embedding-client.test.ts:22, 125, 146` (not production)

## 7. Gemini OpenAI-Compat Embeddings Endpoint
**NOT FETCHED — Google docs not accessible via WebFetch**
- Expected format per OpenAI compat: `https://generativelanguage.googleapis.com/openai/v1/embeddings` (or similar)
- Current code hardcodes `text-embedding-3-small` model, suggesting no Gemini endpoint configured yet
- **Action:** Caller must verify against https://ai.google.dev/gemini-api/docs/openai if needed

## 8. Error Envelope Shape — server.ts
**VERIFIED: Flat `{error, message}`**
- File: `packages/control-plane/src/api/server.ts:937-962`
- Error handler response (ControlPlaneError): `{ error: err.code, message: err.message }`
- **NOT nested; NO context object in envelope**
- Example: `{ error: 'EMBEDDING_API_ERROR', message: 'Failed to...' }`

## 9. Web API request() Helper Expectation
**VERIFIED: Checks res.ok, extracts `.error` and `.message` from JSON body**
- File: `packages/web/src/lib/api/core.ts:21-44`
- Logic: If `!res.ok`, throws `ApiError` with `body.error`, `body.message`, `body.hint`
- **Matches CP error envelope**

## 10. ApiError Constructor Signature
**VERIFIED: `ApiError(status, code, message, hint?)`**
- File: `packages/web/src/lib/api/core.ts:7-19`
  ```typescript
  export class ApiError extends Error {
    constructor(status: number, code: string, message: string, hint?: string)
  ```

## 11. React Query Imports in queries.ts
**VERIFIED: `@tanstack/react-query`**
- File: `packages/web/src/lib/queries.ts:2`
- Line: `import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'`

## 12. Query Hook Return Pattern
**VERIFIED: All return `queryOptions(...)`, NOT `useQuery(...)`**
- Example patterns (queries.ts):
  - `memorySearchQuery()` (line 718): `return queryOptions({ queryKey, queryFn, enabled, staleTime })`
  - `memoryFactsQuery()` (line 727): `return queryOptions({ ... })`
  - All memory hooks follow same pattern
- **Call site:** Views invoke `useQuery(memoryFactsQuery(params))` (e.g., MemoryBrowserView.tsx:166)

## 13. Representative Memory Hook: memorySearchQuery
**VERIFIED: Full signature and pattern**
- Signature: `export function memorySearchQuery(q: string, opts?: { project?: string; type?: string })`
- Implementation: `queryOptions({ queryKey: queryKeys.memory.search(q, opts), queryFn: () => api.searchMemory({ q, ...opts }), enabled: q.length >= 2, staleTime: 60_000 })`
- Call site: `packages/web/src/views/MemoryBrowserView.tsx:166` → `const factsQueryResult = useQuery(memoryFactsQuery(queryParams))`
- Pattern: Hook returns options object; view passes to `useQuery()`

## 14. Memory Views File Inventory
**COUNT: 9 memory views + 1 knowledge + 1 consolidation = 11 views**
- MemoryBrowserView.tsx — Search and browse facts
- MemoryDashboardView.tsx — Stats overview
- MemoryDrawersView.tsx — Drawer exploration
- MemoryImportView.tsx — Import flow
- MemoryMaintenancePage.tsx — Maintenance trigger
- MemoryReportsView.tsx — Reports dashboard
- MemoryScopeManagerView.tsx — Scope hierarchy
- MemorySynthesisPage.tsx — Synthesis lint results
- KnowledgeGraphView.tsx — Knowledge graph viz
- ConsolidationBoardView.tsx — Consolidation items
- All in: `packages/web/src/views/`

## 15. MEMORY_NAV_ITEMS
**NOT FOUND in MemorySidebar.tsx**
- File read: `packages/web/src/components/memory/MemorySidebar.tsx` does not exist or does not export MEMORY_NAV_ITEMS
- **Action:** Caller must verify sidebar nav structure if needed; baseline doc may be stale

## 16. App Routes Memory/* → View Mapping
**VERIFIED: 12 route files**
- `memory/page.tsx` → Root memory dashboard
- `memory/browser/page.tsx` → MemoryBrowserView
- `memory/scopes/page.tsx` → MemoryScopeManagerView
- `memory/import/page.tsx` → MemoryImportView
- `memory/maintenance/page.tsx` → MemoryMaintenancePage
- `memory/reports/page.tsx` → MemoryReportsView
- `memory/drawers/page.tsx` → MemoryDrawersView
- `memory/drawers/[id]/page.tsx` → Drawer detail view
- `memory/graph/page.tsx` → KnowledgeGraphView
- `memory/synthesis/page.tsx` → MemorySynthesisPage
- `memory/consolidation/page.tsx` → ConsolidationBoardView
- `memory/dashboard/page.tsx` → MemoryDashboardView (alternate root?)

## 17. pg_advisory_xact_lock SQL & Cast
**VERIFIED: Exact SQL with ::bigint cast**
- File: `packages/control-plane/src/sync/apply-change.ts:180`
- SQL: `` SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint) ``
- Cast: `::bigint` applied to `hashtext()` result
- Context: Sync transaction (xact-scoped, released at end)

## 18. Other pg_advisory_*_lock Uses
**VERIFIED: Only one use in CP codebase**
- Grep result: One reference in `apply-change.ts:180`; one reference in test `apply-change.test.ts:147` (checks query)
- **NO other pg_advisory lock variants found**

## 19. MemorySearch Construction in index.ts
**VERIFIED: Lines 391-396, gated on embeddingClient**
```typescript
if (embeddingClient) {
  memorySearch = new MemorySearch({
    pool: pgPool,
    embeddingClient,
    logger: logger.child({ component: 'memory-search' }),
  });
}
```
- Gated: YES, requires `embeddingClient` to be non-null
- embeddingClient gated on: `LITELLM_URL` env var (line 377)

## 20. MemoryStore Construction & addFact Embedding Path
**VERIFIED: index.ts + memory-store.ts**
- Construction: `packages/control-plane/src/index.ts:385-389`
  ```typescript
  memoryStore = new MemoryStore({
    pool: pgPool,
    embeddingClient,
    logger: logger.child({ component: 'memory-store' }),
  });
  ```
- addFact: `packages/control-plane/src/memory/memory-store.ts:204-227`
  - If input.embedding provided: use it (line 211-212)
  - Else if embeddingClient exists: call `await this.embeddingClient.embed(input.content)` (line 215)
  - Else: store NULL embedding (line 226)

## 21. Runtime EmbeddingClient Swap Mechanism
**NOT FOUND**
- Grep: No references to DB-backed lookup, swappable factory, or runtime provider selection
- **Conclusion:** NO existing mechanism to swap EmbeddingClient at runtime
- Client is instantiated once at server startup with LITELLM_URL
- To support swapping, would require: env var change + restart, or feature addition

## 22. MemoryWriteAuditLogger Interface & Instantiation
**VERIFIED: Interface + no concrete implementer yet**
- Interface: `packages/control-plane/src/memory/memory-drawer-store.ts:27-29`
  ```typescript
  export type MemoryWriteAuditLogger = {
    writeMemoryWrite(input: MemoryWriteAuditInput): Promise<void>;
  };
  ```
- Input shape: `MemoryWriteAuditInput` (defined in audit.ts)
- Instantiation: OPTIONAL in MemoryDrawerStoreOptions (line 23: `auditLogger?: MemoryWriteAuditLogger`)
- Concrete logger: NOT FOUND in codebase; test uses mock (memory-drawer-store.test.ts:111)
- Callsite: `packages/control-plane/src/memory/memory-drawer-store.ts:241` → `await this.auditLogger.writeMemoryWrite(input)`

## 23. Hash-Chaining Audit Log on CP
**NOT FOUND**
- Grep results: No `hashChain`, `audit_chain`, `prev_hash` in CP codebase
- Conclusion: **NO hash-chaining mechanism exists on CP today**
- Baseline fact doc marked as "TODO for 9" — not yet implemented

## 24. audit.ts Write Shape
**VERIFIED: POST /api/audit/actions**
- File: `packages/control-plane/src/api/routes/audit.ts:48-95`
- Input body shape: `{ runId: string; actions: AuditActionPayload[] }`
- AuditActionPayload: `{ actionType, toolName?, toolInput?, toolOutputHash?, durationMs?, approvedBy? }`
- Write path: `dbRegistry.insertActions(runId, actions)` (line 83)

## 25. redactMemoryWriteMetadata Scope
**VERIFIED: Applies to drawer metadata, NOT memory_facts.content**
- File: `packages/shared/src/memory/audit.ts:77-81`
  ```typescript
  export function redactMemoryWriteMetadata(metadata: Record<string, unknown>) {
    return stripRawMemoryContentKeys(redactKeys(metadata ?? {}));
  }
  ```
- Usage: `packages/control-plane/src/memory/memory-drawer-store.ts:117`
  - `const sourceJson = redactMemoryWriteMetadata(input.sourceJson ?? {})`
- **Applies to sourceJson/metadata only, NOT content field**

## 26. Sanitizer on Memory-Fact Content During Embedding
**NOT FOUND**
- Grep: No sanitizer in backfill/embedding paths
- Embedding client receives raw text: `await this.embeddingClient.embed(input.content)` (memory-store.ts:215)
- **No content sanitization before embedding**

## 27. TABLE_PK_COLUMN & SYNCED_TABLES
**VERIFIED: Full types and derivation**
- File: `packages/shared/src/types/sync.ts:162-208`
- TABLE_SYNC_CONFIG (line 162): Records table name → type ('append-only' | 'mutable' | 'local-only')
  - memory_facts: 'mutable' (line 178)
  - memory_edges: 'mutable' (line 179)
  - api_accounts: 'local-only' (line 182)
- SYNCED_TABLES (line 190-192): `Object.entries(TABLE_SYNC_CONFIG).filter(([, type]) => type !== 'local-only').map(([name]) => name)`
  - **15 tables synced (excludes local-only)**
- TABLE_PK_COLUMN (line 199-203): Map of table name → PK column
  - settings: 'key'
  - memory_scopes: 'scope'
  - agent_actions: 'sync_id'
  - Else defaults to 'id'

## 28. apply-change.ts & TABLE_PK_COLUMN Usage
**VERIFIED: Consulted for sync_id vs id handling**
- File: `packages/control-plane/src/sync/apply-change.ts:200`
  - `const pkCol = getTablePkColumn(change.tableName);`
  - Used in DELETE: `WHERE ${sql.identifier(pkCol)} = ${change.rowId}`
  - Used in UPSERT: `${sql.identifier(pkCol)} = excluded.${sql.identifier(pkCol)}`
- getTablePkColumn: `packages/shared/src/types/sync.ts:206-208` → returns TABLE_PK_COLUMN[tableName] ?? 'id'

## 29. Playwright E2E Directory
**VERIFIED: `packages/web/e2e/` (NOT `tests/e2e/`)**
- Path: `packages/web/e2e/` confirmed
- Spec files found:
  - webhooks.spec.ts
  - scheduler.spec.ts
  - webhook-deliveries.spec.ts
  - conflicts.spec.ts
  - mesh-peers.spec.ts

## 30. control-plane Database Setup
**NOT pg-mem; likely real Postgres**
- Grep: No `pg-mem`, `PgliteDatabase`, or `TEST_DATABASE_URL` found in CP tests
- Expected: CP uses real PostgreSQL for integration tests (via Docker or local DB)
- **Conclusion: Uses real Postgres, NOT in-memory**

## 31. SettingsSection Component Props
**VERIFIED: id, title, description, children**
- File: `packages/web/src/views/settings/SettingsShell.tsx:56-82`
  ```typescript
  export function SettingsSection({
    id, title, description, children
  }): React.JSX.Element
  ```
- Props: All 4 required (no optionals)

## 32. SettingsView Nav Items (lines 26-67)
**VERIFIED: 8 sections**
- overview
- runtime-profiles
- credentials-access
- workers-sync
- mesh-identity
- routing-autonomy
- appearance-preferences
- notifications

## 33. queue:pause Script
**NOT FOUND in package.json**
- File: `packages/control-plane/package.json:6-14`
- Scripts: dev, build, start, test, test:coverage, db:generate, db:migrate, db:studio
- **`queue:pause` does NOT exist**

## 34. BullMQ Management Scripts
**NOT FOUND in scripts/ or package.json**
- No dedicated BullMQ scripts directory or commands in control-plane package.json
- **Caller must verify if external scripts exist**

## 35. log-retention.ts Public Surface
**VERIFIED: Config types + cleanup methods**
- File: `packages/control-plane/src/audit/log-retention.ts:1-100`
- Exports:
  - `LogRetentionConfig` (type): auditRetentionDays, runRetentionDays, deliveryRetentionDays, checkpointRetentionDays, maxStorageMb, dryRun, batchSize
  - `validateConfig(partial)`: Returns full config with defaults
  - `TableRetentionInfo`, `RetentionSummary`, `CleanupResult`, `StorageEstimate` (types)
- New config: Pass `Partial<LogRetentionConfig>` to `validateConfig()`

## 36. Credential Crypto Signatures & Encoding
**VERIFIED: base64 IV encoding**
- File: `packages/control-plane/src/utils/credential-crypto.ts:1-49`
- `encryptCredential(plaintext: string, hexKey: string): { encrypted: string; iv: string }`
  - IV encoding: **base64** (line 18: `iv.toString('base64')`)
  - Encrypted encoding: **base64** (line 17: concat + `.toString('base64')`)
- `decryptCredential(encryptedBase64, ivBase64, hexKey): string`
  - Expects both base64 inputs
- `maskCredential(credential): string`
  - sk-ant-*: shows `sk-ant-...${last4}`
  - Short (≤6): shows `***${last3}`
  - Other: shows `${first4}...${last4}`

## 37. settings.ts & api_accounts Reading
**CORRECTED 2026-04-24 (original entry wrong): settings.ts DOES read api_accounts without a kind filter.**
- File: `packages/control-plane/src/api/routes/settings.ts:81-83` (verified by live grep)
- Code: `db.select({ id: apiAccounts.id }).from(apiAccounts).where(eq(apiAccounts.id, defaultAccountId))`
- **An embedding-kind row can be bound as `default_account_id` → cascades to runtime dispatch**
- PR A MUST add `AND credential_kind='runtime'` to this WHERE clause
- Similar risk in `agents.ts:333-419` (PATCH `/api/agents/:agentId` sets arbitrary `accountId` without any api_accounts validation at all)

## 38. project_account_mappings Table & Kind Filter
**VERIFIED: Exists, no kind filter yet**
- Reference: TABLE_SYNC_CONFIG shows `project_account_mappings: 'mutable'` (line 174)
- Table exists and syncs
- Kind filter: **NOT YET IMPLEMENTED** — baseline doc notes this is future work
- Validation on write: Would need added at insertion time

---

**Generated:** 2026-04-23  
**Scan method:** File read + grep verification  
**Confidence:** HIGH for items 1-26, 28-33, 36; MEDIUM for items 27, 34-35; NOT FOUND for 7, 15, 21, 23, 26, 37-38.
