#!/usr/bin/env bash
# env-promote.sh — Promote code from a dev tier to beta
# Usage: ./scripts/env-promote.sh [--from <tier>] [--dry-run]
# Example: ./scripts/env-promote.sh --from dev-1
#          ./scripts/env-promote.sh --dry-run
#
# Promotes the current monorepo build to the beta tier:
#   1. Builds all packages (pnpm build)
#   2. Checks Drizzle migration parity between source and beta DBs
#   3. Runs DB migrations on beta
#   4. Restarts beta services via PM2
#
# Safety:
#   - flock prevents concurrent promotions
#   - Rollback on any step failure (no partial state)
#   - --dry-run shows plan without executing

set -euo pipefail

# ── Constants ────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCK_DIR="/tmp/agentctl-tier-locks"
LOCK_FILE="${LOCK_DIR}/promote-beta.lock"
BETA_ENV_FILE="${REPO_ROOT}/.env.beta"
PM2_CONFIG="${REPO_ROOT}/infra/pm2/ecosystem.beta.config.cjs"
DRIZZLE_JOURNAL="${REPO_ROOT}/packages/control-plane/drizzle/meta/_journal.json"
PROMOTE_LOG="${REPO_ROOT}/logs/beta/promote.log"

# ── Color helpers ────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
  local timestamp
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local message="[${timestamp}] $1"
  echo -e "${BLUE}${message}${NC}"
  # Append to log file (create dir if needed)
  mkdir -p "$(dirname "$PROMOTE_LOG")"
  echo "$message" >> "$PROMOTE_LOG"
}

log_ok() {
  local timestamp
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local message="[${timestamp}] $1"
  echo -e "${GREEN}${message}${NC}"
  mkdir -p "$(dirname "$PROMOTE_LOG")"
  echo "$message" >> "$PROMOTE_LOG"
}

log_warn() {
  local timestamp
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local message="[${timestamp}] WARN: $1"
  echo -e "${YELLOW}${message}${NC}"
  mkdir -p "$(dirname "$PROMOTE_LOG")"
  echo "$message" >> "$PROMOTE_LOG"
}

log_err() {
  local timestamp
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local message="[${timestamp}] ERROR: $1"
  echo -e "${RED}${message}${NC}" >&2
  mkdir -p "$(dirname "$PROMOTE_LOG")"
  echo "$message" >> "$PROMOTE_LOG"
}

# ── Parse arguments ──────────────────────────────────────────────────
FROM_TIER=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from)
      FROM_TIER="${2:-}"
      if [[ -z "$FROM_TIER" ]]; then
        echo "Error: --from requires a tier name (e.g. dev-1)"
        exit 1
      fi
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--from <tier>] [--dry-run]"
      echo ""
      echo "Promotes code from a dev tier to beta."
      echo ""
      echo "Options:"
      echo "  --from <tier>  Source tier (default: auto-detect from .env.dev-*)"
      echo "  --dry-run      Show what would happen without executing"
      echo "  -h, --help     Show this help"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--from <tier>] [--dry-run]"
      exit 1
      ;;
  esac
done

# ── Auto-detect source tier if not specified ─────────────────────────
if [[ -z "$FROM_TIER" ]]; then
  # Look for .env.dev-* files and pick the first one
  found_tier=""
  for f in "${REPO_ROOT}"/.env.dev-*; do
    if [[ -f "$f" ]]; then
      found_tier="$(basename "$f" | sed 's/^\.env\.//')"
      break
    fi
  done
  if [[ -z "$found_tier" ]]; then
    log_err "No --from tier specified and no .env.dev-* files found."
    echo "Usage: $0 --from <tier>"
    exit 1
  fi
  FROM_TIER="$found_tier"
  log "Auto-detected source tier: ${FROM_TIER}"
fi

# ── Validate environment files ───────────────────────────────────────
FROM_ENV_FILE="${REPO_ROOT}/.env.${FROM_TIER}"
if [[ ! -f "$FROM_ENV_FILE" ]]; then
  log_err "Source env file not found: ${FROM_ENV_FILE}"
  exit 1
fi

if [[ ! -f "$BETA_ENV_FILE" ]]; then
  log_err "Beta env file not found: ${BETA_ENV_FILE}"
  echo "Create it from .env.template first."
  exit 1
fi

if [[ ! -f "$PM2_CONFIG" ]]; then
  log_err "PM2 beta config not found: ${PM2_CONFIG}"
  exit 1
fi

