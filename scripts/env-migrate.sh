#!/usr/bin/env bash
# env-migrate.sh — Run database migrations for a specific tier
# Usage: ./scripts/env-migrate.sh <tier>
# Example: ./scripts/env-migrate.sh dev-1
#          ./scripts/env-migrate.sh beta  (requires confirmation)

set -euo pipefail

TIER="${1:-}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -z "$TIER" ]]; then
  echo "Usage: $0 <tier>"
  echo "  tier: beta, dev-1, dev-2, etc."
  exit 1
fi

ENV_FILE="${REPO_ROOT}/.env.${TIER}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: env file not found: ${ENV_FILE}"
  exit 1
fi

# Safety gate: beta requires explicit confirmation
if [[ "$TIER" == "beta" ]]; then
  echo "⚠️  You are about to migrate the BETA database."
  echo "    This is the daily-use environment."
  read -rp "Type 'yes' to continue: " confirm
  if [[ "$confirm" != "yes" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

# Load DATABASE_URL from the tier env file
DATABASE_URL=$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)
if [[ -z "$DATABASE_URL" ]]; then
  echo "Error: DATABASE_URL not found in ${ENV_FILE}"
  exit 1
fi

echo "Running migrations for tier: ${TIER}"
echo "Database: ${DATABASE_URL}"

cd "${REPO_ROOT}/packages/control-plane"
DATABASE_URL="$DATABASE_URL" pnpm drizzle-kit migrate

echo "✅ Migrations complete for tier: ${TIER}"
