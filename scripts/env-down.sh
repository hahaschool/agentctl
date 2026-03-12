#!/usr/bin/env bash
# env-down.sh — Stop a development tier
# Usage: ./scripts/env-down.sh <tier>
# Example: ./scripts/env-down.sh dev-1

set -euo pipefail

TIER="${1:-}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCK_DIR="/tmp/agentctl-tier-locks"

if [[ -z "$TIER" ]]; then
  echo "Usage: $0 <tier>"
  echo "  tier: dev-1, dev-2, etc."
  exit 1
fi

if [[ "$TIER" == "beta" ]]; then
  echo "Beta tier is managed by PM2. Use:"
  echo "  pm2 stop all"
  echo "  pm2 restart all"
  exit 1
fi

ENV_FILE="${REPO_ROOT}/.env.${TIER}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Warning: env file not found: ${ENV_FILE}"
fi

# Load port values to find processes
CP_PORT=$(grep '^PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "")
WORKER_PORT=$(grep '^WORKER_PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "")
WEB_PORT=$(grep '^WEB_PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "")

stopped=0

for port in "$CP_PORT" "$WORKER_PORT" "$WEB_PORT"; do
  if [[ -n "$port" ]]; then
    pids=$(lsof -t -i :"$port" -sTCP:LISTEN 2>/dev/null || true)
    if [[ -n "$pids" ]]; then
      echo "Stopping processes on port ${port}: ${pids}"
      echo "$pids" | xargs kill 2>/dev/null || true
      stopped=$((stopped + 1))
    fi
  fi
done

# Clean up lock file
LOCK_FILE="${LOCK_DIR}/${TIER}.lock"
if [[ -f "$LOCK_FILE" ]]; then
  rm -f "$LOCK_FILE"
  echo "Lock released: ${LOCK_FILE}"
fi

if [[ $stopped -gt 0 ]]; then
  echo "✅ Tier ${TIER} stopped (${stopped} port groups)."
else
  echo "No running processes found for tier ${TIER}."
fi
