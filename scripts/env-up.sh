#!/usr/bin/env bash
# env-up.sh — Start a development tier
# Usage: ./scripts/env-up.sh <tier>
# Example: ./scripts/env-up.sh dev-1
#
# For beta tier, use PM2 directly:
#   pm2 start infra/pm2/ecosystem.beta.config.cjs

set -euo pipefail

TIER="${1:-}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCK_DIR="/tmp/agentctl-tier-locks"

if [[ -z "$TIER" ]]; then
  echo "Usage: $0 <tier>"
  echo "  tier: dev-1, dev-2, etc. (use PM2 for beta)"
  exit 1
fi

if [[ "$TIER" == "beta" ]]; then
  echo "Beta tier is managed by PM2. Use:"
  echo "  pm2 start infra/pm2/ecosystem.beta.config.cjs"
  exit 1
fi

ENV_FILE="${REPO_ROOT}/.env.${TIER}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: env file not found: ${ENV_FILE}"
  echo "Create it from .env.template first."
  exit 1
fi

# Require TIER env var to prevent accidental beta targeting
TIER_CHECK=$(grep '^TIER=' "$ENV_FILE" | cut -d= -f2-)
if [[ -z "$TIER_CHECK" ]]; then
  echo "Error: TIER not set in ${ENV_FILE}. Refusing to start."
  exit 1
fi

# Load port values
CP_PORT=$(grep '^PORT=' "$ENV_FILE" | cut -d= -f2-)
WORKER_PORT=$(grep '^WORKER_PORT=' "$ENV_FILE" | cut -d= -f2-)
WEB_PORT=$(grep '^WEB_PORT=' "$ENV_FILE" | cut -d= -f2-)

# Check port availability
for port in "$CP_PORT" "$WORKER_PORT" "$WEB_PORT"; do
  if lsof -i :"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Error: port ${port} is already in use."
    echo "Run: lsof -i :${port} to see what's using it."
    exit 1
  fi
done

# Acquire flock (fd-based, auto-releases on process death)
mkdir -p "$LOCK_DIR"
LOCK_FILE="${LOCK_DIR}/${TIER}.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo "Error: tier ${TIER} is already in use (lock held)."
  cat "$LOCK_FILE" 2>/dev/null || true
  exit 1
fi

# Write metadata to lock file (for debugging, not for lock ownership)
echo "pid=$$" >&200
echo "tier=${TIER}" >&200
echo "started=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >&200

echo "Starting tier: ${TIER}"
echo "  CP:     http://localhost:${CP_PORT}"
echo "  Worker: http://localhost:${WORKER_PORT}"
echo "  Web:    http://localhost:${WEB_PORT}"

# Source env and run migrations
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

# Run migrations on the tier's database
echo "Running migrations..."
cd "${REPO_ROOT}/packages/control-plane"
DATABASE_URL="$DATABASE_URL" pnpm drizzle-kit migrate 2>&1 || {
  echo "Warning: migrations failed. Services will start anyway."
}

# Start services in background
cd "$REPO_ROOT"
echo "Starting control plane on :${CP_PORT}..."
env $(grep -v '^#' "$ENV_FILE" | grep -v '^$' | xargs) \
  pnpm --filter @agentctl/control-plane dev &

echo "Starting worker on :${WORKER_PORT}..."
env $(grep -v '^#' "$ENV_FILE" | grep -v '^$' | xargs) \
  pnpm --filter @agentctl/agent-worker dev &

echo "Starting web on :${WEB_PORT}..."
env $(grep -v '^#' "$ENV_FILE" | grep -v '^$' | xargs) \
  pnpm --filter @agentctl/web dev -- --port "$WEB_PORT" &

echo ""
echo "✅ Tier ${TIER} is starting. Services will be ready in ~10s."
echo "   Stop with: ./scripts/env-down.sh ${TIER}"
echo ""

# Wait for all background jobs (keeps the flock held)
wait
