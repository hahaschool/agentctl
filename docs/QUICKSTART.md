# Quickstart: From Zero to First Agent

This guide gets you from nothing to a working 2-machine agent fleet in about 2 hours.

---

## Prerequisites

- 2+ machines (any combo of: Mac, Linux, EC2)
- Node.js 20+ on all machines
- Claude Code installed: `npm install -g @anthropic-ai/claude-code`
- An Anthropic API key (any tier)
- A GitHub/GitLab account for code sync

## Step 1: Install Tailscale on All Machines (10 min)

```bash
# On every machine (Mac, Linux, EC2)
curl -fsSL https://tailscale.com/install.sh | sh

# Machine 1 (will be control plane): 
sudo tailscale up --hostname=control --advertise-tags=tag:control --ssh

# Machine 2 (will be worker):
sudo tailscale up --hostname=worker-1 --advertise-tags=tag:worker --ssh

# Verify connectivity
ping control    # from worker-1
ping worker-1   # from control
```

Install Tailscale on your iPhone/iPad too (App Store → Tailscale). Same account.

## Step 2: Set Up the Monorepo (15 min)

```bash
# On your dev machine
mkdir agentctl && cd agentctl
git init

# Initialize pnpm workspace
cat > pnpm-workspace.yaml << 'EOF'
packages:
  - 'packages/*'
EOF

cat > package.json << 'EOF'
{
  "name": "agentctl",
  "private": true,
  "scripts": {
    "dev:control": "pnpm --filter control-plane dev",
    "dev:worker": "pnpm --filter agent-worker dev",
    "build": "pnpm -r build"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@biomejs/biome": "^1.9.0"
  }
}
EOF

# Create shared types package
mkdir -p packages/shared/src
cat > packages/shared/package.json << 'EOF'
{
  "name": "@agentctl/shared",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": { "build": "tsc" }
}
EOF

# Create control plane package
mkdir -p packages/control-plane/src
cat > packages/control-plane/package.json << 'EOF'
{
  "name": "@agentctl/control-plane",
  "version": "0.1.0",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc"
  },
  "dependencies": {
    "@agentctl/shared": "workspace:*",
    "fastify": "^5.0.0",
    "bullmq": "^5.0.0",
    "drizzle-orm": "^0.38.0",
    "pg": "^8.13.0",
    "ioredis": "^5.4.0",
    "pino": "^9.0.0"
  }
}
EOF

# Create agent worker package
mkdir -p packages/agent-worker/src
cat > packages/agent-worker/package.json << 'EOF'
{
  "name": "@agentctl/agent-worker",
  "version": "0.1.0",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc"
  },
  "dependencies": {
    "@agentctl/shared": "workspace:*",
    "@anthropic-ai/claude-agent-sdk": "^0.2.51",
    "fastify": "^5.0.0",
    "pino": "^9.0.0"
  }
}
EOF

pnpm install
```

## Step 3: Minimal Control Plane (30 min)

```bash
# On the control machine, install Redis + PostgreSQL
# EC2 Ubuntu:
sudo apt update && sudo apt install -y redis-server postgresql
sudo systemctl start redis postgresql

# Mac:
brew install redis postgresql@16
brew services start redis postgresql@16

# Create database
createdb agentctl
```

Create the minimal control plane server:

```typescript
// packages/control-plane/src/index.ts
import Fastify from 'fastify';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');
const agentQueue = new Queue('agent-tasks', { connection: redis });

const app = Fastify({ logger: true });

// Agent registration
const agents = new Map<string, { hostname: string; lastHeartbeat: Date; status: string }>();

app.post('/api/agents/register', async (req) => {
  const { agentId, hostname } = req.body as any;
  agents.set(agentId, { hostname, lastHeartbeat: new Date(), status: 'online' });
  return { ok: true, agentId };
});

app.post('/api/agents/:id/heartbeat', async (req) => {
  const agent = agents.get(req.params.id);
  if (agent) agent.lastHeartbeat = new Date();
  return { ok: true };
});

// List all agents
app.get('/api/agents', async () => {
  return Object.fromEntries(agents);
});

// Dispatch a task to an agent
app.post('/api/agents/:id/task', async (req) => {
  const { prompt, model } = req.body as any;
  const job = await agentQueue.add('run-agent', {
    agentId: req.params.id,
    prompt,
    model: model || 'sonnet',
  });
  return { ok: true, jobId: job.id };
});

app.listen({ port: 8080, host: '0.0.0.0' }).then(() => {
  console.log('Control plane running on :8080');
});
```

