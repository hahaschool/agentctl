#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# peer-update.sh — self-update the local AgentCTL node in-place.
#
# Invoked ONLY by the authenticated `POST /api/sync/peers/:peerId/update`
# endpoint when `:peerId` matches the local machine id. The script:
#   1. snapshots the current git SHA
#   2. fast-forwards to origin/main
#   3. installs deps + builds + runs DB migrations
#   4. reloads the PM2 ecosystem
#   5. probes /health until the new CP answers (or rolls back)
#
# On any pre-reload failure the trap rolls the git tree back. On a post-reload
# health-probe failure the rollback also re-installs, rebuilds, and reloads
# PM2 with the previous SHA so the node ends up in a self-consistent state.
#
# DO NOT run directly from a shell for deployments — use
# `./scripts/env-promote.sh` for operator-driven deploys.
#
# Environment:
#   AGENTCTL_PM2_ECOSYSTEM           PM2 ecosystem name to reload (e.g. agentctl-beta)
#   AGENTCTL_PEER_HEALTH_URL         Health endpoint to poll (default http://127.0.0.1:8080/health)
#   AGENTCTL_PEER_HEALTH_TIMEOUT_SEC Health probe budget (default 90)
#   AGENTCTL_PEER_MAX_VERSION_SKEW   Refuse auto-upgrade when jumping more than N minor versions (unset = unlimited)
#   AGENTCTL_SKIP_MIGRATIONS         Set to 1 to skip drizzle-kit migrate (default 0)
#
# Roadmap: docs/ROADMAP.md §33.11 Fleet Rollout & Peer Auto-Update.
# ---------------------------------------------------------------------------
set -euo pipefail

PM2_ECOSYSTEM="${AGENTCTL_PM2_ECOSYSTEM:-}"
HEALTH_URL="${AGENTCTL_PEER_HEALTH_URL:-http://127.0.0.1:8080/health}"
HEALTH_TIMEOUT_SEC="${AGENTCTL_PEER_HEALTH_TIMEOUT_SEC:-90}"
SKIP_MIGRATIONS="${AGENTCTL_SKIP_MIGRATIONS:-0}"
MAX_VERSION_SKEW="${AGENTCTL_PEER_MAX_VERSION_SKEW:-}"

if [ -z "${PM2_ECOSYSTEM}" ]; then
  echo "peer-update: AGENTCTL_PM2_ECOSYSTEM env var is required" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${REPO_ROOT}"

PREVIOUS_SHA="$(git rev-parse HEAD)"
PREVIOUS_VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo 'unknown')"
echo "peer-update: starting at ${PREVIOUS_SHA} (v${PREVIOUS_VERSION})"

# ---------------------------------------------------------------------------
# Rollback helper — full restoration: git + deps + build + pm2 reload.
# Best-effort: each step swallows its own failure so we don't leave the node
# partially reverted. Guarded so a nested trap can't re-enter.
# ---------------------------------------------------------------------------
ROLLBACK_IN_PROGRESS=0
rollback() {
  if [ "${ROLLBACK_IN_PROGRESS}" -eq 1 ]; then
    return 0
  fi
  ROLLBACK_IN_PROGRESS=1
  local reason="${1:-unspecified failure}"
  echo "peer-update: ROLLBACK — ${reason}. Restoring ${PREVIOUS_SHA}" >&2

  git reset --hard "${PREVIOUS_SHA}" || echo "peer-update: git reset failed during rollback" >&2
  pnpm install --frozen-lockfile || echo "peer-update: rollback pnpm install failed" >&2
  pnpm build || echo "peer-update: rollback build failed" >&2
  pm2 reload "${PM2_ECOSYSTEM}" || echo "peer-update: rollback pm2 reload failed" >&2
  echo "peer-update: rollback complete — node is on ${PREVIOUS_SHA}" >&2
}
trap 'rollback "pre-reload script error"' ERR

# ---------------------------------------------------------------------------
# Fetch + optional version-skew guard BEFORE mutating the working tree.
# ---------------------------------------------------------------------------
git fetch origin

if [ -n "${MAX_VERSION_SKEW}" ]; then
  TARGET_VERSION="$(git show origin/main:package.json | node -e 'let s=""; process.stdin.on("data",c=>s+=c); process.stdin.on("end",()=>{try{process.stdout.write(JSON.parse(s).version);}catch{process.stdout.write("unknown");}})' 2>/dev/null || echo 'unknown')"
  if [ "${PREVIOUS_VERSION}" != 'unknown' ] && [ "${TARGET_VERSION}" != 'unknown' ]; then
    PREV_MINOR="$(echo "${PREVIOUS_VERSION}" | awk -F. '{print $1 * 1000 + $2}')"
    NEW_MINOR="$(echo "${TARGET_VERSION}" | awk -F. '{print $1 * 1000 + $2}')"
    SKEW=$(( NEW_MINOR - PREV_MINOR ))
    if [ "${SKEW}" -gt "${MAX_VERSION_SKEW}" ]; then
      echo "peer-update: refusing auto-update — version skew ${PREVIOUS_VERSION} -> ${TARGET_VERSION} exceeds AGENTCTL_PEER_MAX_VERSION_SKEW=${MAX_VERSION_SKEW}" >&2
      trap - ERR
      exit 3
    fi
  fi
fi

git reset --hard origin/main
pnpm install --frozen-lockfile
pnpm build

# ---------------------------------------------------------------------------
# Run DB migrations BEFORE pm2 reload (matches env-promote.sh). Migrations are
# forward-only and idempotent (IF NOT EXISTS / DEFAULTs), so it is safe to run
# them even when the beta PM2 config sets SKIP_MIGRATIONS=true on the CP.
# Without this step a remote upgrade that crosses a schema version will bring
# up a CP that crashes on the first query to a missing column.
# ---------------------------------------------------------------------------
if [ "${SKIP_MIGRATIONS}" != "1" ]; then
  echo "peer-update: applying DB migrations (drizzle-kit migrate)"
  pnpm --filter @agentctl/control-plane exec drizzle-kit migrate
else
  echo "peer-update: AGENTCTL_SKIP_MIGRATIONS=1 — skipping DB migrations"
fi

pm2 reload "${PM2_ECOSYSTEM}"

# ---------------------------------------------------------------------------
# Post-reload health probe. pm2 reload returns as soon as the signal is sent;
# the new CP may still crash on first query. Poll /health with a hard deadline
# and roll back on timeout. Clear the ERR trap so non-zero curl attempts in
# the loop don't fire it prematurely.
# ---------------------------------------------------------------------------
trap - ERR

echo "peer-update: waiting for ${HEALTH_URL} (timeout ${HEALTH_TIMEOUT_SEC}s)"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SEC ))
healthy=0
while [ "$(date +%s)" -lt "${deadline}" ]; do
  if curl --silent --fail --max-time 5 -o /dev/null "${HEALTH_URL}"; then
    healthy=1
    break
  fi
  sleep 2
done

if [ "${healthy}" -ne 1 ]; then
  rollback "health probe ${HEALTH_URL} did not return 2xx within ${HEALTH_TIMEOUT_SEC}s"
  exit 4
fi

NEW_SHA="$(git rev-parse HEAD)"
NEW_VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo 'unknown')"
echo "peer-update: success ${PREVIOUS_SHA} (v${PREVIOUS_VERSION}) -> ${NEW_SHA} (v${NEW_VERSION})"
