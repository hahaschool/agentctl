# Quickstart Guide

Get AgentCTL running on your machine in ~15 minutes.

> For production deployments (Docker Compose, multi-machine Tailscale, PM2), see [DEPLOYMENT.md](./DEPLOYMENT.md).

---

## Prerequisites

- **Node.js 20+** (22 recommended)
- **pnpm 8+**: `npm install -g pnpm`
- **PostgreSQL 14+**: for the agent registry and run history
- **Redis 7+**: for the BullMQ task queue
- **Git**: for worktree management

Optional:
- **Tailscale**: for multi-machine mesh networking
- **Docker & Docker Compose**: for containerized deployment
- **Claude Code CLI**: `npm install -g @anthropic-ai/claude-code` (needed on worker machines)

## 1. Clone and Install

```bash
git clone https://github.com/hahaschool/agentctl.git
cd agentctl
pnpm install
pnpm build
```

## 2. Set Up Backing Services

### macOS (Homebrew)

```bash
brew install redis postgresql@16
brew services start redis postgresql@16
createdb agentctl
```

### Ubuntu/Debian

```bash
sudo apt update && sudo apt install -y redis-server postgresql
sudo systemctl start redis postgresql
sudo -u postgres createdb agentctl
```

### Docker (alternative)

```bash
docker run -d --name redis -p 6379:6379 redis:7-alpine
docker run -d --name postgres -p 5432:5432 \
  -e POSTGRES_USER=agentctl \
  -e POSTGRES_PASSWORD=agentctl \
  -e POSTGRES_DB=agentctl \
  pgvector/pgvector:pg16
```

## 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` — at minimum set these:

```bash
DATABASE_URL=postgresql://agentctl:agentctl@localhost:5432/agentctl
REDIS_URL=redis://localhost:6379
```

All other variables have sensible defaults or enable optional features. See `.env.example` for the full list.

## 4. Start the Control Plane

```bash
pnpm dev:control
```

This starts the control plane on `http://localhost:8080`. It will:
- Auto-run Drizzle database migrations
- Check PostgreSQL, Redis, Mem0, and LiteLLM connectivity
- Start the BullMQ task processor
- Listen for HTTP + WebSocket connections

Verify it's running:

```bash
curl http://localhost:8080/health | jq .
# → { "status": "ok", "timestamp": "..." }

# Detailed dependency health:
curl 'http://localhost:8080/health?detail=true' | jq .
```

## 5. Start an Agent Worker

On the same machine (or any machine with Redis/Tailscale access):

```bash
# Set the worker-specific env vars
export CONTROL_PLANE_URL=http://localhost:8080
export MACHINE_ID=my-laptop
export WORKER_PORT=9000

pnpm dev:worker
```

Verify:

```bash
curl http://localhost:9000/health | jq .
```

## 6. Dispatch Your First Task

### Via CLI

```bash
# Health check
pnpm tsx scripts/agentctl.ts health

# System status (control plane + worker)
pnpm tsx scripts/agentctl.ts status

# List agents
pnpm tsx scripts/agentctl.ts agents

# Start an agent with a prompt
pnpm tsx scripts/agentctl.ts start my-agent "List the files in the current directory"

# JSON output for scripting
pnpm tsx scripts/agentctl.ts health --json
```

### Via HTTP API

```bash
# Start an agent (auto-creates if it doesn't exist)
curl -X POST http://localhost:8080/api/agents/my-agent/start \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "List files in the current directory", "model": "sonnet"}'

# Check agent status
curl http://localhost:8080/api/agents | jq .

# Stream agent output (SSE)
curl -N http://localhost:8080/api/agents/my-agent/stream
```

### Via WebSocket

```javascript
const ws = new WebSocket('ws://localhost:8080/api/ws');
ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'start_agent',
    agentId: 'my-agent',
    prompt: 'Describe the project structure',
  }));
};
ws.onmessage = (event) => console.log(JSON.parse(event.data));
```

## 7. Multi-Machine Setup (Optional)