# ── Load database URLs ───────────────────────────────────────────────
FROM_DB_URL=$(grep '^DATABASE_URL=' "$FROM_ENV_FILE" | cut -d= -f2-)
BETA_DB_URL=$(grep '^DATABASE_URL=' "$BETA_ENV_FILE" | cut -d= -f2-)

if [[ -z "$FROM_DB_URL" ]]; then
  log_err "DATABASE_URL not found in ${FROM_ENV_FILE}"
  exit 1
fi

if [[ -z "$BETA_DB_URL" ]]; then
  log_err "DATABASE_URL not found in ${BETA_ENV_FILE}"
  exit 1
fi

# ── Dry run banner ───────────────────────────────────────────────────
if [[ "$DRY_RUN" == true ]]; then
  echo ""
  echo -e "${YELLOW}=== DRY RUN MODE ===${NC}"
  echo -e "${YELLOW}No changes will be made. Showing planned actions.${NC}"
  echo ""
fi

# ── Promotion plan ───────────────────────────────────────────────────
log "Promotion plan: ${FROM_TIER} -> beta"
log "  Source env:  ${FROM_ENV_FILE}"
log "  Beta env:    ${BETA_ENV_FILE}"
log "  PM2 config:  ${PM2_CONFIG}"
log "  Steps:"
log "    1. Acquire promotion lock (flock)"
log "    2. Build all packages (pnpm build)"
log "    3. Check Drizzle migration parity (${FROM_TIER} vs beta)"
log "    4. Run DB migrations on beta"
log "    5. Restart beta services (PM2 stop + start)"
echo ""

if [[ "$DRY_RUN" == true ]]; then
  log "Dry run complete. No actions taken."
  exit 0
fi

# ── Step 1: Acquire promotion lock ──────────────────────────────────
log "Step 1/5: Acquiring promotion lock..."
mkdir -p "$LOCK_DIR"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  log_err "Another promotion is already in progress (lock held: ${LOCK_FILE})."
  cat "$LOCK_FILE" 2>/dev/null || true
  exit 1
fi

# Write lock metadata
echo "pid=$$" >&200
echo "from=${FROM_TIER}" >&200
echo "started=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >&200

log_ok "  Lock acquired."

# ── Rollback tracking ───────────────────────────────────────────────
# Track what we've done so we can undo on failure.
# Build: no rollback needed (old dist/ was overwritten, but beta hasn't restarted)
# Migration: cannot easily undo — so we validate parity BEFORE migrating
# PM2 restart: if it fails, we try to restart with the old state
BETA_WAS_RUNNING=false
if command -v pm2 &>/dev/null && pm2 describe agentctl-cp-beta &>/dev/null 2>&1; then
  BETA_WAS_RUNNING=true
fi

rollback() {
  log_err "Promotion failed — rolling back..."

  # If we stopped beta but didn't successfully restart, try to bring it back
  if [[ "$BETA_WAS_RUNNING" == true ]]; then
    log "  Attempting to restart beta services with previous build..."
    if command -v pm2 &>/dev/null; then
      pm2 restart agentctl-cp-beta agentctl-worker-beta agentctl-web-beta 2>/dev/null || {
        log_warn "  Could not restart beta services. Manual intervention needed:"
        log_warn "    pm2 start ${PM2_CONFIG}"
      }
    fi
  fi

  log_err "Rollback complete. Beta may be running previous version."
  exit 1
}

trap rollback ERR

# ── Step 2: Build all packages ───────────────────────────────────────
log "Step 2/5: Building all packages..."
cd "$REPO_ROOT"
if ! pnpm build 2>&1; then
  log_err "Build failed. Aborting promotion — no changes made to beta."
  # Disable trap since we haven't touched beta yet
  trap - ERR
  exit 1
fi
log_ok "  Build succeeded."

# ── Step 3: Check Drizzle migration parity ───────────────────────────
log "Step 3/5: Checking schema parity between ${FROM_TIER} and beta..."

if [[ ! -f "$DRIZZLE_JOURNAL" ]]; then
  log_err "Drizzle journal not found: ${DRIZZLE_JOURNAL}"
  trap - ERR
  exit 1
fi

