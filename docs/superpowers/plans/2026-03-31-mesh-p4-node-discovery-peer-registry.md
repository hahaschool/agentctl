# Mesh P4: Node Discovery + Peer Registry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mesh nodes aware of each other via Tailscale auto-discovery, peer health checking, and a REST API for peer management.

**Architecture:** Extend `sync_nodes` with peer-specific columns. A discovery loop queries `tailscale status --json` every 60s. A health check loop pings each peer's `/health` endpoint at an adaptive interval (30s default, backoff to 5min on failure). REST endpoints provide CRUD for manual peer management. Frontend shows peers on the Machines page.

**Tech Stack:** PostgreSQL (schema), Fastify (routes), Tailscale CLI, Vitest (tests), React + TanStack Query (frontend)

**Spec:** `docs/superpowers/specs/2026-03-31-mesh-p4-node-discovery-peer-registry-design.md`

---

### Task 1: Extend sync_nodes Schema + Migration

**Files:**
- Modify: `packages/control-plane/src/db/schema.ts`
- Create: `packages/control-plane/drizzle/0022_mesh_peer_registry.sql`

- [ ] **Step 1: Add new columns to syncNodes Drizzle definition**

In `packages/control-plane/src/db/schema.ts`, update the `syncNodes` table (added in P1) to include:

```typescript
export const syncNodes = pgTable('sync_nodes', {
  id: text('id').primaryKey(),
  hostname: text('hostname').notNull(),
  tailscaleIp: text('tailscale_ip'),
  role: text('role').notNull().default('full'),
  lastSeen: timestamp('last_seen', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // P4 additions:
  syncUrl: text('sync_url'),                       // e.g. http://100.64.0.2:8080
  syncCursor: bigint('sync_cursor', { mode: 'number' }).default(0),
  syncStatus: text('sync_status').default('unknown'), // reachable | unreachable | unknown
  syncIntervalMs: integer('sync_interval_ms').default(30000),
  isSelf: boolean('is_self').default(false),
});
```

- [ ] **Step 2: Create migration**

Create `packages/control-plane/drizzle/0022_mesh_peer_registry.sql`:

```sql
-- Mesh P4: Peer registry extensions to sync_nodes
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS sync_url TEXT;
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS sync_cursor BIGINT DEFAULT 0;
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'unknown';
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS sync_interval_ms INTEGER DEFAULT 30000;
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS is_self BOOLEAN DEFAULT false;
```

- [ ] **Step 3: Build + commit**

Run: `pnpm --filter @agentctl/control-plane build`

```bash
git add packages/control-plane/src/db/schema.ts packages/control-plane/drizzle/0022_mesh_peer_registry.sql
git commit -m "feat(mesh): extend sync_nodes with peer registry columns (P4)"
```

---

### Task 2: Tailscale Discovery Module

