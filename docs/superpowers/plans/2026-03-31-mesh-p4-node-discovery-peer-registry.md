# Mesh P4: Node Discovery + Peer Registry — Implementation Plan (v2, aligned with spec v3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make mesh nodes aware of each other via Tailscale auto-discovery, peer health checking, peer authentication, and a REST API for peer management.

**Architecture:** Extend `sync_nodes` with peer-specific columns (sync_url, sync_status, public_key). Add `sync_peer_cursors` table for bidirectional cursor tracking. Discovery runs `tailscale status --json` → `/health` to resolve machineId. Health checks ping peers adaptively. Ed25519 peer auth reuses dispatch signing. REST API provides CRUD.

**Tech Stack:** PostgreSQL (schema), Fastify (routes), Tailscale CLI, Ed25519 (peer auth), Vitest (tests), React + TanStack Query (frontend)

**Spec:** `docs/superpowers/specs/2026-03-31-mesh-p4-node-discovery-peer-registry-design.md` (v3)

---

### Task 1: Schema — Extend sync_nodes + Add sync_peer_cursors

**Files:**
- Modify: `packages/control-plane/src/db/schema.ts`
- Create: `packages/control-plane/drizzle/0022_mesh_peer_registry.sql`

- [ ] **Step 1: Update syncNodes Drizzle definition**

Add columns after `createdAt` in the `syncNodes` table (added by P1):

```typescript
  syncUrl: text('sync_url'),
  syncCursor: bigint('sync_cursor', { mode: 'number' }).default(0),
  syncStatus: text('sync_status').default('unknown'),
  syncIntervalMs: integer('sync_interval_ms').default(30000),
  isSelf: boolean('is_self').default(false),
  publicKey: text('public_key'),
```

Add new table after `syncConflicts`:

```typescript
export const syncPeerCursors = pgTable(
  'sync_peer_cursors',
  {
    localNodeId: text('local_node_id').notNull(),
    remoteNodeId: text('remote_node_id').notNull(),
    pulledCursor: bigint('pulled_cursor', { mode: 'number' }).default(0),
    ackedCursor: bigint('acked_cursor', { mode: 'number' }).default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    // Composite PK via unique index (Drizzle pgTable doesn't support composite PKs directly)
    index('idx_peer_cursors_pk').on(table.localNodeId, table.remoteNodeId),
  ],
);
```

- [ ] **Step 2: Create migration**

Create `packages/control-plane/drizzle/0022_mesh_peer_registry.sql`:

```sql
-- Mesh P4: Peer registry extensions
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS sync_url TEXT;
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS sync_cursor BIGINT DEFAULT 0;
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'unknown';
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS sync_interval_ms INTEGER DEFAULT 30000;
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS is_self BOOLEAN DEFAULT false;
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS public_key TEXT;

CREATE TABLE IF NOT EXISTS sync_peer_cursors (
  local_node_id   TEXT NOT NULL,
  remote_node_id  TEXT NOT NULL,
  pulled_cursor   BIGINT DEFAULT 0,
  acked_cursor    BIGINT DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (local_node_id, remote_node_id)
);
```

- [ ] **Step 3: Build + commit**

```bash
pnpm --filter @agentctl/control-plane build
git add packages/control-plane/src/db/schema.ts packages/control-plane/drizzle/0022_mesh_peer_registry.sql
git commit -m "feat(mesh-p4): extend sync_nodes + add sync_peer_cursors table"
```

---

### Task 2: Health Endpoint — Expose machineId + publicKey

**Files:**
- Modify: `packages/control-plane/src/api/routes/health.ts`

- [ ] **Step 1: Add machineId and publicKey to health response**

In `packages/control-plane/src/api/routes/health.ts`, the health route plugin needs access to machineId. Pass it via the route options or read from env:

In the handler function, add to the `base` response object:

```typescript
      const base = {
        status: anyError ? ('degraded' as const) : ('ok' as const),
        timestamp,
        uptime: process.uptime(),
        nodeVersion: process.version,
        memoryUsage,
        // Mesh identity for peer discovery
        machineId: process.env.MACHINE_ID ?? null,
        nodePublicKey: process.env.SYNC_PUBLIC_KEY ?? null,
      };
```

Update the `HealthResponse` type accordingly:

```typescript
type HealthResponse = {
  // ... existing fields ...
  machineId?: string | null;
  nodePublicKey?: string | null;
};
```

- [ ] **Step 2: Build + commit**

