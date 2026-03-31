# Mesh P4: Node Discovery + Peer Registry — Design Spec (v3)

**Date:** 2026-03-31 (revised after Codex cross-review)
**Parent:** §33 Mesh Architecture
**Depends on:** P1 (sync tables exist)
**Must be implemented before:** P2

## Key Design Decisions (from cross-review)

1. **Unified identity:** `machineId` (already used everywhere) IS the node identity for sync. No separate `nodeId`. `sync_nodes.id = machines.id`. P1's `getMachineId` returns `machineId` from env/hostname.
2. **Directional cursors:** Per-peer-pair cursor table `sync_peer_cursors` replaces single `sync_cursor` column.
3. **Peer authentication:** Signed request envelope using dispatch signing keys (Ed25519). Peer public keys stored in `sync_nodes`.
4. **Health endpoint exposes machineId:** `/health` response includes `machineId` so P4 discovery can resolve hostnames to IDs.

---

## 1. sync_nodes Table (revised)

Replaces P1's minimal definition. `id` = `machineId`.

```sql
CREATE TABLE IF NOT EXISTS sync_nodes (
  id              TEXT PRIMARY KEY,       -- machineId (same as machines.id)
  hostname        TEXT NOT NULL,
  tailscale_ip    TEXT,
  sync_url        TEXT,                   -- http://{ip}:{port}
  role            TEXT NOT NULL DEFAULT 'full',
  sync_status     TEXT DEFAULT 'unknown', -- reachable | unreachable | unknown
  sync_interval_ms INTEGER DEFAULT 30000,
  is_self         BOOLEAN DEFAULT false,
  public_key      TEXT,                   -- Ed25519 public key for peer auth
  last_seen       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 2. sync_peer_cursors Table (new)

Tracks bidirectional sync state per peer pair:

```sql
CREATE TABLE IF NOT EXISTS sync_peer_cursors (
  local_node_id   TEXT NOT NULL,          -- this node's machineId
  remote_node_id  TEXT NOT NULL,          -- peer's machineId
  pulled_cursor   BIGINT DEFAULT 0,       -- last change_log.id we pulled FROM this peer
  acked_cursor    BIGINT DEFAULT 0,       -- last change_log.id this peer pulled FROM us
  updated_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (local_node_id, remote_node_id)
);
```

## 3. Health Endpoint Extension

Add `machineId` and `nodePublicKey` to the `/health` response so discovery can map hostname → machineId:

```typescript
// In health response:
{
  status: 'ok',
  machineId: 'mac-local',
  nodePublicKey: 'base64-encoded-ed25519-public-key',
  // ... existing fields
}
```

## 4. Discovery Flow

1. Run `tailscale status --json` every 60s
2. For each online peer with `tag:mesh-node`: GET `http://{ip}:8080/health`
3. Extract `machineId` and `nodePublicKey` from response
4. Upsert into `sync_nodes` using `machineId` as PK
5. Discovery is additive — never auto-removes peers

## 5. Peer Authentication

Sync requests (P2) must be authenticated. Reuse the existing Ed25519 dispatch signing infrastructure:
- Each node generates a key pair on first boot (or reuses `DISPATCH_SIGNING_SECRET_KEY`)
- Public key is advertised via `/health` and stored in `sync_nodes.public_key`
- Every sync request includes a signed envelope in `X-Sync-Auth` header: `{ machineId, method, path, bodyHash, issuedAt, nonce, signature }`
- Receiver verifies signature against stored public key, rejects if `issuedAt` is >60s stale
- **Nonce replay prevention:** Receiver maintains an in-memory LRU set of seen nonces (bounded to last 10,000). Duplicate nonces within the 60s window are rejected. No persistent storage needed since the window is short.

## 6. Secrets Policy

**`api_accounts` is excluded from sync by default.** Credentials encrypted with `CREDENTIAL_ENCRYPTION_KEY` must not be replicated to laptops without explicit opt-in. Add to `TABLE_SYNC_CONFIG`:

```typescript
api_accounts: 'local-only',  // credentials must not auto-replicate
```

Accounts can be manually configured per-node via the Settings UI. A future P7 could add selective credential sharing with re-encryption per node.

## 7. API Endpoints

Same as v1: `GET/POST/DELETE /api/sync/peers`, `POST /:machineId/ping`.

## 8. File Changes

| File | Change |
|------|--------|
| `packages/control-plane/drizzle/0022_mesh_peer_registry.sql` | Migration: sync_nodes revision + sync_peer_cursors |
| `packages/control-plane/src/db/schema.ts` | Update syncNodes, add syncPeerCursors |
| `packages/control-plane/src/sync/peer-discovery.ts` | Discovery with /health machineId resolution |
| `packages/control-plane/src/sync/peer-health.ts` | Health check loop |
| `packages/control-plane/src/sync/peer-auth.ts` | Request signing/verification |
| `packages/control-plane/src/api/routes/health.ts` | Add machineId + publicKey to response |
| `packages/control-plane/src/api/routes/sync-peers.ts` | REST endpoints |
| `packages/web/src/components/MeshPeersSection.tsx` | Frontend |
| P1 spec/plan update | Change nodeId → machineId throughout |