**Files:**
- Create: `packages/control-plane/src/sync/peer-discovery.ts`
- Create: `packages/control-plane/src/sync/peer-discovery.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/control-plane/src/sync/peer-discovery.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { parseTailscalePeers } from './peer-discovery.js';

const SAMPLE_TAILSCALE_STATUS = {
  Self: {
    TailscaleIPs: ['100.64.0.1'],
    HostName: 'youhane-lori',
    Online: true,
    Tags: ['tag:mesh-node'],
  },
  Peer: {
    'nodekey:abc123': {
      TailscaleIPs: ['100.64.0.2'],
      HostName: 'ec2-worker',
      Online: true,
      Tags: ['tag:mesh-node'],
    },
    'nodekey:def456': {
      TailscaleIPs: ['100.64.0.3'],
      HostName: 'mac-mini',
      Online: true,
      Tags: ['tag:worker'], // NOT a mesh node
    },
    'nodekey:ghi789': {
      TailscaleIPs: ['100.64.0.4'],
      HostName: 'laptop',
      Online: false,
      Tags: ['tag:mesh-node'],
    },
  },
};

describe('parseTailscalePeers', () => {
  it('extracts only online peers with tag:mesh-node', () => {
    const peers = parseTailscalePeers(SAMPLE_TAILSCALE_STATUS);
    expect(peers).toEqual([
      { hostname: 'ec2-worker', tailscaleIp: '100.64.0.2' },
    ]);
  });

  it('excludes self from peers', () => {
    const peers = parseTailscalePeers(SAMPLE_TAILSCALE_STATUS);
    expect(peers.find((p) => p.hostname === 'youhane-lori')).toBeUndefined();
  });

  it('excludes peers without mesh-node tag', () => {
    const peers = parseTailscalePeers(SAMPLE_TAILSCALE_STATUS);
    expect(peers.find((p) => p.hostname === 'mac-mini')).toBeUndefined();
  });

  it('excludes offline peers', () => {
    const peers = parseTailscalePeers(SAMPLE_TAILSCALE_STATUS);
    expect(peers.find((p) => p.hostname === 'laptop')).toBeUndefined();
  });

  it('returns empty array for no peers', () => {
    expect(parseTailscalePeers({ Self: { TailscaleIPs: ['100.64.0.1'], HostName: 'solo', Online: true, Tags: [] }, Peer: {} })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests — expected FAIL**

Run: `cd packages/control-plane && pnpm vitest run src/sync/peer-discovery.test.ts`

- [ ] **Step 3: Implement parseTailscalePeers and discoverPeers**

Create `packages/control-plane/src/sync/peer-discovery.ts`:

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { syncNodes } from '../db/schema.js';

const execFileAsync = promisify(execFile);
const TAILSCALE_TIMEOUT_MS = 5_000;
const DISCOVERY_INTERVAL_MS = 60_000;
const DEFAULT_CP_PORT = 8080;

type TailscalePeer = { hostname: string; tailscaleIp: string };

type TailscaleStatus = {
  Self: { TailscaleIPs: string[]; HostName: string; Online: boolean; Tags?: string[] };
  Peer: Record<string, { TailscaleIPs: string[]; HostName: string; Online: boolean; Tags?: string[] }>;
};

/** Parse tailscale status JSON to find online mesh-node peers (excluding self). */
export function parseTailscalePeers(status: TailscaleStatus): TailscalePeer[] {
  const peers: TailscalePeer[] = [];
  for (const peer of Object.values(status.Peer)) {
    if (!peer.Online) continue;
    if (!peer.Tags?.includes('tag:mesh-node')) continue;
    const ip = peer.TailscaleIPs?.[0];
    if (!ip) continue;
    peers.push({ hostname: peer.HostName, tailscaleIp: ip });
  }
  return peers;
}

/** Run `tailscale status --json` and parse peers. */
async function fetchTailscalePeers(logger: Logger): Promise<TailscalePeer[]> {
  try {
    const { stdout } = await execFileAsync('tailscale', ['status', '--json'], {
      timeout: TAILSCALE_TIMEOUT_MS,
    });
    const status: TailscaleStatus = JSON.parse(stdout);
    return parseTailscalePeers(status);
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : String(err) }, 'Tailscale discovery failed');
    return [];
  }
}

/** Upsert discovered peers into sync_nodes (additive — never removes). */
async function upsertDiscoveredPeers(
  db: Database,
  peers: TailscalePeer[],
  cpPort: number,
): Promise<void> {
  for (const peer of peers) {
    const syncUrl = `http://${peer.tailscaleIp}:${cpPort}`;
    await db.execute(
      sql`INSERT INTO sync_nodes (id, hostname, tailscale_ip, sync_url, sync_status, role)
          VALUES (${'node-' + peer.hostname}, ${peer.hostname}, ${peer.tailscaleIp}, ${syncUrl}, 'unknown', 'full')
          ON CONFLICT (id) DO UPDATE SET
            tailscale_ip = EXCLUDED.tailscale_ip,
            sync_url = EXCLUDED.sync_url`,
    );
  }
}

/** Start the Tailscale discovery loop. Returns a cleanup function. */
export function startDiscoveryLoop(opts: {
  db: Database;
  logger: Logger;
  cpPort?: number;
  intervalMs?: number;
}): { stop: () => void } {
  const { db, logger, cpPort = DEFAULT_CP_PORT, intervalMs = DISCOVERY_INTERVAL_MS } = opts;
  let timer: ReturnType<typeof setInterval> | null = null;

  const run = async (): Promise<void> => {
    const peers = await fetchTailscalePeers(logger);
    if (peers.length > 0) {
      await upsertDiscoveredPeers(db, peers, cpPort);
      logger.info({ peerCount: peers.length }, 'Tailscale peer discovery completed');
    }
  };

  // Run immediately, then on interval
  void run();
  timer = setInterval(() => void run(), intervalMs);

  return {
    stop: () => {
      if (timer) clearInterval(timer);
    },
  };
}
```

- [ ] **Step 4: Run tests — expected PASS (5 tests)**
- [ ] **Step 5: Build + commit**

```bash
git add packages/control-plane/src/sync/peer-discovery.ts packages/control-plane/src/sync/peer-discovery.test.ts
git commit -m "feat(mesh): add Tailscale peer discovery with parseTailscalePeers"
```

---

### Task 3: Peer Health Check Module

**Files:**
- Create: `packages/control-plane/src/sync/peer-health.ts`
- Create: `packages/control-plane/src/sync/peer-health.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/control-plane/src/sync/peer-health.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { computeNextInterval } from './peer-health.js';

