# Mesh P5: Unified CP + Worker per Machine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable any machine to run a complete agentctl mesh node (CP + Worker + local PG + local Redis) via a one-command bootstrap script and PM2 config.

**Architecture:** NOT a single process — each mesh node runs separate CP + Worker via PM2 (same as today). What's new: local PG + Redis per node, machine-scoped job processing, bootstrap script, and PM2 mesh config.

**Tech Stack:** PostgreSQL, Redis, PM2, Bash (setup script)

**Spec:** `docs/superpowers/specs/2026-03-31-mesh-p5-unified-cp-worker-design.md` (v3)
**Depends on:** P4 (peer discovery)

---

### Task 1: Machine-Scoped Job Processing

**Files:**
- Modify: `packages/control-plane/src/scheduler/task-worker.ts`
- Modify: `packages/control-plane/src/api/routes/run-reaper.ts` (or equivalent)

- [ ] **Step 1: Add machineId filter to task worker**

In `task-worker.ts`, after resolving the agent (~line 201), add early exit:

```typescript
const localMachineId = process.env.MACHINE_ID;
if (localMachineId && agent.machineId !== localMachineId) {
  jobLogger.debug({ agentMachineId: agent.machineId, localMachineId }, 'Skipping job for non-local agent');
  return; // This agent belongs to another node — will be processed by its home node
}
```

- [ ] **Step 2: Add machineId filter to run reaper**

In `packages/control-plane/src/api/routes/run-reaper.ts` (or wherever the stale-run reaper query lives), add a WHERE clause:

```sql
-- Before (reaps ALL stale runs globally):
WHERE agent_runs.status = 'running' AND agent_runs.started_at < now() - interval '2 hours'

-- After (reaps only this node's runs):
WHERE agent_runs.status = 'running'
  AND agent_runs.started_at < now() - interval '2 hours'
  AND agent_runs.agent_id IN (SELECT id FROM agents WHERE machine_id = $machineId)
```

- [ ] **Step 3: Add machineId filter to repeatable job scheduler**

In `packages/control-plane/src/scheduler/repeatable-jobs.ts`, when creating cron/heartbeat jobs, filter to only create jobs for agents where `agents.machine_id = localMachineId`.

```typescript
// Before creating repeatable jobs:
const localMachineId = process.env.MACHINE_ID;
const localAgents = allAgents.filter(a => !localMachineId || a.machineId === localMachineId);
// Only create jobs for localAgents
```

- [ ] **Step 4: Guard the agent start route**

In `packages/control-plane/src/api/routes/agents.ts`, the POST `/:id/start` route enqueues a job on the local BullMQ. With local Redis per node, this job will only be processed locally. If `agent.machineId !== localMachineId`, the start request should be forwarded to the correct node via the sync URL.

For P5, the simplest approach: **reject remote starts with a clear error message** pointing the user to the correct node. Cross-node agent management can be added in a future iteration.

```typescript
const localMachineId = process.env.MACHINE_ID;
if (localMachineId && agent.machineId !== localMachineId) {
  return reply.code(409).send({
    error: 'AGENT_ON_DIFFERENT_NODE',
    message: `Agent '${agent.name}' is registered on machine '${agent.machineId}'. Start it from that node.`,
  });
}
```

- [ ] **Step 5: Force dispatch to localhost in task worker**

In `task-worker.ts` (~line 425), the current dispatch URL is built as:
```typescript
const dispatchUrl = `http://${machine.tailscaleIp ?? machine.hostname}:${workerPort}/api/agents/${agentId}/start`;
```

Add a localhost override for local agents:

```typescript
const localMachineId = process.env.MACHINE_ID;
const dispatchHost = (localMachineId && machine.id === localMachineId)
  ? '127.0.0.1'  // Mesh mode: dispatch to co-located worker
  : (machine.tailscaleIp ?? machine.hostname);
const dispatchUrl = `http://${dispatchHost}:${workerPort}/api/agents/${agentId}/start`;
```

This ensures local agents dispatch to the co-located worker via localhost, not via Tailscale IP round-trip.

- [ ] **Step 6: Guard scheduler routes**

In `packages/control-plane/src/api/routes/scheduler.ts`, the POST route that creates repeatable jobs should reject jobs for non-local agents:

```typescript
const localMachineId = process.env.MACHINE_ID;
if (localMachineId && agent.machineId !== localMachineId) {
  return reply.code(409).send({
    error: 'AGENT_ON_DIFFERENT_NODE',
    message: `Schedule agent '${agent.name}' from its home node '${agent.machineId}'.`,
  });
}
```

- [ ] **Step 7: Pass machineId context to repeatable job manager**

In `packages/control-plane/src/scheduler/repeatable-jobs.ts`, the repo uses a `createRepeatableJobManager()` factory function (not a class constructor). Add `machineId` to the factory options:

```typescript
// In the factory function options type, add:
machineId?: string;

