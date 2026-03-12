# AgentCTL Deployment Guide

Step-by-step instructions for deploying AgentCTL in local development, single-machine production (Docker Compose), and multi-machine fleet (Tailscale) configurations.

## Prerequisites

| Dependency | Minimum Version | Verify |
|---|---|---|
| Node.js | 20+ (22 recommended) | `node -v` |
| pnpm | 8.15+ | `pnpm -v` |
| PostgreSQL | 14+ (16 in Docker images) | `psql --version` |
| Redis | 7+ | `redis-cli --version` |
| Git | 2.30+ | `git --version` |
| Docker + Compose | 24+ / 2.20+ (production only) | `docker --version` |

## Quick Start -- Local Development

Get all three services running in about five minutes.

### 1. Clone and install

```bash
git clone https://github.com/hahaschool/agentctl.git
cd agentctl
pnpm install
pnpm build        # builds @agentctl/shared first, then all packages
```

### 2. Start backing services

Pick **one** of the following approaches.

**macOS (Homebrew):**

```bash
brew install redis postgresql@16
brew services start redis
brew services start postgresql@16
createdb agentctl
```

**Ubuntu / Debian:**

```bash
sudo apt update && sudo apt install -y redis-server postgresql
sudo systemctl enable --now redis-server postgresql
sudo -u postgres createdb agentctl
```

**Docker (if you prefer containers for dependencies):**

```bash
cd infra/docker
docker compose -f docker-compose.dev.yml up -d
```

This starts Redis on port 6379, PostgreSQL on port 5432, and the LiteLLM proxy on port 4000 with dev credentials (`agentctl` / `agentctl`).

### 3. Configure environment

```bash
cp .env.example .env
```

Set at minimum:

```bash
DATABASE_URL=postgresql://agentctl:agentctl@localhost:5432/agentctl
REDIS_URL=redis://localhost:6379
```

