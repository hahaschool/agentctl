#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# peer-update.sh — self-update the local AgentCTL node in-place.
#
# This script is intended to be invoked ONLY by the authenticated
# `POST /api/sync/peers/:peerId/update` endpoint when `:peerId` matches the
# local machine id. It fetches origin/main, hard-resets the working tree,
# reinstalls dependencies, rebuilds, and reloads the configured PM2
# ecosystem. On any failure it attempts to roll the working tree back to
# the previous SHA. DO NOT run directly from a shell for deployments —
# use `./scripts/env-promote.sh` for operator-driven deploys.
#
# Environment:
#   AGENTCTL_PM2_ECOSYSTEM   PM2 ecosystem name to reload (e.g. agentctl-beta)
#
# Roadmap: docs/ROADMAP.md §33.11 Fleet Rollout & Peer Auto-Update — slice 1.
# ---------------------------------------------------------------------------
set -euo pipefail

PM2_ECOSYSTEM="${AGENTCTL_PM2_ECOSYSTEM:-}"
if [ -z "${PM2_ECOSYSTEM}" ]; then
  echo "peer-update: AGENTCTL_PM2_ECOSYSTEM env var is required" >&2
  exit 2
fi

PREVIOUS_SHA="$(git rev-parse HEAD)"
echo "peer-update: starting at ${PREVIOUS_SHA}"

rollback() {
  echo "peer-update: failure detected, rolling back to ${PREVIOUS_SHA}" >&2
  git reset --hard "${PREVIOUS_SHA}" || true
}
trap rollback ERR

git fetch origin
git reset --hard origin/main
pnpm install --frozen-lockfile
pnpm build
pm2 reload "${PM2_ECOSYSTEM}"

trap - ERR

NEW_SHA="$(git rev-parse HEAD)"
echo "peer-update: success ${PREVIOUS_SHA} -> ${NEW_SHA}"
