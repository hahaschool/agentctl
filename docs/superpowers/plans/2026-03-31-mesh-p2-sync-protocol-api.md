# Mesh P2: Sync Protocol + API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement pull-based sync between mesh peers: pulling changes via cursor-based pagination, auto-merging append-only rows, applying mutable changes with vector clock comparison, and detecting conflicts.

**Architecture:** Each node pulls changes from each reachable peer via `GET /api/sync/changes?since=<cursor>`. Append-only rows are deduplicated by PK. Mutable rows use vcCompare — remote-dominates applies, conflicts are recorded. All applies use `withSyncApplyGuard` + advisory locks. Cursors tracked in `sync_peer_cursors`.

**Tech Stack:** Fastify (routes), Drizzle ORM (queries), Ed25519 auth (X-Sync-Auth header), Vitest

**Spec:** `docs/superpowers/specs/2026-03-31-mesh-p2-sync-protocol-api-design.md` (v3)
**Depends on:** P1 (change log + vclock), P4 (peer registry + cursors + auth)

---

### Task 1: Sync Auth Middleware

**Files:**
- Create: `packages/control-plane/src/sync/sync-auth.ts`
- Create: `packages/control-plane/src/sync/sync-auth.test.ts`

- [ ] **Step 1: Write tests for verifying signed sync requests**

```typescript
import { describe, expect, it } from 'vitest';
import { createSyncAuthHeader, verifySyncAuth } from './sync-auth.js';

describe('sync auth', () => {
  it('creates and verifies a valid auth header', () => {
    // Use test key pair
    const { header, machineId } = createSyncAuthHeader({
      machineId: 'test-node',
      method: 'GET',
      path: '/api/sync/changes',
      body: '',
      secretKey: TEST_SECRET_KEY,
    });
    const result = verifySyncAuth(header, {
      method: 'GET',
      path: '/api/sync/changes',
      body: '',
      knownPeers: { 'test-node': TEST_PUBLIC_KEY },
    });
    expect(result.valid).toBe(true);
    expect(result.machineId).toBe('test-node');
  });

  it('rejects expired requests (>60s)', () => { /* ... */ });
  it('rejects unknown machineId', () => { /* ... */ });
  it('rejects tampered body', () => { /* ... */ });
});
```

- [ ] **Step 2: Implement sync-auth.ts** — creates `X-Sync-Auth` header with `{ machineId, method, path, bodyHash, issuedAt, nonce, signature }`. Verifies against known peer public keys. Rejects >60s stale. Nonce replay via in-memory LRU Set (10,000 cap).

- [ ] **Step 3: Tests pass, build, commit**

---

### Task 2: Sync API Routes

**Files:**
- Create: `packages/control-plane/src/api/routes/sync.ts`
- Modify: `packages/control-plane/src/api/server.ts`

- [ ] **Step 1: Create route plugin**

```typescript
// GET /api/sync/changes?since=<cursor>&limit=500
// Returns: { changes: ChangeLogEntry[], cursor: number, hasMore: boolean }
// Auth: X-Sync-Auth header verified via sync-auth middleware

// POST /api/sync/ack
// Body: { machineId: string, cursor: number }
// Updates sync_peer_cursors.acked_cursor for the calling peer
```

GET handler queries `sync_change_log WHERE id > since ORDER BY id ASC LIMIT limit+1` (fetch one extra to detect hasMore).

POST /ack handler:
```sql
INSERT INTO sync_peer_cursors (local_node_id, remote_node_id, acked_cursor, updated_at)
VALUES ({selfId}, {remoteMachineId}, {cursor}, now())
ON CONFLICT (local_node_id, remote_node_id) DO UPDATE SET
  acked_cursor = GREATEST(sync_peer_cursors.acked_cursor, EXCLUDED.acked_cursor),
  updated_at = now();
```

- [ ] **Step 2: Register in server.ts** — `await app.register(syncRoutes, { prefix: '/api/sync', db });`
- [ ] **Step 3: Build + commit**

