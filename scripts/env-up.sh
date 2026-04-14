#!/usr/bin/env bash
# env-up.sh — Start a development tier
# Usage: ./scripts/env-up.sh <tier> [--dry-run]
# Example: ./scripts/env-up.sh dev-1
#          ./scripts/env-up.sh dev-1 --dry-run
#
# For beta tier, use PM2 directly:
#   pm2 start infra/pm2/ecosystem.beta.config.cjs
#
# --dry-run prints what would happen (env file, ports, redacted DB/Redis targets,
# preflight checks) and exits 0 without acquiring the flock or starting
# any service. Matches the safety pattern in scripts/env-promote.sh.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCK_DIR="${LOCK_DIR_OVERRIDE:-/tmp/agentctl-tier-locks}"

# ── Parse arguments ──────────────────────────────────────────────────
TIER=""
DRY_RUN=false

usage() {
  echo "Usage: $0 <tier> [--dry-run]"
  echo "  tier:      dev-1, dev-2, etc. (use PM2 for beta)"
  echo "  --dry-run  Show planned actions without starting services"
}

redact_url_for_log() {
  local value="$1"
  if [[ -z "$value" ]]; then
    echo "<unset>"
  elif [[ "$value" =~ ^([^:/?#]+://)([^@/]+@)(.+)$ ]]; then
    echo "${BASH_REMATCH[1]}<redacted>@${BASH_REMATCH[3]}"
  else
    echo "$value"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
    *)
      if [[ -z "$TIER" ]]; then
        TIER="$1"
      else
        echo "Unexpected positional argument: $1"
        usage
        exit 1
      fi
      shift
      ;;
  esac
done

if [[ -z "$TIER" ]]; then
  usage
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

# Load DB/Redis URLs for reporting (dry-run only reads; startup uses sourced env later)
DATABASE_URL_PEEK=$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- || true)
REDIS_URL_PEEK=$(grep '^REDIS_URL=' "$ENV_FILE" | cut -d= -f2- || true)
DATABASE_URL_DISPLAY=$(redact_url_for_log "$DATABASE_URL_PEEK")
REDIS_URL_DISPLAY=$(redact_url_for_log "$REDIS_URL_PEEK")

# Check port availability and build a conflict report (used in dry-run too)
PORT_CONFLICTS=()
for port in "$CP_PORT" "$WORKER_PORT" "$WEB_PORT"; do
  if [[ -n "$port" ]] && lsof -i :"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    PORT_CONFLICTS+=("$port")
  fi
done

if [[ "$DRY_RUN" == true ]]; then
  LOCK_FILE_PREVIEW="${LOCK_DIR}/${TIER}.lock"
  echo ""
  echo "=== DRY RUN MODE ==="
  echo "No services will be started. No locks will be acquired."
  echo ""
  echo "Plan for tier: ${TIER}"
  echo "  Env file:      ${ENV_FILE}"
  echo "  TIER var:      ${TIER_CHECK}"
  echo "  Lock file:     ${LOCK_FILE_PREVIEW}"
  echo "  CP port:       ${CP_PORT:-<unset>}"
  echo "  Worker port:   ${WORKER_PORT:-<unset>}"
  echo "  Web port:      ${WEB_PORT:-<unset>}"
  echo "  Database:      ${DATABASE_URL_DISPLAY}"
  echo "  Redis:         ${REDIS_URL_DISPLAY}"
  echo ""
  echo "  Would start:"
  echo "    - control plane:  pnpm --filter @agentctl/control-plane dev (port ${CP_PORT})"
  echo "    - agent worker:   pnpm --filter @agentctl/agent-worker dev (port ${WORKER_PORT})"
  echo "    - web:            pnpm --filter @agentctl/web dev (port ${WEB_PORT})"
  echo "  Would run migrations against: ${DATABASE_URL_DISPLAY}"
  echo ""
  if [[ ${#PORT_CONFLICTS[@]} -gt 0 ]]; then
    echo "  Port conflicts detected: ${PORT_CONFLICTS[*]}"
    echo "  (Real run would abort here.)"
  else
    echo "  Port conflicts: none detected"
  fi
  echo ""
  echo "Dry run complete. No actions taken."
  exit 0
fi

# Real startup path — abort on port conflicts (byte-identical to previous behavior)
for port in "$CP_PORT" "$WORKER_PORT" "$WEB_PORT"; do
  if lsof -i :"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Error: port ${port} is already in use."
    echo "Run: lsof -i :${port} to see what's using it."
    exit 1
  fi
done

# Acquire a tier lock. Prefer flock when available; fall back to an atomic
# mkdir lock on platforms such as stock macOS where flock may be absent.
mkdir -p "$LOCK_DIR"
LOCK_FILE="${LOCK_DIR}/${TIER}.lock"
LOCK_SENTINEL="${LOCK_FILE}.d"
PORTABLE_LOCK_HELD=false

write_lock_metadata() {
  {
    echo "pid=$$"
    echo "tier=${TIER}"
    echo "started=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } >"$LOCK_FILE"
}

portable_lock_owner_alive() {
  local lock_pid
  lock_pid=$(grep '^pid=' "$LOCK_FILE" 2>/dev/null | cut -d= -f2- || true)
  [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null
}

cleanup_portable_lock() {
  if [[ "$PORTABLE_LOCK_HELD" == "true" ]]; then
    rm -rf "$LOCK_SENTINEL" "$LOCK_FILE"
  fi
}

if [[ "${AGENTCTL_FORCE_PORTABLE_LOCK:-}" != "1" ]] && command -v flock >/dev/null 2>&1; then
  exec 200>"$LOCK_FILE"
  if ! flock -n 200; then
    echo "Error: tier ${TIER} is already in use (lock held)."
    cat "$LOCK_FILE" 2>/dev/null || true
    exit 1
  fi
  write_lock_metadata
else
  if ! mkdir "$LOCK_SENTINEL" 2>/dev/null; then
    if portable_lock_owner_alive; then
      echo "Error: tier ${TIER} is already in use (lock held)."
      cat "$LOCK_FILE" 2>/dev/null || true
      exit 1
    fi
    echo "Warning: removing stale tier lock for ${TIER}."
    rm -rf "$LOCK_SENTINEL" "$LOCK_FILE"
    if ! mkdir "$LOCK_SENTINEL" 2>/dev/null; then
      echo "Error: tier ${TIER} is already in use (lock held)."
      cat "$LOCK_FILE" 2>/dev/null || true
      exit 1
    fi
  fi
  PORTABLE_LOCK_HELD=true
  trap cleanup_portable_lock EXIT INT TERM
  write_lock_metadata
fi

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
SKIP_MIGRATIONS=true pnpm --filter @agentctl/control-plane dev &

echo "Starting worker on :${WORKER_PORT}..."
pnpm --filter @agentctl/agent-worker dev &

echo "Starting web on :${WEB_PORT}..."
pnpm --filter @agentctl/web dev &

echo ""
echo "✅ Tier ${TIER} is starting. Services will be ready in ~10s."
echo "   Stop with: ./scripts/env-down.sh ${TIER}"
echo ""

# Wait for all background jobs (keeps the flock held)
wait
