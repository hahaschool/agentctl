#!/usr/bin/env bash
# env-migrate.sh — Run database migrations for a specific tier
# Usage: ./scripts/env-migrate.sh <tier>
# Example: ./scripts/env-migrate.sh dev-1
#          ./scripts/env-migrate.sh beta  (requires confirmation)
#
# Applies pending Drizzle migrations via psql and records SHA-256 hashes in
# drizzle.__drizzle_migrations. Does NOT use `pnpm drizzle-kit migrate` because
# drizzle-kit v0.31.9's migrate subcommand is a silent no-op on pending SQL.
# See scripts/drizzle-migrate-apply.ts for the replacement.

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

# Redact password for logging
REDACTED_URL="$(printf '%s' "$DATABASE_URL" | sed -E 's#//([^:/?#]+):([^@]+)@#//\1:****@#')"

echo "Running migrations for tier: ${TIER}"
echo "Database: ${REDACTED_URL}"

# Delegate to the SHA-256 aware applier. drizzle-kit migrate is intentionally
# not used — see header comment and PR for full explanation.
DATABASE_URL="$DATABASE_URL" \
  pnpm tsx "${REPO_ROOT}/scripts/drizzle-migrate-apply.ts" \
    --migrations-dir "${REPO_ROOT}/packages/control-plane/drizzle"

echo "✅ Migrations complete for tier: ${TIER}"
