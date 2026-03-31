# Mesh P5: Unified CP + Worker per Machine — Design Spec (v2)

**Date:** 2026-03-31 (revised after Codex cross-review)
**Parent:** §33 Mesh Architecture
**Depends on:** P4 (peer registry)

## Key Design Decisions (from cross-review)

1. **NOT a single process.** Each mesh node runs separate CP + Worker processes via PM2, same as today. What's new is: every machine gets its own local PG + Redis + both processes.
2. **Scheduler ownership:** Background jobs (cron, heartbeat, reaper) are machine-scoped. Each CP only processes jobs for agents registered on its `machineId`. This prevents duplicate execution across nodes.
3. **No leader election needed** because tasks are machine-scoped, not global.

---

## 1. Machine-Scoped Job Processing

Today's task worker processes ALL jobs from the global Redis queue. In mesh mode, each node runs its own Redis + BullMQ, so jobs are naturally scoped to the local node.

**Key change:** Each node's BullMQ queue is LOCAL (connected to local Redis), not shared. Cross-machine dispatch happens via HTTP sync (P2), not shared Redis.

This means:
- Cron/heartbeat jobs only trigger for agents on this machine
- The stale-run reaper only reaps runs dispatched from this machine
- No duplicate execution across nodes

## 2. Bootstrap Script

`scripts/setup-mesh-node.sh`:

```bash
#!/bin/bash
set -euo pipefail

echo "=== AgentCTL Mesh Node Setup ==="

# 1. Check prerequisites
command -v psql >/dev/null || { echo "Install PostgreSQL first"; exit 1; }
command -v redis-server >/dev/null || { echo "Install Redis first"; exit 1; }
command -v node >/dev/null || { echo "Install Node.js 20+ first"; exit 1; }
command -v tailscale >/dev/null || { echo "Install Tailscale first"; exit 1; }

# 2. Create local database
DBNAME=${AGENTCTL_DB:-agentctl_mesh}
createdb "$DBNAME" 2>/dev/null || echo "Database $DBNAME already exists"

# 3. Generate machine ID (reuse existing or create new)
MACHINE_ID=${MACHINE_ID:-$(hostname | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')}
echo "Machine ID: $MACHINE_ID"

# 4. Get Tailscale IP
TS_IP=$(tailscale ip -4 2>/dev/null || echo "127.0.0.1")
echo "Tailscale IP: $TS_IP"

# 5. Generate .env.mesh
cat > .env.mesh << EOF
TIER=mesh
MACHINE_ID=$MACHINE_ID
DATABASE_URL=postgresql://$(whoami)@127.0.0.1:5432/$DBNAME
REDIS_URL=redis://localhost:6379/0
PORT=8080
WORKER_PORT=9000
CONTROL_PLANE_URL=http://localhost:8080
CONTROL_URL=http://localhost:8080
TAILSCALE_IP=$TS_IP
NODE_ENV=production
EOF

# 6. Run migrations
for f in packages/control-plane/drizzle/*.sql; do
  psql "postgresql://$(whoami)@127.0.0.1:5432/$DBNAME" -f "$f"
done

# 7. Install PM2 config
echo "Run: pm2 start infra/pm2/ecosystem.mesh.config.cjs"
echo "=== Setup complete ==="
```

## 3. PM2 Config

`infra/pm2/ecosystem.mesh.config.cjs` — runs CP + Worker reading from `.env.mesh`:

```javascript
// Loads .env.mesh the same way ecosystem.beta.config.cjs loads .env.beta
// CP on :8080, Worker on :9000, both connect to local PG + Redis
```

## 4. File Changes

| File | Change |
|------|--------|
| `scripts/setup-mesh-node.sh` | Bootstrap script |
| `infra/pm2/ecosystem.mesh.config.cjs` | PM2 config |
| `.env.mesh.template` | Template env file |
| `docs/QUICKSTART-MESH.md` | Setup guide |