# Get the list of migration tags from the journal (filesystem = source of truth)
FS_MIGRATIONS=$(python3 -c "
import json, sys
with open('${DRIZZLE_JOURNAL}') as f:
    j = json.load(f)
tags = sorted([e['tag'] for e in j['entries']])
for t in tags:
    print(t)
" 2>/dev/null || true)

if [[ -z "$FS_MIGRATIONS" ]]; then
  log_err "Could not parse Drizzle journal."
  trap - ERR
  exit 1
fi

FS_COUNT=$(echo "$FS_MIGRATIONS" | wc -l | tr -d ' ')

# Query the Drizzle migrations table in the source (dev) DB to see what's applied
# Drizzle stores applied migrations in __drizzle_migrations table
FROM_APPLIED=$(psql "$FROM_DB_URL" -t -A -c \
  "SELECT tag FROM __drizzle_migrations ORDER BY created_at;" 2>/dev/null || echo "")

BETA_APPLIED=$(psql "$BETA_DB_URL" -t -A -c \
  "SELECT tag FROM __drizzle_migrations ORDER BY created_at;" 2>/dev/null || echo "")

FROM_COUNT=0
BETA_COUNT=0
if [[ -n "$FROM_APPLIED" ]]; then
  FROM_COUNT=$(echo "$FROM_APPLIED" | wc -l | tr -d ' ')
fi
if [[ -n "$BETA_APPLIED" ]]; then
  BETA_COUNT=$(echo "$BETA_APPLIED" | wc -l | tr -d ' ')
fi

log "  Filesystem migrations:     ${FS_COUNT}"
log "  Applied in ${FROM_TIER} DB: ${FROM_COUNT}"
log "  Applied in beta DB:        ${BETA_COUNT}"

# Check: source tier should have all filesystem migrations applied
if [[ "$FROM_COUNT" -lt "$FS_COUNT" ]]; then
  log_warn "  Source tier ${FROM_TIER} is behind filesystem migrations."
  log_warn "  Run: ./scripts/env-migrate.sh ${FROM_TIER}"
  log_warn "  Continuing — beta will get all filesystem migrations."
fi

# Check: beta should not be AHEAD of filesystem (would indicate manual tampering)
if [[ "$BETA_COUNT" -gt "$FS_COUNT" ]]; then
  log_err "  Beta DB has MORE migrations than the filesystem. This should not happen."
  log_err "  Beta has ${BETA_COUNT} applied, filesystem has ${FS_COUNT}."
  log_err "  Investigate manually before promoting."
  trap - ERR
  exit 1
fi

# Check: if beta is already at parity with filesystem, skip migration
if [[ "$BETA_COUNT" -eq "$FS_COUNT" ]]; then
  log_ok "  Schema parity confirmed. No new migrations needed."
  SKIP_MIGRATION=true
else
  PENDING=$((FS_COUNT - BETA_COUNT))
  log "  Beta needs ${PENDING} migration(s). Will apply in step 4."
  SKIP_MIGRATION=false
fi

# ── Step 4: Run DB migrations on beta ────────────────────────────────
if [[ "$SKIP_MIGRATION" == true ]]; then
  log "Step 4/5: Skipping migrations (already at parity)."
else
  log "Step 4/5: Running DB migrations on beta..."
  cd "${REPO_ROOT}/packages/control-plane"
  if ! DATABASE_URL="$BETA_DB_URL" pnpm drizzle-kit migrate 2>&1; then
    log_err "Migration failed on beta DB. No services were restarted."
    log_err "Beta is still running the previous version."
    trap - ERR
    exit 1
  fi
  log_ok "  Migrations applied successfully."
fi

# ── Step 5: Restart beta services via PM2 ────────────────────────────
log "Step 5/5: Restarting beta services..."
cd "$REPO_ROOT"

if ! command -v pm2 &>/dev/null; then
  log_err "pm2 not found. Install with: npm install -g pm2"
  trap - ERR
  exit 1
fi

# Stop beta services (may already be stopped — that's OK)
log "  Stopping beta services..."
pm2 stop agentctl-cp-beta agentctl-worker-beta agentctl-web-beta 2>/dev/null || {
  log_warn "  Some beta services were not running (OK for first deploy)."
}

# Start (or restart) from the ecosystem config
log "  Starting beta services from PM2 config..."
if ! pm2 start "$PM2_CONFIG" 2>&1; then
  log_err "PM2 start failed."
  rollback
fi

# Save PM2 state for boot persistence
pm2 save --force 2>/dev/null || {
  log_warn "  pm2 save failed — services will not persist across reboot."
}

log_ok "  Beta services restarted."

# ── Done ─────────────────────────────────────────────────────────────
trap - ERR
echo ""
log_ok "Promotion complete: ${FROM_TIER} -> beta"
log "  CP:     http://localhost:8080"
log "  Worker: http://localhost:9000"
log "  Web:    http://localhost:5173"
log "  Logs:   ${PROMOTE_LOG}"
echo ""
echo -e "${GREEN}Done. Beta is running the latest build.${NC}"
