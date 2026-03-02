#!/usr/bin/env bash
# ── Docker Pre-Flight Validation ─────────────────────────────────────
#
# Validates that all required environment variables are set and
# correctly formatted before starting Docker production containers.
#
# Usage:
#   ./scripts/docker-preflight.sh              # standalone check
#   ./scripts/docker-preflight.sh && exec "$@" # entrypoint wrapper
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more checks failed
#
# When used as a Docker entrypoint wrapper, add to your Dockerfile:
#   COPY scripts/docker-preflight.sh /usr/local/bin/docker-preflight.sh
#   ENTRYPOINT ["docker-preflight.sh"]
#   CMD ["node", "dist/index.js"]
#
# Or invoke from docker-compose.prod.yml:
#   entrypoint: ["/bin/sh", "-c", "/app/scripts/docker-preflight.sh && exec node dist/index.js"]

set -euo pipefail

# ── Constants ─────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
RESET='\033[0m'

ERRORS=()
WARNINGS=()

# ── Helper Functions ──────────────────────────────────────────────────

log_error() {
  ERRORS+=("$1")
  printf "${RED}  FAIL${RESET}  %s\n" "$1"
}

log_warn() {
  WARNINGS+=("$1")
  printf "${YELLOW}  WARN${RESET}  %s\n" "$1"
}

log_ok() {
  printf "${GREEN}    OK${RESET}  %s\n" "$1"
}

# Check that a required environment variable is set and non-empty.
require_var() {
  local var_name="$1"
  local description="${2:-}"
  local value="${!var_name:-}"

  if [ -z "$value" ]; then
    if [ -n "$description" ]; then
      log_error "${var_name} is not set — ${description}"
    else
      log_error "${var_name} is not set"
    fi
    return 1
  fi

  log_ok "${var_name} is set"
  return 0
}

# Check that an optional environment variable is set and warn if not.
check_optional_var() {
  local var_name="$1"
  local description="${2:-}"
  local value="${!var_name:-}"

  if [ -z "$value" ]; then
    if [ -n "$description" ]; then
      log_warn "${var_name} is not set — ${description}"
    else
      log_warn "${var_name} is not set"
    fi
    return 0
  fi

  log_ok "${var_name} is set"
  return 0
}

# Validate that a value looks like a PostgreSQL connection string.
validate_postgres_url() {
  local var_name="$1"
  local value="${!var_name:-}"

  if [ -z "$value" ]; then
    return 0  # Empty is handled by require_var
  fi

  if [[ "$value" =~ ^postgres(ql)?:// ]]; then
    log_ok "${var_name} has valid PostgreSQL URL format"
    return 0
  else
    log_error "${var_name} does not look like a PostgreSQL URL (expected postgres:// or postgresql://)"
    return 1
  fi
}

# Validate that a value looks like a Redis connection string.
validate_redis_url() {
  local var_name="$1"
  local value="${!var_name:-}"

  if [ -z "$value" ]; then
    return 0  # Empty is handled by require_var
  fi

  if [[ "$value" =~ ^rediss?:// ]]; then
    log_ok "${var_name} has valid Redis URL format"
    return 0
  else
    log_error "${var_name} does not look like a Redis URL (expected redis:// or rediss://)"
    return 1
  fi
}

# ── .env File Check ───────────────────────────────────────────────────

check_env_file() {
  # When running from infra/docker/, check for a .env file there or at the repo root.
  # Inside a Docker container, the env vars are injected directly so this is just a hint.
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local repo_root
  repo_root="$(cd "${script_dir}/.." 2>/dev/null && pwd)" || repo_root=""

  if [ -f "${script_dir}/../infra/docker/.env" ]; then
    log_ok ".env file found at infra/docker/.env"
  elif [ -f "${repo_root}/.env" ]; then
    log_ok ".env file found at repository root"
  elif [ -f ".env" ]; then
    log_ok ".env file found in current directory"
  else
    log_warn "No .env file found — environment variables must be set via shell or Docker"
  fi
}

# ── Main Validation ───────────────────────────────────────────────────

printf "\n${BOLD}AgentCTL Docker Pre-Flight Check${RESET}\n"
printf "═══════════════════════════════════════════════════════════════\n\n"

# Step 1: Check for .env file
printf "${BOLD}[1/5] Checking .env file${RESET}\n"
check_env_file
printf "\n"

# Step 2: Validate required environment variables
printf "${BOLD}[2/5] Checking required environment variables${RESET}\n"
require_var "REDIS_URL" "Redis connection URL required by BullMQ task queue" || true
require_var "POSTGRES_PASSWORD" "PostgreSQL password required for the database container" || true
printf "\n"

# Step 3: Validate URL formats
printf "${BOLD}[3/5] Validating connection string formats${RESET}\n"
validate_postgres_url "DATABASE_URL" || true
validate_redis_url "REDIS_URL" || true
printf "\n"

# Step 4: Check recommended variables
printf "${BOLD}[4/5] Checking recommended environment variables${RESET}\n"
check_optional_var "DATABASE_URL" "falling back to in-memory registry (not recommended for production)"
check_optional_var "MACHINE_ID" "will default to machine-<hostname>"
check_optional_var "ANTHROPIC_KEY_ORG1" "at least one Anthropic API key is needed for LLM routing"
check_optional_var "LOG_LEVEL" "defaults to 'info'"
printf "\n"

# Step 5: Check optional integration variables
printf "${BOLD}[5/5] Checking optional integrations${RESET}\n"
check_optional_var "LITELLM_URL" "LLM router will be disabled"
check_optional_var "MEM0_URL" "cross-device memory injection will be disabled"
check_optional_var "LITELLM_MASTER_KEY" "LiteLLM admin API will be unauthenticated"
check_optional_var "E2E_SECRET_KEY" "iOS E2E encryption will be disabled"
check_optional_var "JWT_SECRET" "API authentication will be disabled"
printf "\n"

# ── Summary ───────────────────────────────────────────────────────────

printf "═══════════════════════════════════════════════════════════════\n"

if [ ${#ERRORS[@]} -gt 0 ]; then
  printf "${RED}${BOLD}FAILED${RESET} — ${#ERRORS[@]} error(s), ${#WARNINGS[@]} warning(s)\n\n"
  printf "Required environment variables are missing or invalid.\n"
  printf "Set them in your .env file or shell environment and try again.\n"
  printf "See .env.example for documentation on all variables.\n\n"
  exit 1
fi

if [ ${#WARNINGS[@]} -gt 0 ]; then
  printf "${YELLOW}${BOLD}PASSED WITH WARNINGS${RESET} — ${#WARNINGS[@]} warning(s)\n\n"
  printf "All required variables are set. Some optional features are disabled.\n"
  printf "Review the warnings above if you need those features.\n\n"
else
  printf "${GREEN}${BOLD}ALL CHECKS PASSED${RESET}\n\n"
fi

# If called as an entrypoint wrapper, exec the remaining arguments.
if [ $# -gt 0 ]; then
  exec "$@"
fi

exit 0