---

### Task 3: Change Apply Logic

**Files:**
- Create: `packages/control-plane/src/sync/apply-change.ts`
- Create: `packages/control-plane/src/sync/apply-change.test.ts`

- [ ] **Step 1: Write tests**

```typescript
describe('applyAppendOnly', () => {
  it('inserts new row when PK does not exist', () => { /* ... */ });
  it('skips when PK already exists', () => { /* ... */ });
});

describe('applyMutable', () => {
  it('applies when remote vclock dominates local', () => { /* ... */ });
  it('skips when local vclock dominates remote', () => { /* ... */ });
  it('skips when clocks are equal', () => { /* ... */ });
  it('creates conflict when clocks are incomparable', () => { /* ... */ });
  it('handles DELETE operation', () => { /* ... */ });
});
```

- [ ] **Step 2: Implement apply-change.ts**

```typescript
import { TABLE_SYNC_CONFIG, TABLE_PK_COLUMN, getTablePkColumn } from '@agentctl/shared';
import { vcCompare, vcMerge } from '@agentctl/shared';
import { withSyncApplyGuard } from './apply-guard.js';

export async function applyChange(change: ChangeLogEntry, db: Database): Promise<'applied' | 'skipped' | 'conflict'> {
  const tableType = TABLE_SYNC_CONFIG[change.tableName];
  if (!tableType || tableType === 'local-only') return 'skipped';

  if (tableType === 'append-only') return applyAppendOnly(change, db);
  return applyMutable(change, db);
}

async function applyAppendOnly(change: ChangeLogEntry, db: Database): Promise<'applied' | 'skipped'> {
  const pkCol = getTablePkColumn(change.tableName);
  // Check if row exists
  const existing = await db.execute(
    sql`SELECT 1 FROM ${sql.identifier(change.tableName)} WHERE ${sql.identifier(pkCol)} = ${change.rowId} LIMIT 1`
  );
  if (extractRows(existing).length > 0) return 'skipped';

  // INSERT inside guard
  await withSyncApplyGuard(db, async (tx) => {
    // Dynamic INSERT from payload
    await tx.execute(buildInsertFromPayload(change.tableName, change.payload!));
    // Record in local change log with remote vclock
    await tx.execute(sql`INSERT INTO sync_change_log ...`);
  });
  return 'applied';
}

async function applyMutable(change: ChangeLogEntry, db: Database): Promise<'applied' | 'skipped' | 'conflict'> {
  // Advisory lock
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${change.tableName + ':' + change.rowId})::bigint)`);

  // Get local vclock
  const localEntry = await getLatestChangeLogEntry(db, change.tableName, change.rowId);
  const localVclock = localEntry?.vclock ?? {};

  const comparison = vcCompare(change.vclock, localVclock);

  if (comparison === 'a_dominates') {
    // Remote is newer — apply
    await withSyncApplyGuard(db, async (tx) => {
      if (change.operation === 'DELETE') {
        await tx.execute(sql`DELETE FROM ${sql.identifier(change.tableName)} WHERE ${sql.identifier(getTablePkColumn(change.tableName))} = ${change.rowId}`);
      } else {
        await tx.execute(buildUpsertFromPayload(change.tableName, change.payload!));
      }
      // Write merged vclock
      const merged = vcMerge(change.vclock, localVclock);
      await tx.execute(sql`INSERT INTO sync_change_log (node_id, table_name, row_id, operation, payload, vclock)
        VALUES (${change.nodeId}, ${change.tableName}, ${change.rowId}, ${change.operation}, ${change.payload}, ${JSON.stringify(merged)}::jsonb)`);
    });
    return 'applied';
  }

  if (comparison === 'conflict') {
    // Record conflict
    await db.execute(sql`INSERT INTO sync_conflicts (table_name, row_id, local_vclock, local_payload, remote_vclock, remote_payload, remote_node_id)
      VALUES (${change.tableName}, ${change.rowId}, ${JSON.stringify(localVclock)}::jsonb, ${JSON.stringify(localEntry?.payload)}::jsonb,
              ${JSON.stringify(change.vclock)}::jsonb, ${JSON.stringify(change.payload)}::jsonb, ${change.nodeId})`);
    return 'conflict';
  }

  return 'skipped'; // b_dominates or equal
}
```

- [ ] **Step 3: Tests pass, build, commit**

---

### Task 4: Sync Loop

**Files:**
- Create: `packages/control-plane/src/sync/sync-loop.ts`

- [ ] **Step 1: Implement per-peer sync loop**

```typescript
export async function syncFromPeer(opts: {
  db: Database;
  selfMachineId: string;
  peer: { id: string; syncUrl: string; publicKey: string };
  secretKey: string;
  logger: Logger;
}): Promise<{ applied: number; conflicts: number; errors: number }> {
  const { db, selfMachineId, peer, secretKey, logger } = opts;
  let cursor = await getPulledCursor(db, selfMachineId, peer.id);
  let applied = 0, conflicts = 0, errors = 0;

  while (true) {
    const authHeader = createSyncAuthHeader({
      machineId: selfMachineId, method: 'GET',
      path: `/api/sync/changes?since=${cursor}&limit=500`,
      body: '', secretKey,
    });

    const resp = await fetch(`${peer.syncUrl}/api/sync/changes?since=${cursor}&limit=500`, {
      headers: { 'X-Sync-Auth': authHeader.header },
      signal: AbortSignal.timeout(30_000),
    });

    if (!resp.ok) { errors++; break; }
    const data = await resp.json() as { changes: ChangeLogEntry[]; cursor: number; hasMore: boolean };

    for (const change of data.changes) {
      try {
        const result = await applyChange(change, db);
        if (result === 'applied') applied++;
        if (result === 'conflict') conflicts++;
      } catch (err) {
        logger.warn({ err, changeId: change.id }, 'Failed to apply sync change');
        errors++;
        break; // Stop batch on error, retry from last cursor
      }
    }

    cursor = data.cursor;
    await updatePulledCursor(db, selfMachineId, peer.id, cursor);

    // ACK to peer
    await fetch(`${peer.syncUrl}/api/sync/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sync-Auth': /* signed */ '' },
      body: JSON.stringify({ machineId: selfMachineId, cursor }),
    });

    if (!data.hasMore) break;
  }

  return { applied, conflicts, errors };
}
```

- [ ] **Step 2: Add startSyncLoops** — iterates all reachable peers at their sync_interval_ms, calls syncFromPeer
- [ ] **Step 3: Build + commit**

---

### Task 5: Synced Marker Update

**Files:**
- Modify: `packages/control-plane/src/sync/change-log-cleanup.ts`

- [ ] **Step 1: Add markSyncedEntries function**

Called after each peer ACK cycle:

```typescript
export async function markSyncedEntries(db: Database, selfMachineId: string): Promise<number> {
  const result = await db.execute(sql`
    UPDATE sync_change_log SET synced = true
    WHERE id <= (
      SELECT COALESCE(MIN(acked_cursor), 0)
      FROM sync_peer_cursors
      WHERE local_node_id = ${selfMachineId}
    )
    AND synced = false
    RETURNING id
  `);
  return extractRows(result).length;
}
```

- [ ] **Step 2: Build + commit**

---

### Task 6: Wire into Startup

- [ ] **Step 1: Start sync loops in index.ts** (after peer discovery/health are running)
- [ ] **Step 2: Cleanup on shutdown**
- [ ] **Step 3: Build + commit**

---

### Task 7: Push + PR

```bash
git push -u origin agent/claude/feat/mesh-p2-sync-protocol
gh pr create --base main --title "feat(mesh): P2 — sync protocol + API (§33.2)"
```