```bash
pnpm --filter @agentctl/control-plane build
git add packages/control-plane/src/api/routes/health.ts
git commit -m "feat(mesh-p4): expose machineId + nodePublicKey in /health response"
```

---

### Task 3: Tailscale Discovery Module

**Files:**
- Create: `packages/control-plane/src/sync/peer-discovery.ts`
- Create: `packages/control-plane/src/sync/peer-discovery.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/control-plane/src/sync/peer-discovery.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { parseTailscalePeers } from './peer-discovery.js';

const SAMPLE_STATUS = {
  Self: {
    TailscaleIPs: ['100.64.0.1'],
    HostName: 'youhane-lori',
    Online: true,
    Tags: ['tag:mesh-node'],
  },
  Peer: {
    'nodekey:abc': {
      TailscaleIPs: ['100.64.0.2'],
      HostName: 'ec2-worker',
      Online: true,
      Tags: ['tag:mesh-node'],
    },
    'nodekey:def': {
      TailscaleIPs: ['100.64.0.3'],
      HostName: 'mac-mini',
      Online: true,
      Tags: ['tag:worker'],
    },
    'nodekey:ghi': {
      TailscaleIPs: ['100.64.0.4'],
      HostName: 'laptop',
      Online: false,
      Tags: ['tag:mesh-node'],
    },
  },
};

describe('parseTailscalePeers', () => {
  it('extracts only online peers with tag:mesh-node', () => {
    const peers = parseTailscalePeers(SAMPLE_STATUS);
    expect(peers).toHaveLength(1);
    expect(peers[0]).toEqual({ hostname: 'ec2-worker', tailscaleIp: '100.64.0.2' });
  });

  it('excludes non-mesh-node tags', () => {
    const peers = parseTailscalePeers(SAMPLE_STATUS);
    expect(peers.find((p) => p.hostname === 'mac-mini')).toBeUndefined();
  });

  it('excludes offline peers', () => {
    const peers = parseTailscalePeers(SAMPLE_STATUS);
    expect(peers.find((p) => p.hostname === 'laptop')).toBeUndefined();
  });

  it('returns empty for no peers', () => {
    expect(parseTailscalePeers({ Self: { TailscaleIPs: [], HostName: 'x', Online: true }, Peer: {} })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests — expected FAIL**
- [ ] **Step 3: Implement**

Create `packages/control-plane/src/sync/peer-discovery.ts`:

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';

const execFileAsync = promisify(execFile);
const TAILSCALE_TIMEOUT_MS = 5_000;
const DEFAULT_CP_PORT = 8080;
const HEALTH_TIMEOUT_MS = 5_000;

type TailscalePeer = { hostname: string; tailscaleIp: string };

type TailscaleStatus = {
  Self: { TailscaleIPs: string[]; HostName: string; Online: boolean; Tags?: string[] };
  Peer: Record<string, { TailscaleIPs: string[]; HostName: string; Online: boolean; Tags?: string[] }>;
};

export function parseTailscalePeers(status: TailscaleStatus): TailscalePeer[] {
  const peers: TailscalePeer[] = [];
  for (const peer of Object.values(status.Peer)) {
    if (!peer.Online) continue;
    if (!peer.Tags?.includes('tag:mesh-node')) continue;
    const ip = peer.TailscaleIPs?.[0];
    if (ip) peers.push({ hostname: peer.HostName, tailscaleIp: ip });
  }
  return peers;
}

async function fetchTailscalePeers(logger: Logger): Promise<TailscalePeer[]> {
  try {
    const { stdout } = await execFileAsync('tailscale', ['status', '--json'], { timeout: TAILSCALE_TIMEOUT_MS });
    return parseTailscalePeers(JSON.parse(stdout));
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : String(err) }, 'Tailscale discovery failed');
    return [];
  }
}

async function resolvePeerMachineId(syncUrl: string): Promise<{ machineId: string; publicKey: string | null } | null> {
  try {
    const resp = await fetch(`${syncUrl}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    if (!resp.ok) return null;
    const data = await resp.json() as { machineId?: string; nodePublicKey?: string };
    if (!data.machineId) return null;
    return { machineId: data.machineId, publicKey: data.nodePublicKey ?? null };
  } catch {
    return null;
  }
}