## Step 4: Minimal Agent Worker (30 min)

```typescript
// packages/agent-worker/src/index.ts
import { query } from '@anthropic-ai/claude-agent-sdk';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import os from 'os';

const CONTROL_PLANE = process.env.CONTROL_URL || 'http://control:8080';
const AGENT_ID = process.env.AGENT_ID || `agent-${os.hostname()}`;
const redis = new IORedis(process.env.REDIS_URL || 'redis://control:6379');

// Register with control plane
async function register() {
  await fetch(`${CONTROL_PLANE}/api/agents/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId: AGENT_ID, hostname: os.hostname() }),
  });
}

// Heartbeat every 15s
setInterval(async () => {
  try {
    await fetch(`${CONTROL_PLANE}/api/agents/${AGENT_ID}/heartbeat`, {
      method: 'POST',
    });
  } catch (e) {
    console.error('Heartbeat failed:', e);
  }
}, 15_000);

// Process tasks from the queue
const worker = new Worker('agent-tasks', async (job) => {
  if (job.data.agentId !== AGENT_ID) return; // Only process our tasks

  console.log(`Running task: ${job.data.prompt}`);

  for await (const message of query({
    prompt: job.data.prompt,
    options: {
      model: job.data.model,
      maxTurns: 50,
      permissionMode: 'acceptEdits',
    },
  })) {
    if (message.type === 'result') {
      console.log(`Task complete. Cost: $${message.total_cost_usd}`);
      return {
        result: message.result,
        cost: message.total_cost_usd,
        session_id: message.session_id,
      };
    }
  }
}, { connection: redis });

register().then(() => console.log(`Worker ${AGENT_ID} started`));
```

## Step 5: PM2 for Process Persistence (10 min)

```bash
npm install -g pm2

# On control machine
cat > ecosystem.control.config.cjs << 'EOF'
module.exports = {
  apps: [{
    name: 'control-plane',
    script: 'pnpm',
    args: 'dev:control',
    cwd: '/path/to/agentctl',
    env: {
      REDIS_URL: 'redis://localhost:6379',
      DATABASE_URL: 'postgresql://localhost:5432/agentctl',
    },
  }],
};
EOF
pm2 start ecosystem.control.config.cjs
pm2 save
pm2 startup  # follow the output instructions

# On worker machine
cat > ecosystem.worker.config.cjs << 'EOF'
module.exports = {
  apps: [{
    name: 'agent-worker',
    script: 'pnpm',
    args: 'dev:worker',
    cwd: '/path/to/agentctl',
    env: {
      CONTROL_URL: 'http://control:8080',
      REDIS_URL: 'redis://control:6379',
      ANTHROPIC_API_KEY: 'sk-ant-...',
      AGENT_ID: 'worker-mac-mini',
    },
  }],
};
EOF
pm2 start ecosystem.worker.config.cjs
pm2 save
pm2 startup
```

## Step 6: Verify It Works (10 min)

```bash
# From any machine on the Tailscale network:

# Check registered agents
curl http://control:8080/api/agents | jq .

# Dispatch a task
curl -X POST http://control:8080/api/agents/worker-mac-mini/task \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "List the files in the current directory and describe what you see"}'

# Monitor worker logs
ssh worker-1 pm2 logs agent-worker --lines 50

# From your iPhone (in Safari, while connected to Tailscale):
# Open http://control:8080/api/agents
```

## What You Now Have

- ✅ 2 machines connected via Tailscale mesh
- ✅ Control plane with agent registry + task queue
- ✅ Agent worker executing Claude Code tasks
- ✅ PM2 keeping everything alive through reboots
- ✅ Basic iOS access via mobile Safari + Tailscale

## Next Steps

1. **Add SSE streaming** — Stream agent output to a monitoring endpoint
2. **Add LiteLLM proxy** — Multi-provider routing for failover
3. **Add cron scheduling** — BullMQ `repeat` option for periodic agents
4. **Add git worktree** — Isolate agent work in separate branches
5. **Add Mem0** — Persistent cross-device memory
6. **Build React Native app** — Replace Safari with a proper iOS client