### Install Tailscale on All Machines

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname=control --ssh    # Control machine
sudo tailscale up --hostname=worker-1 --ssh   # Worker machine
```

### Start Worker on Remote Machine

```bash
# On the worker machine (after cloning + pnpm install):
export CONTROL_PLANE_URL=http://control:8080
export REDIS_URL=redis://control:6379
export MACHINE_ID=worker-1
pnpm dev:worker
```

### PM2 for Process Persistence

```bash
npm install -g pm2

# On control machine:
pm2 start infra/pm2/ecosystem.control.config.cjs
pm2 save && pm2 startup

# On worker machine:
pm2 start infra/pm2/ecosystem.worker.config.cjs
pm2 save && pm2 startup
```

## 8. Docker Production Deployment

```bash
cd infra/docker

# Set required env vars
export POSTGRES_PASSWORD=your-secure-password

# Validate configuration
bash docker-preflight.sh

# Start all services
docker compose -f docker-compose.prod.yml up -d --build

# Check health
docker compose -f docker-compose.prod.yml ps
curl http://localhost:8080/health?detail=true | jq .
```

## Available API Endpoints

### Control Plane (port 8080)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (add `?detail=true` for deps) |
| GET | `/api/agents` | List all agents |
| GET | `/api/agents/:id` | Get agent details |
| POST | `/api/agents/:id/start` | Start/dispatch an agent |
| POST | `/api/agents/:id/stop` | Stop a running agent |
| POST | `/api/agents/:id/complete` | Run completion callback |
| POST | `/api/agents/:id/signal` | Trigger via signal |
| GET | `/api/agents/:id/stream` | SSE output stream |
| GET | `/api/agents/:id/runs` | Recent run history |
| GET | `/api/agents/stats` | Pool statistics |
| POST | `/api/agents/audit` | Ingest audit actions |
| GET | `/api/scheduler/jobs` | List scheduled jobs |
| POST | `/api/scheduler/jobs/heartbeat` | Create heartbeat job |
| POST | `/api/scheduler/jobs/cron` | Create cron job |
| DELETE | `/api/scheduler/jobs/:key` | Remove a job |
| GET | `/api/router/models` | List available models |
| POST | `/api/memory/inject` | Inject memory context |
| WS | `/api/ws` | WebSocket control channel |

### Agent Worker (port 9000)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (add `?detail=true`) |
| GET | `/api/agents` | List running agents |
| GET | `/api/agents/stats` | Worker pool statistics |
| POST | `/api/agents/:id/start` | Start agent on this worker |
| POST | `/api/agents/:id/stop` | Stop agent on this worker |
| GET | `/api/agents/:id/stream` | SSE output stream |

## Fleet Provisioning (Optional)

For automated machine setup across your fleet:

```bash
# Provision a single target machine (installs Docker, Compose, Tailscale)
pnpm tsx scripts/provision-target.ts --dry-run  # Preview what would happen
pnpm tsx scripts/provision-target.ts             # Execute provisioning

# Bootstrap all machines in the fleet inventory
pnpm tsx scripts/fleet-bootstrap.ts --dry-run    # Preview
pnpm tsx scripts/fleet-bootstrap.ts              # Execute

# Run database migrations before deployment
pnpm tsx scripts/migrate-deploy.ts --dry-run     # Preview SQL
pnpm tsx scripts/migrate-deploy.ts               # Execute migrations
```

## Running Tests

```bash
# All tests (3252+ tests across 93+ files)
pnpm test

# Specific package
pnpm --filter @agentctl/shared test
pnpm --filter @agentctl/control-plane test
pnpm --filter @agentctl/agent-worker test
pnpm --filter @agentctl/mobile test

# With coverage
pnpm test:coverage
```

## Troubleshooting

**Control plane won't start:**
- Check PostgreSQL is running: `pg_isready`
- Check Redis is running: `redis-cli ping`
- Check DATABASE_URL format: `postgresql://user:pass@host:5432/dbname`

**Agent worker can't connect:**
- Verify control plane URL: `curl http://control:8080/health`
- Check Redis connectivity: `redis-cli -u redis://control:6379 ping`
- If using Tailscale: `tailscale status`

**Tasks not being processed:**
- Check BullMQ queue: `curl http://localhost:8080/api/scheduler/jobs | jq .`
- Check worker logs: `pm2 logs agent-worker`
- Verify MACHINE_ID matches what's in the agent registry