All other variables have sensible defaults. See the [Environment Variables Reference](#environment-variables-reference) for the full list.

### 4. Run database migrations

```bash
pnpm --filter @agentctl/control-plane db:migrate
```

This uses Drizzle Kit to apply all pending migrations from `packages/control-plane/drizzle/` against the `DATABASE_URL`.

### 5. Start services

Open three terminals (or use a multiplexer like tmux):

```bash
# Terminal 1 -- Control Plane (port 8080)
pnpm dev:control

# Terminal 2 -- Agent Worker (port 9000)
pnpm dev:worker

# Terminal 3 -- Web UI (port 5173)
pnpm --filter @agentctl/web dev
```

### 6. Verify

```bash
# Control plane health
curl http://localhost:8080/health | jq .

# Detailed dependency health
curl 'http://localhost:8080/health?detail=true' | jq .

# Worker health
curl http://localhost:9000/health | jq .

# Open the web dashboard
open http://localhost:5173
```

## Production -- Single Machine (Docker Compose)

All services run on one machine behind Docker Compose with production security hardening.

### 1. Clone the repo on the production host

```bash
git clone https://github.com/hahaschool/agentctl.git
cd agentctl
```

### 2. Configure production environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```bash
NODE_ENV=production
POSTGRES_PASSWORD=<strong-random-password>
DATABASE_URL=postgresql://agentctl:<same-password>@postgres:5432/agentctl
REDIS_URL=redis://redis:6379
ANTHROPIC_KEY_ORG1=sk-ant-api03-...
MACHINE_ID=prod-worker-1
```

### 3. Run pre-flight checks

```bash
bash scripts/docker-preflight.sh
```

This validates all required environment variables and their formats before starting containers.

### 4. Build and start

```bash
cd infra/docker
docker compose -f docker-compose.prod.yml up -d --build
```

This starts four containers:

| Container | Port | Description |
|---|---|---|
| `agentctl-postgres-prod` | (internal) | PostgreSQL 16 with tuned settings |
| `agentctl-redis-prod` | (internal) | Redis 7 with AOF persistence |
| `agentctl-control-plane` | 8080 | Control plane API + WebSocket |
| `agentctl-agent-worker` | 9000 | Agent worker daemon |

All application containers run as non-root (uid 1001) with `cap_drop: ALL` and `no-new-privileges`. The backend network is internal (no direct internet access from containers).

### 5. Verify

```bash
docker compose -f docker-compose.prod.yml ps
curl http://localhost:8080/health?detail=true | jq .
curl http://localhost:9000/health | jq .
```

### 6. Set up HTTPS with a reverse proxy (recommended)

Place nginx or Caddy in front of the control plane for TLS termination.

**Caddy (simplest):**

```
agentctl.example.com {
    reverse_proxy localhost:8080
}
```

**nginx:**

```nginx
server {
    listen 443 ssl;
    server_name agentctl.example.com;

    ssl_certificate     /etc/ssl/certs/agentctl.pem;
    ssl_certificate_key /etc/ssl/private/agentctl-key.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### 7. Alternative: PM2 (without Docker)

If you prefer running Node.js directly:

```bash
npm install -g pm2

# Build for production
pnpm install --frozen-lockfile
pnpm build

# Start control plane
pm2 start infra/pm2/ecosystem.control.config.cjs

# Start agent worker
pm2 start infra/pm2/ecosystem.worker.config.cjs

# Enable boot persistence
pm2 save
pm2 startup
```

PM2 configs live in `infra/pm2/` and include exponential backoff restart, memory limits, and structured JSON logging to `/var/log/agentctl/`.

## Production -- Multi-Machine (Tailscale)

Distribute services across multiple machines connected via Tailscale mesh.

### 1. Install Tailscale on all machines

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

### 2. Join the tailnet with appropriate tags

```bash
# Primary machine (control plane + database + Redis)
sudo tailscale up --hostname=control --advertise-tags=tag:control --ssh

# Worker machine 1 (agent worker)
sudo tailscale up --hostname=worker-1 --advertise-tags=tag:worker --ssh

# Worker machine 2
sudo tailscale up --hostname=worker-2 --advertise-tags=tag:worker --ssh
```

### 3. Apply ACL policy

Upload `infra/tailscale/acl-policy.json` to the Tailscale admin console (Access Controls). This policy enforces:

- Control plane can reach workers on port 9000
- Workers can reach control plane on port 8080 and infrastructure ports (5432, 6379, 4000)
- Mobile clients can only reach the control plane
- Workers are isolated from each other
- Dev machines have unrestricted access

### 4. Deploy the primary machine

On the control plane host (`control`):

```bash
git clone https://github.com/hahaschool/agentctl.git
cd agentctl
cp .env.example .env
# Edit .env with production values (DATABASE_URL, REDIS_URL, ANTHROPIC_KEY_ORG1, etc.)

# Option A: Docker Compose
cd infra/docker && docker compose -f docker-compose.prod.yml up -d --build

# Option B: PM2
pnpm install && pnpm build
pm2 start infra/pm2/ecosystem.control.config.cjs
pm2 save && pm2 startup
```

### 5. Deploy worker machines

On each worker machine:

```bash
git clone https://github.com/hahaschool/agentctl.git
cd agentctl
cp .env.example .env
```

Edit `.env` on each worker:

```bash
CONTROL_URL=http://control:8080
REDIS_URL=redis://control:6379
MACHINE_ID=worker-1                    # unique per machine
ANTHROPIC_API_KEY=sk-ant-api03-...     # for Claude Agent SDK
WORKER_PORT=9000
```

Start the worker:

```bash
pnpm install && pnpm build
pm2 start infra/pm2/ecosystem.worker.config.cjs
pm2 save && pm2 startup
```

### 6. Verify mesh connectivity

```bash
# From control machine
tailscale status
curl http://worker-1:9000/health | jq .

# From worker machine
curl http://control:8080/health | jq .
```

### 7. Automated fleet provisioning (optional)

For larger fleets, use the provisioning scripts:

```bash
# Preview what would happen
pnpm tsx scripts/provision-target.ts --dry-run

# Provision a target machine (installs Docker, Compose, Tailscale)
pnpm tsx scripts/provision-target.ts

# Bootstrap all machines in infra/machines.yml
pnpm tsx scripts/fleet-bootstrap.ts --dry-run
pnpm tsx scripts/fleet-bootstrap.ts
```

Or use the one-shot setup script:

```bash
# On the target machine
./scripts/setup-machine.sh control control-host   # control plane role
./scripts/setup-machine.sh worker worker-1         # worker role
```

## Database Setup

### PostgreSQL

The control plane uses Drizzle ORM with PostgreSQL. The default connection string is:

```
postgresql://agentctl:agentctl@localhost:5432/agentctl
```

The Docker Compose dev config (`infra/docker/docker-compose.dev.yml`) creates a PostgreSQL 16 container with these credentials automatically.

### Migrations

```bash
# Apply pending migrations
pnpm --filter @agentctl/control-plane db:migrate

# Generate a new migration after schema changes
pnpm --filter @agentctl/control-plane db:generate

# Open Drizzle Studio (visual DB browser)
pnpm --filter @agentctl/control-plane db:studio
```

### Deploy migrations remotely

```bash
# Preview SQL that will run
pnpm tsx scripts/migrate-deploy.ts --dry-run

# Execute migrations
pnpm tsx scripts/migrate-deploy.ts
```

### Backup strategy

```bash
# Manual backup
pg_dump -U agentctl -h localhost -p 5432 agentctl > backup-$(date +%Y%m%d).sql

# Automated daily backup (add to crontab)
0 3 * * * pg_dump -U agentctl agentctl | gzip > /var/backups/agentctl-$(date +\%Y\%m\%d).sql.gz
```

## Environment Variables Reference

All variables are documented in `.env.example`. Here is the complete reference:

### Control Plane

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `8080` | Control plane API port |
| `HOST` | No | `0.0.0.0` | Bind address |
| `DATABASE_URL` | Yes | `postgresql://agentctl:agentctl@localhost:5432/agentctl` | PostgreSQL connection string |
| `REDIS_URL` | Yes | `redis://localhost:6379` | Redis URL for BullMQ and caching |
| `LITELLM_URL` | No | `http://localhost:4000` | LiteLLM proxy URL |
| `MEM0_URL` | No | `http://localhost:8050` | Mem0 memory server URL |
| `MEMORY_BACKEND` | No | `auto` | Memory backend: `auto`, `postgres`, or `mem0` |
| `CONTROL_PLANE_URL` | No | `http://<HOST>:<PORT>` | Public URL for worker callbacks |
| `WORKER_CONCURRENCY` | No | `5` | Concurrent BullMQ jobs |
| `LOG_LEVEL` | No | `info` | Log level: fatal, error, warn, info, debug, trace |

### Agent Worker

| Variable | Required | Default | Description |
|---|---|---|---|
| `WORKER_PORT` | No | `9000` | Worker API port |
| `WORKER_HOST` | No | `0.0.0.0` | Bind address |
| `CONTROL_URL` | No | `http://localhost:8080` | Control plane URL |
| `MACHINE_ID` | Yes (prod) | `machine-<hostname>` | Unique machine identifier |
| `MAX_CONCURRENT_AGENTS` | No | `3` | Max concurrent agent instances |
| `HEARTBEAT_INTERVAL_MS` | No | `15000` | Heartbeat interval (ms) |
| `AGENT_TIMEOUT_MS` | No | `3600000` | Agent execution timeout (1 hour) |
| `AGENT_MAX_RESTARTS` | No | `3` | Max auto-restarts per agent |
| `AUDIT_LOG_DIR` | No | `.agentctl/audit` | NDJSON audit log directory |
| `IPC_DIR` | No | `.agentctl/ipc` | Filesystem IPC directory |
| `PROJECT_PATH` | No | (none) | Root project path for worktree isolation |
| `WORKTREE_BASE_DIR` | No | `/opt/agentctl/.trees` | Base directory for agent worktrees |
| `TAILSCALE_IP` | No | auto-detected | Override Tailscale IP |

### LLM Providers

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_KEY_ORG1` | Yes (LLM) | -- | Anthropic API key (primary org) |
| `ANTHROPIC_KEY_ORG2` | No | -- | Anthropic API key (second org, doubles rate limits) |
| `ANTHROPIC_API_KEY` | No | -- | Direct key for Claude Agent SDK on workers |
| `OPENAI_API_KEY` | No | -- | OpenAI API key for Codex sessions |
| `OPENAI_BASE_URL` | No | -- | OpenAI-compatible base URL for Codex |
| `AWS_ACCESS_KEY_ID` | No | -- | AWS key for Bedrock failover |
| `AWS_SECRET_ACCESS_KEY` | No | -- | AWS secret for Bedrock failover |
| `AWS_DEFAULT_REGION` | No | `us-east-1` | AWS region for Bedrock |
| `GCP_PROJECT` | No | -- | GCP project ID for Vertex AI |
| `GOOGLE_APPLICATION_CREDENTIALS` | No | -- | Path to GCP service account JSON |
| `AZURE_OPENAI_API_KEY` | No | -- | Azure OpenAI key for Codex failover |
| `AZURE_OPENAI_ENDPOINT` | No | -- | Azure OpenAI endpoint URL |
| `AZURE_OPENAI_API_VERSION` | No | `2025-10-01-preview` | Azure API version |

### Docker / Infrastructure

| Variable | Required | Default | Description |
|---|---|---|---|
| `POSTGRES_USER` | No | `agentctl` | PostgreSQL container user |
| `POSTGRES_PASSWORD` | Yes (Docker) | -- | PostgreSQL container password |
| `POSTGRES_DB` | No | `agentctl` | PostgreSQL container database |
| `CONTROL_PLANE_PORT` | No | `8080` | Host port mapping for control plane |
| `AGENT_WORKER_PORT` | No | `9000` | Host port mapping for worker |
| `LITELLM_MASTER_KEY` | No | -- | LiteLLM admin API key |

### Security

| Variable | Required | Default | Description |
|---|---|---|---|
| `E2E_SECRET_KEY` | No | -- | TweetNaCl key for iOS E2E encryption |
| `JWT_SECRET` | No | -- | JWT secret for API authentication |
| `NODE_ENV` | No | `development` | Node environment |

## Logging Stack (Optional)

For structured log aggregation, deploy the Vector + ClickHouse stack:

```bash
# Create the shared network first (if not already created by the prod compose)
docker network create agentctl_backend 2>/dev/null || true

# Start logging stack
docker compose -f infra/vector/docker-compose.vector.yml up -d
```

ClickHouse is available at `http://localhost:8123` (HTTP) and `localhost:9000` (native TCP). Vector collects logs from `/var/log/agentctl/` and Docker container stdout.

## Monitoring and Operations

### Health endpoints

Every service exposes a `GET /health` endpoint:

| Service | URL | Detail mode |
|---|---|---|
| Control Plane | `http://localhost:8080/health` | `?detail=true` shows PostgreSQL, Redis, Mem0, LiteLLM status |
| Agent Worker | `http://localhost:9000/health` | `?detail=true` shows dependency status |

### CLI tools

```bash
# System health across all services
pnpm tsx scripts/agentctl.ts health

# Fleet status (control plane + workers)
pnpm tsx scripts/agentctl.ts status

# List registered agents
pnpm tsx scripts/agentctl.ts agents

# Start an agent with a prompt
pnpm tsx scripts/agentctl.ts start my-agent "Describe the project structure"

# JSON output for scripting
pnpm tsx scripts/agentctl.ts health --json
```

### PM2 monitoring

```bash
pm2 status                        # process list
pm2 monit                         # real-time dashboard
pm2 logs control-plane --lines 50 # tail logs
pm2 logs agent-worker --lines 50
```

### Docker monitoring

```bash
docker compose -f infra/docker/docker-compose.prod.yml ps
docker compose -f infra/docker/docker-compose.prod.yml logs -f control-plane
docker compose -f infra/docker/docker-compose.prod.yml logs -f agent-worker
```

## Troubleshooting

### "Database not configured" banner in the web UI

The control plane started without `DATABASE_URL`. Verify the variable is set and restart:

```bash
echo $DATABASE_URL
# Should print: postgresql://agentctl:...@localhost:5432/agentctl
pnpm dev:control   # restart with env loaded
```

### Port already in use

```bash
# Find the process using the port
lsof -i :8080    # control plane
lsof -i :9000    # worker
lsof -i :5173    # web UI

# Kill it
kill -9 <PID>
```

### Redis connection refused

```bash
redis-cli ping
# Should print: PONG

# If not running:
brew services start redis          # macOS
sudo systemctl start redis-server  # Linux
```

### Build fails with type errors

```bash
# Clean all build artifacts and rebuild
pnpm clean
pnpm install
pnpm build
```

The shared package must build first. If only one package fails:

```bash
pnpm --filter @agentctl/shared build
pnpm --filter @agentctl/control-plane build
```

### Worker cannot reach the control plane

```bash
# Check connectivity
curl http://control:8080/health

# If using Tailscale, verify mesh status
tailscale status
tailscale ping control

# Check that the worker's CONTROL_URL matches the control plane's actual address
echo $CONTROL_URL
```

### Docker containers keep restarting

```bash
# Check container logs
docker compose -f infra/docker/docker-compose.prod.yml logs control-plane --tail 50

# Common causes:
# - POSTGRES_PASSWORD not set (compose will refuse to start)
# - DATABASE_URL points to localhost instead of the postgres container hostname
# - Redis not yet healthy when control-plane starts (check depends_on conditions)
```

### Drizzle migrations fail

```bash
# Verify DATABASE_URL is reachable
psql "$DATABASE_URL" -c "SELECT 1;"

# Re-run migrations
pnpm --filter @agentctl/control-plane db:migrate

# Inspect migration state
pnpm --filter @agentctl/control-plane db:studio
```

## Port Reference

| Service | Default Port | Configured By |
|---|---|---|
| Control Plane API | 8080 | `PORT` / `CONTROL_PLANE_PORT` |
| Agent Worker API | 9000 | `WORKER_PORT` / `AGENT_WORKER_PORT` |
| Web UI (dev) | 5173 | hardcoded in `packages/web/package.json` |
| PostgreSQL | 5432 | `DATABASE_URL` |
| Redis | 6379 | `REDIS_URL` |
| LiteLLM Proxy | 4000 | `LITELLM_URL` |
| Mem0 Server | 8050 | `MEM0_URL` |
| ClickHouse HTTP | 8123 | `CLICKHOUSE_HTTP_PORT` |
| ClickHouse TCP | 9000 | `CLICKHOUSE_TCP_PORT` |
