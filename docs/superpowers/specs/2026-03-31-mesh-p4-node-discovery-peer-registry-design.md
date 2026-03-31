# Mesh P4: Node Discovery + Peer Registry — Design Spec

**Date:** 2026-03-31
**Status:** Draft
**Parent:** §33 Mesh Architecture
**Depends on:** P1 (sync_nodes table exists)
**Parallelizable with:** P1 implementation

## Context

P1 creates `sync_nodes` — a table where each node registers itself. P4 makes nodes aware of each other: discovering peers via Tailscale, maintaining a peer registry, and health-checking connections between mesh nodes.

## Goals

1. Auto-discover mesh peers via `tailscale status --json`
2. Maintain a peer registry with health status and sync cursor
3. Provide an API for listing/adding/removing peers
4. Adaptive poll interval: 30s for always-on peers, catch-up on reconnect
5. Surface mesh peer status on the Machines page

## Non-Goals

- Actual data sync between peers (P2)
- Conflict resolution UI (P3)
- Leader election or consensus (not needed — all nodes are equal)

---

## 1. Peer Registry (extends sync_nodes)

Add columns to the existing `sync_nodes` table:

```sql
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS
  sync_url TEXT;                    -- e.g. http://100.64.0.2:8080
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS
  sync_cursor BIGINT DEFAULT 0;    -- last change_log.id pulled from this peer
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS
  sync_status TEXT DEFAULT 'unknown'; -- 'reachable' | 'unreachable' | 'unknown'
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS
  sync_interval_ms INTEGER DEFAULT 30000; -- adaptive poll interval
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS
  is_self BOOLEAN DEFAULT false;    -- true for this node's own row
```

## 2. Tailscale Auto-Discovery

On CP startup and periodically (every 60s), run:

```bash
tailscale status --json
```

Parse the output to find peers with `tag:mesh-node`. For each discovered peer:
- Check if already in `sync_nodes`
- If not, insert with `sync_status: 'unknown'`, `sync_url: http://{tailscaleIp}:8080`
- If exists, update `tailscale_ip` if changed

Discovery is **additive only** — never auto-removes a peer (manual removal via API).

## 3. Peer Health Check

Every `sync_interval_ms` per peer, ping `GET {sync_url}/health`. Based on result:

| Condition | Action |
|-----------|--------|
| 200 OK | Set `sync_status = 'reachable'`, `last_seen = now()` |
| Connection refused / timeout | Set `sync_status = 'unreachable'` |
| 3+ consecutive unreachable | Double `sync_interval_ms` (max 300000 = 5min) |
| Transition unreachable → reachable | Reset `sync_interval_ms` to 30000, trigger catch-up sync (P2) |

## 4. API Endpoints

All under `/api/sync/peers`:

| Method | Path | Description |
|--------|------|-------------|
| `GET /` | List all peers with status | Returns `SyncNode[]` with extended fields |
| `POST /` | Add a peer manually | Body: `{ hostname, syncUrl, tailscaleIp? }` |
| `DELETE /:nodeId` | Remove a peer | Removes from registry |
| `POST /:nodeId/ping` | Manual health check | Returns latency + status |

## 5. Frontend: Mesh Peers on Machines Page

Add a "Mesh Peers" section to the existing Machines page showing:
- Peer hostname, tailscale IP, sync status (reachable/unreachable)
- Last seen timestamp
- Sync cursor progress
- "Add Peer" and "Remove" actions

## 6. File Changes

| File | Change |
|------|--------|
| `packages/control-plane/drizzle/0022_mesh_peer_registry.sql` | Migration: add columns to sync_nodes |
| `packages/control-plane/src/db/schema.ts` | Update syncNodes table definition |
| `packages/control-plane/src/sync/peer-discovery.ts` | Tailscale discovery + health check loop |
| `packages/control-plane/src/api/routes/sync-peers.ts` | REST endpoints |
| `packages/control-plane/src/index.ts` | Start discovery loop, register routes |
| `packages/web/src/components/MeshPeersSection.tsx` | Frontend component |
| `packages/web/src/views/MachinesPage.tsx` | Integrate MeshPeersSection |
| `packages/web/src/lib/api.ts` | Add peer API methods |

## 7. Testing

- **Unit:** Tailscale JSON parsing, health check logic, interval adaptation
- **Unit:** Peer API CRUD operations
- **Integration:** Discovery loop finds peers and updates DB