async function upsertPeer(db: Database, peer: {
  machineId: string; hostname: string; tailscaleIp: string; syncUrl: string; publicKey: string | null;
}): Promise<void> {
  await db.execute(
    sql`INSERT INTO sync_nodes (id, hostname, tailscale_ip, sync_url, public_key, sync_status, role)
        VALUES (${peer.machineId}, ${peer.hostname}, ${peer.tailscaleIp}, ${peer.syncUrl}, ${peer.publicKey}, 'unknown', 'full')
        ON CONFLICT (id) DO UPDATE SET
          tailscale_ip = EXCLUDED.tailscale_ip,
          sync_url = EXCLUDED.sync_url,
          public_key = COALESCE(EXCLUDED.public_key, sync_nodes.public_key)`,
  );
}

export function startDiscoveryLoop(opts: {
  db: Database; logger: Logger; cpPort?: number; intervalMs?: number;
}): { stop: () => void } {
  const { db, logger, cpPort = DEFAULT_CP_PORT, intervalMs = 60_000 } = opts;
  let timer: ReturnType<typeof setInterval> | null = null;

  const run = async (): Promise<void> => {
    const tsPeers = await fetchTailscalePeers(logger);
    for (const tsPeer of tsPeers) {
      const syncUrl = `http://${tsPeer.tailscaleIp}:${cpPort}`;
      const resolved = await resolvePeerMachineId(syncUrl);
      if (resolved) {
        await upsertPeer(db, { ...resolved, hostname: tsPeer.hostname, tailscaleIp: tsPeer.tailscaleIp, syncUrl });
        logger.debug({ machineId: resolved.machineId, hostname: tsPeer.hostname }, 'Discovered mesh peer');
      }
    }
  };

  void run();
  timer = setInterval(() => void run(), intervalMs);
  return { stop: () => { if (timer) clearInterval(timer); } };
}
```

- [ ] **Step 4: Run tests — expected PASS (4 tests)**
- [ ] **Step 5: Build + commit**

```bash
git add packages/control-plane/src/sync/peer-discovery.ts packages/control-plane/src/sync/peer-discovery.test.ts
git commit -m "feat(mesh-p4): add Tailscale peer discovery with /health machineId resolution"
```

---

### Task 4: Peer Health Check

**Files:**
- Create: `packages/control-plane/src/sync/peer-health.ts`
- Create: `packages/control-plane/src/sync/peer-health.test.ts`

- [ ] **Step 1: Write tests for computeNextInterval**

```typescript
import { describe, expect, it } from 'vitest';
import { computeNextInterval } from './peer-health.js';

describe('computeNextInterval', () => {
  it('keeps default on reachable', () => {
    expect(computeNextInterval(30000, 'reachable')).toBe(30000);
  });
  it('doubles on unreachable (capped at 300000)', () => {
    expect(computeNextInterval(30000, 'unreachable')).toBe(60000);
    expect(computeNextInterval(150000, 'unreachable')).toBe(300000);
    expect(computeNextInterval(300000, 'unreachable')).toBe(300000);
  });
  it('resets on reachable after backoff', () => {
    expect(computeNextInterval(120000, 'reachable')).toBe(30000);
  });
});
```

- [ ] **Step 2: Implement peer-health.ts** with `computeNextInterval`, `healthCheckAllPeers`, `startHealthCheckLoop` (same structure as v1 plan)
- [ ] **Step 3: Run tests — PASS**
- [ ] **Step 4: Build + commit**

---

### Task 5: Sync Peers REST API

**Files:**
- Create: `packages/control-plane/src/api/routes/sync-peers.ts`
- Modify: `packages/control-plane/src/api/server.ts`

- [ ] **Step 1: Create route plugin** — `GET /`, `POST /`, `DELETE /:machineId`, `POST /:machineId/ping`
- [ ] **Step 2: Register in server.ts** — `await app.register(syncPeersRoutes, { prefix: '/api/sync/peers', db });`
- [ ] **Step 3: Build + commit**

---

### Task 6: Wire into Startup + Frontend

- [ ] **Step 1: Start discovery + health loops in index.ts** (with cleanup in shutdown handler)
- [ ] **Step 2: Add API methods to web/src/lib/api.ts** (listSyncPeers, addSyncPeer, removeSyncPeer, pingSyncPeer)
- [ ] **Step 3: Add MeshPeersSection component** to MachinesPage
- [ ] **Step 4: Build all packages + commit**

---

### Task 7: Push + PR

```bash
git push -u origin agent/claude/feat/mesh-p4-peer-registry
gh pr create --base main --title "feat(mesh): P4 — node discovery + peer registry (§33.4)"
```