// In the syncJobs() method, filter agents:
const allAgents = await registry.listAgents();
const agents = machineId
  ? allAgents.filter(a => a.machineId === machineId)
  : allAgents;
// Only create cron/heartbeat jobs for these filtered agents
```

In `index.ts`, pass `machineId` when calling `createRepeatableJobManager()`:

```typescript
const repeatableJobs = createRepeatableJobManager({
  // ... existing opts ...
  machineId,  // from getMachineId() earlier in startup
});
```

The manager's `addCronJob()`, `addHeartbeatJob()` methods should check `agent.machineId === machineId` before creating jobs. If the agent belongs to a different node, skip silently.

**Also:** `packages/control-plane/src/audit/audit-scheduler.ts` creates repeatable jobs through the manager. The same machineId filter applies — audit jobs should only be created for local agents. Pass `machineId` to the audit scheduler constructor and filter there.

- [ ] **Step 8: Create .env.mesh.template and QUICKSTART-MESH.md**

Create `.env.mesh.template` (copy of the template in setup-mesh-node.sh output).
Create `docs/QUICKSTART-MESH.md` with step-by-step setup guide.

- [ ] **Step 9: Build + commit**

---

### Task 2: Bootstrap Script

**Files:**
- Create: `scripts/setup-mesh-node.sh`

- [ ] **Step 1: Write the script**

```bash
#!/bin/bash
set -euo pipefail
echo "=== AgentCTL Mesh Node Setup ==="

# Check prerequisites
for cmd in psql redis-server node pnpm tailscale; do
  command -v "$cmd" >/dev/null || { echo "Missing: $cmd"; exit 1; }
done

DBNAME=${AGENTCTL_DB:-agentctl_mesh}
MACHINE_ID=${MACHINE_ID:-$(hostname | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')}
TS_IP=$(tailscale ip -4 2>/dev/null || echo "127.0.0.1")

echo "Machine ID: $MACHINE_ID"
echo "Tailscale IP: $TS_IP"
echo "Database: $DBNAME"

# Create DB
createdb "$DBNAME" 2>/dev/null || echo "Database already exists"

# Write .env.mesh
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

echo "Wrote .env.mesh"
echo "Next: pnpm build && pm2 start infra/pm2/ecosystem.mesh.config.cjs"
echo "Migrations will run automatically on first CP startup."
```

- [ ] **Step 2: chmod + commit**

```bash
chmod +x scripts/setup-mesh-node.sh
git add scripts/setup-mesh-node.sh
git commit -m "feat(mesh-p5): add setup-mesh-node.sh bootstrap script"
```

---

### Task 3: PM2 Mesh Config

**Files:**
- Create: `infra/pm2/ecosystem.mesh.config.cjs`

- [ ] **Step 1: Create config** (same pattern as `ecosystem.beta.config.cjs` but loads `.env.mesh`)

```javascript
const fs = require('node:fs');
const path = require('node:path');
const REPO_ROOT = path.resolve(__dirname, '../..');

// Load .env.mesh
const envPath = path.join(REPO_ROOT, '.env.mesh');
try {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    if (!process.env[t.slice(0, eq)]) process.env[t.slice(0, eq)] = t.slice(eq + 1);
  }
} catch { /* .env.mesh optional */ }

module.exports = {
  apps: [
    {
      name: 'agentctl-cp-mesh',
      script: 'dist/index.js',
      cwd: path.join(REPO_ROOT, 'packages/control-plane'),
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || '8080',
        HOST: '0.0.0.0',
        REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379/0',
        DATABASE_URL: process.env.DATABASE_URL || '',
        MACHINE_ID: process.env.MACHINE_ID || '',
        TAILSCALE_IP: process.env.TAILSCALE_IP || '',
        TIER_LABEL: 'mesh',
      },
      autorestart: true,
      max_restarts: 10,
    },
    {
      name: 'agentctl-worker-mesh',
      script: 'dist/index.js',
      cwd: path.join(REPO_ROOT, 'packages/agent-worker'),
      env: {
        NODE_ENV: 'production',
        WORKER_PORT: process.env.WORKER_PORT || '9000',
        CONTROL_URL: 'http://localhost:8080',
        CONTROL_PLANE_URL: 'http://localhost:8080',
        MACHINE_ID: process.env.MACHINE_ID || '',
        TIER_LABEL: 'mesh',
      },
      autorestart: true,
      max_restarts: 10,
    },
  ],
};
```

- [ ] **Step 2: Commit**

---

### Task 4: Push + PR

```bash
git push -u origin agent/claude/feat/mesh-p5-unified
gh pr create --base main --title "feat(mesh): P5 — unified CP+Worker per machine (§33.5)"
```