describe('computeNextInterval', () => {
  it('returns default for first reachable check', () => {
    expect(computeNextInterval(30000, 'reachable')).toBe(30000);
  });

  it('doubles interval after unreachable (max 300000)', () => {
    expect(computeNextInterval(30000, 'unreachable')).toBe(60000);
    expect(computeNextInterval(60000, 'unreachable')).toBe(120000);
    expect(computeNextInterval(150000, 'unreachable')).toBe(300000);
    expect(computeNextInterval(300000, 'unreachable')).toBe(300000); // capped
  });

  it('resets to default on reachable after unreachable', () => {
    expect(computeNextInterval(120000, 'reachable')).toBe(30000);
  });
});
```

- [ ] **Step 2: Run tests — expected FAIL**
- [ ] **Step 3: Implement peer health check**

Create `packages/control-plane/src/sync/peer-health.ts`:

```typescript
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { syncNodes } from '../db/schema.js';

const DEFAULT_INTERVAL_MS = 30_000;
const MAX_INTERVAL_MS = 300_000;
const HEALTH_TIMEOUT_MS = 5_000;

export function computeNextInterval(
  currentMs: number,
  result: 'reachable' | 'unreachable',
): number {
  if (result === 'reachable') return DEFAULT_INTERVAL_MS;
  return Math.min(currentMs * 2, MAX_INTERVAL_MS);
}

type PeerRecord = {
  id: string;
  syncUrl: string | null;
  syncStatus: string | null;
  syncIntervalMs: number | null;
  isSelf: boolean | null;
};

