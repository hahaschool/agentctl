# AgentCTL Mesh — Quick Start Guide

Set up a new machine as a mesh node. Every mesh node runs a full control plane + worker with its own local PostgreSQL and Redis, and syncs data with other nodes over Tailscale.

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20+ | `brew install node` / `apt install nodejs` |
| pnpm | 8+ | `npm i -g pnpm` |
| PostgreSQL | 14+ | `brew install postgresql@16` / `apt install postgresql` |
| Redis | 7+ | `brew install redis` / `apt install redis-server` |
| Tailscale | latest | https://tailscale.com/download |
| PM2 | latest | `npm i -g pm2` |

## Step 1: Clone the repo

```bash
git clone git@github.com:hahaschool/agentctl.git
cd agentctl
pnpm install
```

## Step 2: Join the Tailscale network

```bash
# Join with mesh-node tag for peer-to-peer sync access
tailscale up --advertise-tags=tag:mesh-node,tag:control,tag:worker
```

Verify connectivity to other mesh nodes:
```bash
tailscale status    # should show other tagged nodes
tailscale ping <other-node-hostname>
```

## Step 3: Run the bootstrap script

**On the first node:**

```bash
./scripts/setup-mesh-node.sh
```

This will:
- Check prerequisites (node, pnpm, psql, redis-cli)
- Create a local PostgreSQL database (`agentctl_mesh`)
- Detect your Tailscale IP
- Generate a fresh `SYNC_PEER_REGISTRATION_TOKEN` (printed at the end of the script)
- Write `.env.mesh` with all configuration

**On every subsequent node**, reuse the token the first node printed so reverse-registration works across the mesh:

```bash
export SYNC_PEER_REGISTRATION_TOKEN='<paste-token-from-first-node>'
./scripts/setup-mesh-node.sh
```

Without a matching token across the fleet, adding a peer on node A won't auto-register node A on node B — you'd have to add the reverse row manually on every machine.

## Step 4: Build and start

```bash
pnpm build
pm2 start infra/pm2/ecosystem.mesh.config.cjs
pm2 save     # persist across reboots
pm2 startup  # enable boot persistence
```

## Step 5: Verify

```bash
# Check services are running
pm2 list

# Check health
curl http://localhost:8080/health

# Should show your machineId and publicKey
```

## Step 6: Add peers

Other mesh nodes will auto-discover this node via Tailscale if both have `tag:mesh-node`. You can also add peers manually — as long as every node shares the same `SYNC_PEER_REGISTRATION_TOKEN`, a single add-peer call on node A registers both sides:

```bash
# From any mesh node's web UI: Mesh Peers page → "+ Add peer"
# Or via API:
curl -X POST http://localhost:8080/api/sync/peers \
  -H 'Content-Type: application/json' \
  -d '{
        "machineId": "other-node",
        "hostname": "other-node",
        "syncUrl": "http://<tailscale-ip>:8080",
        "publicKey": "<other-nodes-nodePublicKey-from-/health>"
      }'
```

If the response shows `reverseRegistrationStatus: "failed"` with `PEER_REGISTRATION_DISABLED`, the remote node is missing `SYNC_PEER_REGISTRATION_TOKEN` — set it and restart the control plane.

## How sync works

- Each node captures all data mutations via PostgreSQL triggers
- Nodes pull changes from each other every 30 seconds
- Append-only tables (audit logs, session handoffs) auto-merge by PK dedup
- Mutable tables (agents, settings) use vector clocks for conflict detection
- Conflicts appear on the `/conflicts` page for manual resolution
- The node works fully offline — sync catches up when connectivity returns

## Customization

Edit `.env.mesh` for:
- `MACHINE_ID` — unique identifier (default: hostname)
- `DATABASE_URL` — local PostgreSQL connection
- `REDIS_URL` — local Redis connection
- `CREDENTIAL_ENCRYPTION_KEY` — for managing API credentials locally

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Database won't create | Ensure PostgreSQL is running: `pg_isready` |
| Redis won't connect | Start Redis: `redis-server --daemonize yes` |
| No peers discovered | Verify Tailscale tags: `tailscale status` should show `tag:mesh-node` |
| Sync not working | Check `/health` for `machineId` and `nodePublicKey` fields |
| Conflicts appearing | Normal — resolve via `/conflicts` page |