/** Ping a peer's /health endpoint. Returns true if reachable. */
async function pingPeer(syncUrl: string): Promise<boolean> {
  try {
    const resp = await fetch(`${syncUrl}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/** Run one round of health checks for all non-self peers. */
export async function healthCheckAllPeers(
  db: Database,
  logger: Logger,
): Promise<void> {
  const peers = await db
    .select({
      id: syncNodes.id,
      syncUrl: syncNodes.syncUrl,
      syncStatus: syncNodes.syncStatus,
      syncIntervalMs: syncNodes.syncIntervalMs,
      isSelf: syncNodes.isSelf,
    })
    .from(syncNodes)
    .where(eq(syncNodes.isSelf, false));

  for (const peer of peers) {
    if (!peer.syncUrl) continue;

    const reachable = await pingPeer(peer.syncUrl);
    const newStatus = reachable ? 'reachable' : 'unreachable';
    const wasUnreachable = peer.syncStatus === 'unreachable';
    const nowReachable = reachable && wasUnreachable;
    const newInterval = computeNextInterval(peer.syncIntervalMs ?? DEFAULT_INTERVAL_MS, newStatus);

    await db
      .update(syncNodes)
      .set({
        syncStatus: newStatus,
        syncIntervalMs: newInterval,
        ...(reachable ? { lastSeen: new Date() } : {}),
      })
      .where(eq(syncNodes.id, peer.id));

    if (nowReachable) {
      logger.info({ peerId: peer.id }, 'Peer became reachable — will trigger catch-up sync');
      // P2 will hook into this transition to trigger immediate sync
    }
  }
}

/** Start the health check loop. Returns a cleanup function. */
export function startHealthCheckLoop(opts: {
  db: Database;
  logger: Logger;
  intervalMs?: number;
}): { stop: () => void } {
  const { db, logger, intervalMs = DEFAULT_INTERVAL_MS } = opts;
  let timer: ReturnType<typeof setInterval> | null = null;

  timer = setInterval(() => void healthCheckAllPeers(db, logger), intervalMs);

  return {
    stop: () => {
      if (timer) clearInterval(timer);
    },
  };
}
```

- [ ] **Step 4: Run tests — expected PASS (4 tests)**
- [ ] **Step 5: Build + commit**

```bash
git add packages/control-plane/src/sync/peer-health.ts packages/control-plane/src/sync/peer-health.test.ts
git commit -m "feat(mesh): add peer health check with adaptive interval backoff"
```

---

### Task 4: Sync Peers REST API

**Files:**
- Create: `packages/control-plane/src/api/routes/sync-peers.ts`
- Modify: `packages/control-plane/src/api/server.ts`

- [ ] **Step 1: Create route plugin**

Create `packages/control-plane/src/api/routes/sync-peers.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';

import { syncNodes } from '../../db/schema.js';
import type { Database } from '../../db/index.js';

type SyncPeersOpts = {
  db: Database;
};

export async function syncPeersRoutes(
  app: FastifyInstance,
  opts: SyncPeersOpts,
): Promise<void> {
  const { db } = opts;

  // List all peers
  app.get('/', async () => {
    const peers = await db.select().from(syncNodes);
    return { peers };
  });

  // Add a peer manually
  app.post<{
    Body: { hostname: string; syncUrl: string; tailscaleIp?: string };
  }>('/', async (request, reply) => {
    const { hostname, syncUrl, tailscaleIp } = request.body;
    const id = `node-${hostname.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 16)}`;

    await db.insert(syncNodes).values({
      id,
      hostname,
      syncUrl,
      tailscaleIp: tailscaleIp ?? null,
      role: 'full',
      syncStatus: 'unknown',
    }).onConflictDoUpdate({
      target: syncNodes.id,
      set: { hostname, syncUrl, tailscaleIp: tailscaleIp ?? null },
    });

    return reply.code(201).send({ id, hostname, syncUrl });
  });

  // Remove a peer
  app.delete<{ Params: { nodeId: string } }>('/:nodeId', async (request, reply) => {
    const { nodeId } = request.params;
    const deleted = await db.delete(syncNodes).where(eq(syncNodes.id, nodeId)).returning();
    if (deleted.length === 0) {
      return reply.code(404).send({ error: 'PEER_NOT_FOUND', message: `Peer '${nodeId}' not found` });
    }
    return { ok: true };
  });

  // Manual ping
  app.post<{ Params: { nodeId: string } }>('/:nodeId/ping', async (request, reply) => {
    const { nodeId } = request.params;
    const [peer] = await db.select().from(syncNodes).where(eq(syncNodes.id, nodeId));
    if (!peer?.syncUrl) {
      return reply.code(404).send({ error: 'PEER_NOT_FOUND', message: `Peer '${nodeId}' not found or has no sync URL` });
    }

    const start = Date.now();
    try {
      const resp = await fetch(`${peer.syncUrl}/health`, { signal: AbortSignal.timeout(5000) });
      const latencyMs = Date.now() - start;
      const reachable = resp.ok;

      await db.update(syncNodes).set({
        syncStatus: reachable ? 'reachable' : 'unreachable',
        ...(reachable ? { lastSeen: new Date() } : {}),
      }).where(eq(syncNodes.id, nodeId));

      return { reachable, latencyMs, statusCode: resp.status };
    } catch (err) {
      const latencyMs = Date.now() - start;
      await db.update(syncNodes).set({ syncStatus: 'unreachable' }).where(eq(syncNodes.id, nodeId));
      return { reachable: false, latencyMs, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
```

- [ ] **Step 2: Register routes in server.ts**

In `packages/control-plane/src/api/server.ts`, add import:

```typescript
import { syncPeersRoutes } from './routes/sync-peers.js';
```

And register after the existing route registrations:

```typescript
  await app.register(syncPeersRoutes, { prefix: '/api/sync/peers', db });
```

- [ ] **Step 3: Build + commit**

```bash
git add packages/control-plane/src/api/routes/sync-peers.ts packages/control-plane/src/api/server.ts
git commit -m "feat(mesh): add sync peers REST API (list, add, remove, ping)"
```

---

### Task 5: Wire Discovery + Health into Startup

**Files:**
- Modify: `packages/control-plane/src/index.ts`

- [ ] **Step 1: Import and start discovery + health loops**

In `packages/control-plane/src/index.ts`, add imports:

```typescript
import { startDiscoveryLoop } from './sync/peer-discovery.js';
import { startHealthCheckLoop } from './sync/peer-health.js';
```

After the sync maintenance worker block, add:

```typescript
    // --- Mesh peer discovery + health check ---
    let discoveryLoop: { stop: () => void } | null = null;
    let healthLoop: { stop: () => void } | null = null;
    if (db) {
      try {
        discoveryLoop = startDiscoveryLoop({ db, logger, cpPort: Number(PORT) });
        healthLoop = startHealthCheckLoop({ db, logger });
        logger.info('Mesh peer discovery + health check started');
      } catch (err) {
        logger.debug({ err }, 'Mesh peer discovery not started (sync tables may not exist)');
      }
    }
```

Add cleanup to graceful shutdown:

```typescript
      if (discoveryLoop) discoveryLoop.stop();
      if (healthLoop) healthLoop.stop();
```

- [ ] **Step 2: Build + commit**

```bash
git add packages/control-plane/src/index.ts
git commit -m "feat(mesh): start peer discovery + health check loops on CP startup"
```

---

### Task 6: Frontend — Mesh Peers Section

**Files:**
- Create: `packages/web/src/components/MeshPeersSection.tsx`
- Modify: `packages/web/src/views/MachinesPage.tsx`
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/lib/queries.ts`

- [ ] **Step 1: Add API methods**

In `packages/web/src/lib/api.ts`, add:

```typescript
  listSyncPeers: () => request<{ peers: SyncNode[] }>('/api/sync/peers'),
  addSyncPeer: (body: { hostname: string; syncUrl: string; tailscaleIp?: string }) =>
    request<{ id: string; hostname: string; syncUrl: string }>('/api/sync/peers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  removeSyncPeer: (nodeId: string) =>
    request<{ ok: boolean }>(`/api/sync/peers/${nodeId}`, { method: 'DELETE' }),
  pingSyncPeer: (nodeId: string) =>
    request<{ reachable: boolean; latencyMs: number }>(`/api/sync/peers/${nodeId}/ping`, {
      method: 'POST',
    }),
```

Add type import:

```typescript
import type { SyncNode } from '@agentctl/shared';
```

- [ ] **Step 2: Add query**

In `packages/web/src/lib/queries.ts`, add:

```typescript
  syncPeers: () => ['sync-peers'] as const,
```

And:

```typescript
export function syncPeersQuery() {
  return queryOptions({
    queryKey: queryKeys.syncPeers(),
    queryFn: () => api.listSyncPeers(),
    refetchInterval: 30_000,
  });
}
```

- [ ] **Step 3: Create MeshPeersSection component**

Create `packages/web/src/components/MeshPeersSection.tsx`:

```tsx
'use client';

import type { SyncNode } from '@agentctl/shared';
import { Globe, Plus, Trash2, Wifi, WifiOff } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useApi } from '@/lib/api';
import { syncPeersQuery } from '@/lib/queries';

import { Button } from './ui/button';

export function MeshPeersSection(): React.JSX.Element {
  const api = useApi();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery(syncPeersQuery());
  const peers = data?.peers ?? [];

  const removePeer = useMutation({
    mutationFn: (nodeId: string) => api.removeSyncPeer(nodeId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sync-peers'] }),
  });

  const pingPeer = useMutation({
    mutationFn: (nodeId: string) => api.pingSyncPeer(nodeId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sync-peers'] }),
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading mesh peers...</div>;
  }

  const nonSelfPeers = peers.filter((p) => !p.isSelf);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Globe className="w-4 h-4" />
          Mesh Peers ({nonSelfPeers.length})
        </h3>
      </div>

      {nonSelfPeers.length === 0 ? (
        <p className="text-xs text-muted-foreground">No mesh peers discovered yet.</p>
      ) : (
        <div className="space-y-2">
          {nonSelfPeers.map((peer) => (
            <div
              key={peer.id}
              className="flex items-center justify-between border border-border/50 rounded px-3 py-2"
            >
              <div className="flex items-center gap-2">
                {peer.syncStatus === 'reachable' ? (
                  <Wifi className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <WifiOff className="w-3.5 h-3.5 text-red-500" />
                )}
                <div>
                  <span className="text-sm font-medium">{peer.hostname}</span>
                  <span className="text-xs text-muted-foreground ml-2">{peer.tailscaleIp}</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => pingPeer.mutate(peer.id)}
                  disabled={pingPeer.isPending}
                >
                  Ping
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removePeer.mutate(peer.id)}
                  disabled={removePeer.isPending}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add to MachinesPage**

In `packages/web/src/views/MachinesPage.tsx`, import and add after the machines list:

```typescript
import { MeshPeersSection } from '@/components/MeshPeersSection';
```

Add `<MeshPeersSection />` in the page layout after the machines grid/list.

- [ ] **Step 5: Build + commit**

```bash
git add packages/web/src/components/MeshPeersSection.tsx packages/web/src/views/MachinesPage.tsx packages/web/src/lib/api.ts packages/web/src/lib/queries.ts
git commit -m "feat(mesh): add Mesh Peers section to Machines page with discovery + health status"
```

---

### Task 7: Push Branch + Create PR

- [ ] **Step 1: Final build**

```bash
pnpm --filter @agentctl/shared build && pnpm --filter @agentctl/control-plane build && pnpm --filter @agentctl/web build
```

- [ ] **Step 2: Push + PR**

```bash
git push -u origin agent/claude/feat/mesh-p4-peer-registry
gh pr create --base main --title "feat(mesh): P4 — node discovery + peer registry (§33.4)" --body "..."
```
